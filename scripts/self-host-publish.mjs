#!/usr/bin/env node
/**
 * Publish an offline Workshop Studio JSON design to YOUR own Worker.
 * The administrator token stays in the local environment or an ignored file;
 * never embed it in HTML, a GitHub Action, a URL, or a public README.
 */
import { readFile, open, writeFile, lstat } from "node:fs/promises";
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
  node scripts/self-host-publish.mjs export --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug my-counter [--token-file .wvt-admin-token] (read-only; save local JSON without overwriting)
  node scripts/self-host-publish.mjs list --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev [--token-file .wvt-admin-token] (read-only; new self-host Worker)

Set WVT_API_URL once in the terminal to omit repeated --api on macOS/Linux/Windows.
Use an administrator token stored in WVT_ADMIN_TOKEN or an ignored --token-file.
Never use the repository owner's staging Worker or expose this token in a browser.
The CLI runs three unauthenticated safety checks before it reads/sends the token.
`;

export function parseArgs(argv, environment = process.env) {
  if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) return { command: "help" };
  const [command, ...rest] = argv;
  if (!["create", "update", "inspect", "list", "export"].includes(command)) throw Error("Expected create, update, inspect, list, export or --help");
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
  options.api = validateApiOrigin(resolveSelfHostApi(options.api, environment));
  if (command === "list") {
    if (options.slug || options.owner || options.design) {
      throw Error("List accepts only --api and optional --token-file");
    }
    return options;
  }
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
  if (["inspect", "export"].includes(command) && options.design) throw Error("--design is not accepted for inspect/export");
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

/**
 * Read at most maxBytes + 1 from a user-selected local file.
 * A malicious or accidentally huge JSON/token file must not be read into
 * memory. Never forward raw filesystem errors that can expose private paths.
 */
async function readBoundedLocalFile(path, maxBytes, kind) {
  let handle;
  try {
    handle = await open(path, "r");
    const buffer = Buffer.alloc(maxBytes + 1);
    let used = 0;
    while (used < buffer.length) {
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
      if (bytesRead === 0) break;
      used += bytesRead;
    }
    return { contents: buffer.subarray(0, used).toString("utf8"), oversized: used > maxBytes };
  } catch {
    throw Error("Could not read local " + kind +
      " file. Check its path and permissions on this device; no file content was transmitted.");
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

export async function readDesign(path) {
  const file = await readBoundedLocalFile(path, MAX_DESIGN_FILE_BYTES, "design JSON");
  if (file.oversized) throw Error("Design JSON exceeds 20 KB");
  let parsed;
  try { parsed = JSON.parse(file.contents); }
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
  const fromFile = tokenFile
    ? await readBoundedLocalFile(tokenFile, 514, "administrator token")
    : null;
  if (fromFile?.oversized) throw Error("Local administrator token file is too large");
  const token = tokenFile ? fromFile.contents.trim() : environment.WVT_ADMIN_TOKEN;
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
  let response;
  try {
    response = await fetchImpl(origin + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(payload === undefined ? {} : { "Content-Type": "application/json" })
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      // Never follow redirects with administrator credentials.
      redirect: "error",
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    // Transport errors can include URLs, request headers, or bearer tokens.
    // Never rethrow or print an untrusted fetch exception.
    throw Error("Authenticated Worker connection failed or redirect was blocked");
  }
  if (!(response instanceof Response)) {
    throw Error("Worker returned an invalid HTTP response");
  }
  if (!response.ok) {
    throw Error(`Worker rejected ${method} ${path}: HTTP ${response.status}`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw Error("Worker returned an unexpected content type");
  }
  let data;
  try {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 20_000) {
      throw Error("Oversized authenticated response");
    }
    data = JSON.parse(body);
  } catch {
    // Never surface a remote JSON body or a parser exception in CLI logs.
    throw Error("Worker returned invalid or oversized authenticated JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw Error("Worker returned malformed JSON");
  }
  return data;
}

/**
 * Only a whitelisted, canonical Studio schema may be restored to a local file.
 * Untrusted Worker JSON can include unexpected metadata; never serialize it.
 */
export function validateExportDesign(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.schemaVersion !== 1 || typeof value.theme !== "string" ||
      !Number.isSafeInteger(value.width) || value.width < 280 || value.width > 800 ||
      !Number.isSafeInteger(value.height) || value.height < 160 || value.height > 480 ||
      !/^#[0-9a-fA-F]{6}$/.test(value.background ?? "") ||
      !/^#[0-9a-fA-F]{6}$/.test(value.accent ?? "") ||
      !Array.isArray(value.layers) || value.layers.length > 32) {
    throw Error("Worker returned an invalid saved Studio design");
  }
  const ids = new Set();
  const layers = value.layers.map(layer => {
    if (!layer || typeof layer !== "object" || Array.isArray(layer) ||
        typeof layer.id !== "string" || !/^[a-zA-Z0-9_-]{1,48}$/.test(layer.id) ||
        ids.has(layer.id) ||
        !["text", "count", "dot", "panel"].includes(layer.kind) ||
        ![layer.x,layer.y,layer.width,layer.height,layer.fontSize].every(Number.isSafeInteger) ||
        layer.width < 8 || layer.width > value.width ||
        layer.height < 8 || layer.height > value.height ||
        layer.x < 0 || layer.x + layer.width > value.width ||
        layer.y < 0 || layer.y + layer.height > value.height ||
        layer.fontSize < 8 || layer.fontSize > 80 ||
        typeof layer.text !== "string" || layer.text.length > 120 ||
        typeof layer.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(layer.color) ||
        typeof layer.visible !== "boolean") {
      throw Error("Worker returned an invalid saved Studio design layer");
    }
    ids.add(layer.id);
    return {
      id: layer.id, kind: layer.kind, x: layer.x, y: layer.y,
      width: layer.width, height: layer.height, text: layer.text,
      fontSize: layer.fontSize, color: layer.color, visible: layer.visible
    };
  });
  return {
    schemaVersion: 1, theme: value.theme, width: value.width,
    height: value.height, background: value.background,
    accent: value.accent, layers
  };
}

const BACKUP_EXISTS = "Local design backup already exists; no file was overwritten. Move the existing backup before exporting again.";

function exportFileName(slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    throw Error("Invalid counter slug for local design recovery");
  }
  return "visitor-terminal-" + slug + ".design.json";
}

/** Reject unnecessary remote requests if the local output is already occupied. */
export async function assertExportDestinationAvailable(slug, { directory = process.cwd() } = {}) {
  const fileName = exportFileName(slug);
  let occupied = false;
  try {
    await lstat(join(directory, fileName));
    occupied = true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw Error("Could not inspect local design backup location; no remote request was made.");
    }
  }
  if (occupied) throw Error(BACKUP_EXISTS);
  return fileName;
}

/** Save only into the operator's current directory. Never overwrite any file
 * (including symlinks). Backup data is a Studio design, NOT a D1 export. */
export async function saveExportedDesign(slug, design, { directory = process.cwd() } = {}) {
  const fileName = exportFileName(slug);
  const sanitized = validateExportDesign(design);
  const contents = JSON.stringify(sanitized, null, 2) + "\n";
  if (Buffer.byteLength(contents, "utf8") > MAX_DESIGN_FILE_BYTES) {
    throw Error("Recovered Studio design exceeds the safe 20 KB export limit");
  }
  try {
    await writeFile(join(directory, fileName), contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw Error(BACKUP_EXISTS);
    }
    // Avoid echoing private local directory names or native filesystem errors.
    throw Error("Could not save recovered Studio design in the current directory; no existing file was replaced.");
  }
  return fileName;
}

export async function execute(options, { fetchImpl = fetch, environment = process.env, directory = process.cwd() } = {}) {
  if (options.command === "help") return HELP;
  const origin = validateApiOrigin(resolveSelfHostApi(options.api, environment));
  await assertLocalWorkerHostname(origin);
  // Fail locally before consuming Worker/D1 request quota or reading the token.
  // create/update use the exact JSON already validated here: no re-read race.
  const design = options.command === "create" || options.command === "update"
    ? await readDesign(options.design)
    : null;
  if (options.command === "export") {
    await assertExportDestinationAvailable(options.slug, { directory });
  }
  await assertSafePublishingTarget(origin, fetchImpl);
  const token = await readAdminToken({ tokenFile: options["token-file"], environment });
  if (options.command === "list") {
    const data = await requestJson(origin, token,
      "/v1/admin/counters", "GET", undefined, fetchImpl);
    if (!Array.isArray(data.counters) || data.counters.length > 100 ||
        typeof data.truncated !== "boolean") {
      throw Error("Worker returned an invalid self-host counter list");
    }
    const names = new Set();
    for (const row of data.counters) {
      if (!row || typeof row !== "object" || !SLUG.test(row.slug ?? "") ||
          !Number.isSafeInteger(row.hits) || row.hits < 0 ||
          row.hits > 999_999_999_999 || names.has(row.slug)) {
        throw Error("Worker returned an invalid or duplicate counter entry");
      }
      names.add(row.slug);
    }
    const lines = data.counters.map(row =>
      row.slug + ": " + row.hits + " upstream requests\n" +
      "![Visitor counter](" + origin + "/v1/counters/" + row.slug + ".svg)");
    return "Existing counters (read-only, no visit increments):\n" +
      (lines.length ? lines.join("\n") : "None found.") + "\n" +
      (data.truncated ? "Showing first 100 only; inspect a known slug for details.\n" : "") +
      "Worker URLs are derived from your confirmed origin; remote rendering is NOT verified.\n";
  }
  const slug = options.slug;
  const resource = `/v1/admin/counters/${slug}`;
  if (options.command === "inspect") {
    const data = await requestJson(origin, token, resource, "GET", undefined, fetchImpl);
    if (data.slug !== slug || !Number.isSafeInteger(data.hits)) throw Error("Counter identity or count mismatch");
    return `Counter: ${slug}\nRecorded upstream requests: ${data.hits}\n`;
  }
  if (options.command === "export") {
    // Dedicated authenticated GET; never issue a public SVG GET (which counts
    // visits), mutate D1 or rely on the optional list endpoint.
    const data = await requestJson(origin, token, resource + "/design", "GET", undefined, fetchImpl);
    if (data.slug !== slug) throw Error("Recovered counter identity mismatch");
    const fileName = await saveExportedDesign(slug, data.design, { directory });
    return "Saved existing Studio design locally: " + fileName + "\n" +
      "No remote counter or visit was modified. The backup contains only the design, not counts or D1 records.\n" +
      "Open it using Studio's Import JSON. Existing local backups are never replaced.\n";
  }
  if (options.command === "create") {
    try {
      const created = await requestJson(origin, token, "/v1/admin/counters", "POST",
        { slug, owner: options.owner }, fetchImpl);
      if (created.slug !== slug) throw Error("Created counter identity mismatch");
    } catch (error) {
      // A D1 insert can commit even when its HTTP response is lost. Do not
      // suggest a blind second create, which could produce duplicate records.
      const reason = error instanceof Error ? error.message : "unconfirmed response";
      throw Error("Counter " + slug + " creation was not confirmed (" + reason +
        "). It may already exist. Inspect this slug before attempting create again.");
    }
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
