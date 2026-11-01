#!/usr/bin/env node
/**
 * Read-only verification of a self-hosted dynamic SVG Worker.
 *
 * The administrator token is sent ONLY to the explicitly provided validated
 * origin, via HTTPS (or loopback HTTP for local integration tests). Redirects
 * are forbidden. All probes are GET or HEAD: no visits or D1 writes.
 * Never use this for the repository owner's staging Worker.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAdminToken, validateApiOrigin, assertLocalWorkerHostname } from "./self-host-publish.mjs";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const HELP = [
  "Verify your OWN Cloudflare Worker (read-only, no counter increments):",
  "  node scripts/self-host-verify.mjs --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --token-file .wvt-admin-token",
  "  node scripts/self-host-verify.mjs --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --token-file .wvt-admin-token --slug my-counter",
  "Also accepts WVT_ADMIN_TOKEN instead of --token-file.",
  "Never pass secrets via CLI arguments, and do not use the maintainer staging origin."
].join("\n") + "\n";

export function parseVerifyArgs(argv) {
  if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) return { help: true };
  if (argv.length === 0 || argv.length % 2 !== 0) {
    throw Error("Expected --api, optional --token-file, optional --slug");
  }
  const args = {};
  const allowed = new Set(["api", "token-file", "slug"]);
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    if (!allowed.has(key) || Object.hasOwn(args, key) ||
        !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw Error("Unknown, repeated, or incomplete verification argument");
    }
    args[key] = argv[i + 1];
  }
  if (!args.api) throw Error("Provide your own --api Worker URL");
  validateApiOrigin(args.api);
  if (args.slug !== undefined && !SLUG.test(args.slug)) {
    throw Error("Invalid --slug");
  }
  return args;
}

function jsonRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateUsage(value) {
  if (!jsonRecord(value) ||
      typeof value.utcDay !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.utcDay) ||
      !Number.isSafeInteger(value.admitted) || value.admitted < 0 ||
      value.maxDailyAdmitted !== 20_000 || value.admitted > 20_000 ||
      value.remaining !== 20_000 - value.admitted ||
      value.edgeRateLimitsEnabled !== true ||
      value.edgeLimitPerMinutePerCounter !== 60 ||
      value.edgeLimitPerMinutePerLocation !== 120) {
    throw Error("D1 daily budget or SVG rate limits are missing, disabled, or unexpected");
  }
  return { utcDay: value.utcDay, admitted: value.admitted, remaining: value.remaining };
}

async function probe(fetchImpl, origin, path, { method = "GET", token } = {}) {
  let response;
  try {
    response = await fetchImpl(origin + path, {
      method,
      redirect: "error",
      cache: "no-store",
      headers: {
        Accept: method === "HEAD" ? "image/svg+xml" : "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {})
      },
      signal: AbortSignal.timeout(12000)
    });
  } catch {
    // A thrown fetch error may contain the Authorization header, URL or a
    // remote response body. Never print or rethrow its raw message.
    throw Error("Worker connection failed or attempted a forbidden redirect");
  }
  if (!(response instanceof Response)) throw Error("Unexpected Worker response");
  return response;
}

async function checkedJson(response, expected, stage) {
  if (response.status !== expected) {
    throw Error(stage + " returned HTTP " + response.status + " instead of " + expected);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw Error(stage + " is not JSON");
  }
  try {
    const parsed = await response.json();
    if (!jsonRecord(parsed)) throw Error("Malformed response");
    return parsed;
  } catch {
    throw Error(stage + " returned invalid JSON");
  }
}

export async function verifySelfHost(args, {
  fetchImpl = fetch,
  environment = process.env,
  makeProbeSlug = () => "probe-" + randomBytes(12).toString("hex")
} = {}) {
  if (args.help) return HELP;
  const origin = validateApiOrigin(args.api);
  await assertLocalWorkerHostname(origin);
  // Read the secret only after checking the destination. Never send the
  // credential to the maintainer staging API, even if explicitly requested.
  const token = await readAdminToken({
    tokenFile: args["token-file"], environment
  });

  const health = await checkedJson(
    await probe(fetchImpl, origin, "/health"), 200, "Health");
  if (health.status !== "ok" ||
      health.service !== "workshop-visitor-terminal" || health.api !== "v1") {
    throw Error("Unexpected Worker identity at /health");
  }

  // Public GitHub OAuth registration MUST remain disabled for self-hosting.
  const oauth = await checkedJson(
    await probe(fetchImpl, origin, "/v1/my/counters"), 503, "Publishing gate");
  if (oauth.error !== "Publishing is not enabled") {
    throw Error("OAuth publishing is not safely disabled");
  }

  const anonymous = await checkedJson(
    await probe(fetchImpl, origin, "/v1/admin/usage"), 401, "Anonymous admin");
  if (anonymous.error !== "Unauthorized") {
    throw Error("Admin access is not safely restricted");
  }

  const usage = validateUsage(await checkedJson(
    await probe(fetchImpl, origin, "/v1/admin/usage", { token }),
    200, "Authenticated budget"));

  // HEAD never inserts visit receipts or changes counts. A random slug
  // does not touch a user's existing counter. When provided explicitly,
  // ensure the already-published image is reachable.
  const slug = args.slug ?? makeProbeSlug();
  if (!SLUG.test(slug)) throw Error("Generated probe slug was invalid");
  const image = await probe(fetchImpl, origin,
    "/v1/counters/" + slug + ".svg", { method: "HEAD" });
  const expectedStatus = args.slug ? 200 : 404;
  if (image.status !== expectedStatus) {
    throw Error("Read-only SVG HEAD check returned HTTP " + image.status +
      " instead of " + expectedStatus);
  }
  if (args.slug && !image.headers.get("content-type")?.includes("image/svg+xml")) {
    throw Error("Counter HEAD did not return an SVG image");
  }
  return {
    origin,
    checkedSlug: args.slug ?? null,
    budget: usage,
    noDatabaseWrites: true
  };
}

async function main() {
  try {
    const args = parseVerifyArgs(process.argv.slice(2));
    if (args.help) { process.stdout.write(HELP); return; }
    const result = await verifySelfHost(args);
    process.stdout.write(
      "PASS: Self-hosted Worker identity, disabled OAuth, private admin API, " +
      "D1 daily budget, rate limits and non-counting SVG HEAD verified.\n" +
      "UTC day " + result.budget.utcDay + ": " +
      result.budget.admitted + "/20000 admitted, " +
      result.budget.remaining + " remaining.\n" +
      (result.checkedSlug ? "Checked existing SVG: " + result.checkedSlug + "\n" :
        "Checked random, missing SVG with HEAD (expected 404).\n") +
      "No database writes were requested. This does NOT confirm hosting costs or full Cloudflare billing limits.\n"
    );
  } catch (error) {
    process.stderr.write("Self-host verification failed: " +
      (error instanceof Error ? error.message : "Unknown check error") + "\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
