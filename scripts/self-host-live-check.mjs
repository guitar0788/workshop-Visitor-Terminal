#!/usr/bin/env node
/**
 * Opt-in, bounded live acceptance test for a separately owned Worker/D1.
 *
 * THIS WRITES TO D1. Creates one permanent diagnostic counter and records
 * one qualifying visit; there is intentionally no delete API. Never deploys,
 * migrates, purges, changes Cloudflare settings or touches other counters.
 * CLI accepts only an explicit HTTPS workers.dev origin that matches the
 * local private config AND a user-typed Worker confirmation.
 *
 * The local integration suite can call runLiveCheck with allowLoopbackTest;
 * the CLI does not expose or accept any local-test escape hatch.
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateApiOrigin, readAdminToken, assertLocalWorkerHostname
} from "./self-host-publish.mjs";
import { validateConfig } from "./self-host-setup.mjs";
import { verifySelfHost } from "./self-host-verify.mjs";
import { writeReadinessReport } from "./self-host-readiness.mjs";
import { createReadmeSnippet } from "./self-host-readme.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const MAX_RESPONSE = 20_000;
const HELP = [
  "Live self-host acceptance: explicit remote D1 writes and one permanent test counter.",
  "  node scripts/self-host-live-check.mjs --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --owner YOUR_GITHUB_NAME --confirm-worker YOUR-WORKER --allow-persistent-test-record --token-file .wvt-admin-token",
  "  Optional: --report live-check.json (must not exist).",
  "REQUIRES your OWN deployed Cloudflare Worker and D1, completed migrations and secrets.",
  "No automatic deploy or cleanup. Inspect the permanent diagnostic slug if a check fails.",
  "This is NOT proof of account ownership or zero Cloudflare usage/costs."
].join("\n") + "\n";

export function parseLiveArgs(argv) {
  if (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0])) {
    return { help: true };
  }
  const allowed = new Set(["api", "owner", "confirm-worker", "token-file", "report"]);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--allow-persistent-test-record") {
      if (args.consent === true) throw Error("Repeated live write consent");
      args.consent = true;
      continue;
    }
    const key = flag?.startsWith("--") ? flag.slice(2) : "";
    if (!allowed.has(key) || Object.hasOwn(args, key) ||
        !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw Error("Unknown or repeated live-check option");
    }
    args[key] = argv[++i];
  }
  if (!args.api || !OWNER.test(args.owner ?? "") || !args["confirm-worker"] ||
      args.consent !== true) {
    throw Error("Live test requires --api, --owner, --confirm-worker and explicit persistent-write consent");
  }
  if (args.report && !/^[a-zA-Z0-9._/-]+\.json$/.test(args.report)) {
    throw Error("Report must be a local JSON file");
  }
  validateApiOrigin(args.api);
  return args;
}

export async function assertLiveDestination(args, {
  root = ROOT, allowLoopbackTest = false
} = {}) {
  const origin = validateApiOrigin(args.api);
  const hostname = new URL(origin).hostname.toLowerCase();
  if (allowLoopbackTest && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
    return origin; // Only for direct calls from the local integration suite.
  }
  const labels = hostname.split(".");
  if (!origin.startsWith("https://") || labels.length !== 4 ||
      labels[2] !== "workers" || labels[3] !== "dev" ||
      !/^[a-z0-9-]+$/.test(labels[1])) {
    throw Error("Live D1 writes require your own HTTPS workers.dev subdomain");
  }
  let config;
  try {
    config = validateConfig(await readFile(join(root, "wrangler.selfhost.toml"), "utf8"));
  } catch {
    throw Error("A valid local self-host configuration is required for live writes");
  }
  if (config.worker !== args["confirm-worker"] ||
      labels[0] !== config.worker) {
    throw Error("Typed Worker confirmation does not match your local configuration and HTTPS origin");
  }
  await assertLocalWorkerHostname(origin);
  return origin;
}

const firstDesign = {
  schemaVersion: 1, theme: "pixel", width: 420, height: 220,
  background: "#101820", accent: "#7ee787",
  layers: [
    { id: "heading", kind: "text", x: 24, y: 24, width: 340, height: 36,
      text: "LIVE CHECK INITIAL", fontSize: 18, color: "#7ee787", visible: true },
    { id: "visits", kind: "count", x: 24, y: 88, width: 340, height: 70,
      text: "", fontSize: 44, color: "#7ee787", visible: true }
  ]
};
const updatedDesign = {
  ...firstDesign,
  layers: firstDesign.layers.map(layer => layer.id === "heading" ?
    { ...layer, text: "LIVE CHECK UPDATED" } : layer)
};

async function send(fetchImpl, origin, path, {
  method = "GET", token, body, svg = false, localIp
} = {}) {
  let response;
  try {
    response = await fetchImpl(origin + path, {
      method,
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: svg ? "image/svg+xml" : "application/json",
        "Cache-Control": "no-cache",
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(localIp ? { "CF-Connecting-IP": localIp } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw Error("Live Worker connection failed or attempted a forbidden redirect");
  }
  if (!(response instanceof Response)) throw Error("Invalid live Worker response");
  return response;
}

async function requireJson(response, status) {
  if (response.status !== status ||
      !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw Error("Unexpected live Worker HTTP status " + response.status);
  }
  let value;
  try {
    const body = await response.text();
    if (body.length > MAX_RESPONSE) throw Error("Oversized response");
    value = JSON.parse(body);
  } catch {
    throw Error("Malformed live Worker JSON response");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Error("Malformed live Worker response object");
  }
  return value;
}

function requireCount(value, slug, expected) {
  if (value.slug !== slug || value.hits !== expected) {
    throw Error("Live D1 counter state mismatch");
  }
}

export async function runLiveCheck(args, {
  fetchImpl = fetch,
  environment = process.env,
  root = ROOT,
  allowLoopbackTest = false,
  localIp = "203.0.113.88",
  newSlug = () => "livecheck-" + randomBytes(7).toString("hex")
} = {}) {
  if (args.help) return HELP;
  if (args.consent !== true || !OWNER.test(args.owner ?? "")) {
    throw Error("Missing explicit persistent-counter consent or owner");
  }
  const origin = await assertLiveDestination(args, { root, allowLoopbackTest });
  const usingLocalTest = allowLoopbackTest && origin.startsWith("http://127.0.0.1:");
  // Verify identity, publishing lockdown, D1 readiness and non-counting HEAD
  // before ANY mutation. The only privileged preflight call is a read.
  const ready = await verifySelfHost({
    api: origin, "token-file": args["token-file"]
  }, { fetchImpl, environment });
  if (ready.budget.remaining < 3) {
    throw Error("D1 daily receipt budget is too low for a diagnostic test");
  }
  const token = await readAdminToken({ tokenFile: args["token-file"], environment });
  const slug = newSlug();
  if (!/^livecheck-[0-9a-f]{14}$/.test(slug)) {
    throw Error("Unexpected diagnostic counter slug");
  }
  const details = "/v1/admin/counters/" + slug;
  const image = "/v1/counters/" + slug + ".svg";
  let stage = "create-counter", created = false, attemptedWrite = false;
  // Local test uses an explicit synthetic IP. The public remote CLI NEVER
  // sends CF-Connecting-IP: Cloudflare itself provides the true source IP.
  const ip = usingLocalTest ? localIp : undefined;
  const admin = (path, opts = {}) =>
    send(fetchImpl, origin, path, { ...opts, token });
  const inspect = async expected =>
    requireCount(await requireJson(await admin(details), 200), slug, expected);
  try {
    attemptedWrite = true;
    const createdResponse = await requireJson(await admin("/v1/admin/counters", {
      method: "POST", body: { slug, owner: args.owner, design: firstDesign }
    }), 201);
    if (createdResponse.slug !== slug || createdResponse.hits !== 0) {
      throw Error("New diagnostic counter was not confirmed");
    }
    created = true;
    stage = "non-counting-head";
    const head = await send(fetchImpl, origin, image, { method: "HEAD", svg: true, localIp: ip });
    if (head.status !== 200 || !head.headers.get("content-type")?.includes("image/svg+xml")) {
      throw Error("SVG HEAD response was not available");
    }
    await inspect(0);
    stage = "first-real-svg-get";
    const one = await send(fetchImpl, origin, image + "?livecheck=first",
      { svg: true, localIp: ip });
    if (one.status !== 200 ||
        !one.headers.get("content-type")?.includes("image/svg+xml") ||
        !(await one.text()).includes("LIVE CHECK INITIAL")) {
      throw Error("First live image did not render its expected design");
    }
    await inspect(1);
    stage = "duplicate-svg-get";
    const two = await send(fetchImpl, origin, image + "?livecheck=second",
      { svg: true, localIp: ip });
    if (two.status !== 200) throw Error("Repeat SVG GET failed");
    await inspect(1);
    stage = "update-without-reset";
    const updated = await requireJson(await admin(details + "/design", {
      method: "POST", body: { design: updatedDesign }
    }), 200);
    if (updated.slug !== slug || updated.updated !== true) {
      throw Error("Design update was not confirmed");
    }
    await inspect(1);
    stage = "updated-svg-visible";
    const finalImage = await send(fetchImpl, origin, image + "?livecheck=updated",
      { svg: true, localIp: ip });
    if (finalImage.status !== 200 ||
        !(await finalImage.text()).includes("LIVE CHECK UPDATED")) {
      throw Error("Updated SVG was not served");
    }
    await inspect(1);
  } catch {
    // A remote request can succeed at D1 and fail before returning a response.
    // Keep the slug discoverable; NEVER repeat the create automatically.
    throw Error("Live check stopped at " + stage +
      (created || attemptedWrite ? "; diagnostic counter slug: " + slug +
      " (it may persist; do not rerun blindly)" : "") +
      ". Credentials and server error bodies were not logged");
  }
  return {
    schemaVersion: 1,
    kind: "workshop-visitor-terminal-live-check",
    runtime: usingLocalTest ? "LOCAL_INTEGRATION" : "REMOTE_SELF_HOST",
    result: "PASS",
    diagnosticCounter: slug,
    diagnosticCounterPersists: true,
    observed: {
      remoteD1Create: "PASS",
      svgHeadNoCount: "PASS",
      firstSvgGetIncrements: "PASS",
      sameClientRequestDeduplication: "PASS",
      designUpdatePreservesCount: "PASS",
      updatedSvgRendered: "PASS"
    },
    independentCloudflareAccountOwnership: "NOT_VERIFIED",
    billingIsolation: "NOT_VERIFIED",
    note: "A permanent test counter and qualifying D1 receipt remain in this self-hosted instance. No deploy, migration or account change was performed."
  };
}

async function main() {
  try {
    const args = parseLiveArgs(process.argv.slice(2));
    if (args.help) { process.stdout.write(HELP); return; }
    const result = await runLiveCheck(args);
    if (args.report) await writeReadinessReport(result, args.report);
    process.stdout.write("PASS: " + result.runtime + " counter create, HEAD, " +
      "one qualifying GET, same-client deduplication and design update.\n" +
      "Permanent diagnostic counter: " + result.diagnosticCounter + "\n" +
      "Direct SVG URL: " + createReadmeSnippet(args.api, result.diagnosticCounter).url + "\n" +
      "GitHub README (copy the entire line):\n" +
      createReadmeSnippet(args.api, result.diagnosticCounter).markdown + "\n" +
      "This diagnostic is NOT the illustrative my-counter slug. Do not change the slug.\n" +
      "Cloudflare account ownership and billing isolation still require manual confirmation.\n" +
      (args.report ? "Sanitized live-check report saved without overwrite.\n" : ""));
  } catch (error) {
    // Only controlled internal messages may be shown; never fetch error bodies,
    // token values, Cloudflare account data or raw network stack traces.
    process.stderr.write(
      "Live self-host check failed: " +
      (error instanceof Error ? error.message : "Unknown error") + "\n"
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
