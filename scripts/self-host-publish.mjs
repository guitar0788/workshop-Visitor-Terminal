#!/usr/bin/env node
/**
 * Publish an offline Workshop Studio JSON design to YOUR own Worker.
 * The administrator token stays in the local environment or an ignored file;
 * never embed it in HTML, a GitHub Action, a URL, or a public README.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSelfHostApi } from "./self-host-api.mjs";
import { validateConfig } from "./self-host-setup.mjs";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const ALLOWED_OPTIONS = new Set(["api", "slug", "owner", "design", "token-file"]);
const DENIED_HOSTS = new Set([
  "workshop-visitor-terminal-staging.fangcui2007.workers.dev",
  "guitar0788.github.io"
]);
const MAX_DESIGN_FILE_BYTES = 20_000;
const HELP = `Workshop Visitor Terminal — self-hosted counter publisher
Usage:
  node scripts/self-host-publish.mjs create --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug my-counter --owner YOUR_GITHUB_NAME --design visitor-terminal.design.json [--token-file .wvt-admin-token]
  node scripts/self-host-publish.mjs update --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug my-counter --design visitor-terminal.design.json [--token-file .wvt-admin-token]
  node scripts/self-host-publish.mjs inspect --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug my-counter [--token-file .wvt-admin-token]

Set WVT_API_URL once in the terminal to omit repeated --api on macOS/Linux/Windows.
Use an administrator token stored in WVT_ADMIN_TOKEN or an ignored --token-file.
Never use the repository owner's staging Worker or expose this token in a browser.
The CLI runs three unauthenticated safety checks before it reads/sends the token.
`;

export function parseArgs(argv, environment = process.env) {
  if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) return { command: "help" };
  const [command, ...rest] = argv;
  if (!["create", "update", "inspect"].includes(command)) throw Error("Expected create, update, inspect or --help");
  if (rest.length % 2 !== 0) throw Error("Every option must have a value");
  const options = { command };
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i].startsWith("--") ? rest[i].slice(2) : "";
    const value = rest[i + 1];
    if (!ALLOWED_OPTIONS.has(name) || !value || value.startsWith("--") || Object.hasOwn(options, name)) {
      throw Error("Unknown, duplicate or incomplete option");
    }
    options[name] = value;
  }
  options.api = resolveSelfHostApi(options.api, environment);
  if (!options.slug || !SLUG.test(options.slug)) {
    throw Error("Provide a valid lowercase --slug (1–40 characters)");
  }
  if (command === "create" && (!options.owner || !OWNER.test(options.owner))) {
    throw Error("Create requires a valid --owner GitHub login");
  }
  if (command === "create" || command === "update") {
    if (!options.design) throw Error("Create and update require --design JSON path");
  }
  if (command !== "create" && options.owner) throw Error("--owner is only accepted for create");
  if (command === "inspect" && options.design) throw Error("--design is not accepted for inspect");
  return options;
}

export function validateApiOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { throw Error("Invalid --api URL"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!((url.protocol === "https:") || (local && url.protocol === "http:")) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      DENIED_HOSTS.has(url.hostname.toLowerCase()) ||
      !url.hostname || url.hostname.endsWith(".")) {
    throw Error("--api must be the root HTTPS origin of YOUR Worker (HTTP allowed only on loopback)");
  }
  return url.origin;
}

/**
 * For workers.dev URLs, compare the first hostname label with the generated
 * local Worker configuration whenever it exists. This cannot prove Cloudflare
 * account ownership, but prevents common wrong-Worker typos before any secret
 * is read or sent. Custom domains must be verified by the operator.
 */
export async function assertLocalWorkerHostname(origin, {
  configPath = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    "wrangler.selfhost.toml")
} = {}) {
  let config;
  try {
    config = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw Error("Could not inspect private local Worker configuration");
  }
  let name;
  try {
    name = validateConfig(config).worker;
  } catch {
    throw Error("Local self-host configuration is invalid; refusing remote administration");
  }
  const hostname = new URL(origin).hostname.toLowerCase();
  if (hostname.endsWith(".workers.dev")) {
    const labels = hostname.split(".");
    if (labels.length !== 4 || labels[0] !== name) {
      throw Error("Worker hostname does not match the private local self-host configuration");
    }
  }
  return true;
}

export async function readDesign(path) {
  const file = await readFile(path);
  if (file.byteLength > MAX_DESIGN_FILE_BYTES) throw Error("Design JSON exceeds 20 KB");
  let parsed;
  try { parsed = JSON.parse(file.toString("utf8")); }
  catch { throw Error("Design file is not valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
      parsed.schemaVersion !== 1 || !Array.isArray(parsed.layers)) {
    throw Error("Expected Studio's exported schemaVersion:1 design JSON");
  }
  // The server performs the authoritative sanitizeDesign validation.
  const payload = JSON.stringify({ design: parsed });
  if (Buffer.byteLength(payload) > MAX_DESIGN_FILE_BYTES) {
    throw Error("Design exceeds the Worker's 20 KB JSON request limit");
  }
  return parsed;
}

export async function readAdminToken({ tokenFile, environment = process.env }) {
  const fromFile = tokenFile ? (await readFile(tokenFile, "utf8")).trim() : "";
  const token = tokenFile ? fromFile : environment.WVT_ADMIN_TOKEN;
  if (typeof token !== "string" || token.length < 32 || token.length > 512 ||
      !/^[\x21-\x7e]+$/.test(token)) {
    throw Error("Provide a nonempty 32+ character administrator token in WVT_ADMIN_TOKEN or --token-file");
  }
  return token;
}

/**
 * Authenticate the service type BEFORE reading or transmitting any token.
 * This is a compatibility/safety gate, not cryptographic proof of hostname
 * ownership: a malicious server could imitate these unauthenticated replies.
 * Users must still verify their Cloudflare target in the dashboard.
 */
export async function assertSafePublishingTarget(origin, fetchImpl = fetch) {
  const checks = [
    { path: "/health", status: 200, matches: data =>
      data.status === "ok" && data.service === "workshop-visitor-terminal" &&
      data.api === "v1" },
    { path: "/v1/my/counters", status: 503, matches: data =>
      data.error === "Publishing is not enabled" },
    { path: "/v1/admin/usage", status: 401, matches: data =>
      data.error === "Unauthorized" }
  ];
  for (const { path, status, matches } of checks) {
    let response;
    try {
      response = await fetchImpl(origin + path, {
        method: "GET", redirect: "error",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000)
      });
    } catch {
      throw Error("Public Worker safety preflight failed: unreachable or redirected");
    }
    if (!(response instanceof Response) || response.status !== status ||
        !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw Error("Public Worker safety preflight failed at " + path);
    }
    let data;
    try {
      const body = await response.text();
      if (body.length > 4096) throw Error("Oversized preflight JSON");
      data = JSON.parse(body);
    } catch {
      throw Error("Public Worker safety preflight returned invalid JSON at " + path);
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || !matches(data)) {
      throw Error("Public Worker safety preflight returned unsafe identity at " + path);
    }
  }
  return true;
}

async function requestJson(origin, token, path, method, payload, fetchImpl) {
  const response = await fetchImpl(origin + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(payload === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    // A redirect must never forward the private token to a new destination.
    redirect: "error",
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) {
    throw Error(`Worker rejected ${method} ${path}: HTTP ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw Error("Worker returned an unexpected content type");
  }
  const data = await response.json();
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw Error("Worker returned malformed JSON");
  }
  return data;
}

export async function execute(options, { fetchImpl = fetch, environment = process.env } = {}) {
  if (options.command === "help") return HELP;
  const origin = validateApiOrigin(resolveSelfHostApi(options.api, environment));
  await assertLocalWorkerHostname(origin);
  await assertSafePublishingTarget(origin, fetchImpl);
  const token = await readAdminToken({ tokenFile: options["token-file"], environment });
  const slug = options.slug;
  const resource = `/v1/admin/counters/${slug}`;
  if (options.command === "inspect") {
    const data = await requestJson(origin, token, resource, "GET", undefined, fetchImpl);
    if (data.slug !== slug || !Number.isSafeInteger(data.hits)) throw Error("Counter identity or count mismatch");
    return `Counter: ${slug}\nRecorded upstream requests: ${data.hits}\n`;
  }
  const design = await readDesign(options.design);
  if (options.command === "create") {
    const created = await requestJson(origin, token, "/v1/admin/counters", "POST",
      { slug, owner: options.owner }, fetchImpl);
    if (created.slug !== slug) throw Error("Created counter identity mismatch");
  }
  try {
    const updated = await requestJson(origin, token, resource + "/design", "POST", { design }, fetchImpl);
    if (updated.slug !== slug || updated.updated !== true) throw Error("Design update not confirmed");
  } catch {
    throw Error(options.command === "create"
      ? `Counter ${slug} may have been created, but design upload was not confirmed. Retry with update (do NOT re-create).`
      : `Design update for ${slug} failed. The previous stored design is unchanged or needs verification.`);
  }
  const url = `${origin}/v1/counters/${slug}.svg`;
  return `Counter ready: ${url}\nGitHub README:\n![Visitor counter](${url})\nNote: actual upstream image requests, not unique profile visitors.\n`;
}

async function main() {
  try {
    process.stdout.write(await execute(parseArgs(process.argv.slice(2))));
  } catch (error) {
    // Never print URLs from untrusted responses, bearer tokens, request bodies,
    // network stack traces or the user's private design JSON.
    process.stderr.write(`Self-host publish failed: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
