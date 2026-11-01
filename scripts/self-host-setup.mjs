#!/usr/bin/env node
/**
 * No-cloud setup helper. Creates a private local Wrangler config and two
 * independent random secrets. NEVER logs in, contacts Cloudflare or deploys.
 */
import { randomBytes, randomInt } from "node:crypto";
import { readFile, writeFile, stat, rm } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["wrangler.selfhost.toml", ".wvt-admin-token", ".wvt-visit-secret"];
const WORKER_NAME = /^[a-z](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const DB_NAME = /^[a-z][a-z0-9_-]{2,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HELP = [
  "Self-host setup (no Cloudflare requests are made):",
  "  node scripts/self-host-setup.mjs init --worker YOUR_UNIQUE_WORKER --database YOUR_NEW_D1 --database-id YOUR_D1_UUID",
  "  node scripts/self-host-setup.mjs check",
  "Creates ignored wrangler.selfhost.toml and two private random secret files.",
  "After checking, YOU explicitly run Wrangler migrations, deploy and secret upload."
].join("\n") + "\n";

export function parseSetupArgs(argv) {
  if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) return { command: "help" };
  if (argv.length === 1 && argv[0] === "check") return { command: "check" };
  if (argv[0] !== "init" || argv.length !== 7) throw Error("Expected init with --worker, --database, --database-id (or check/--help)");
  const result = { command: "init" };
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!["--worker", "--database", "--database-id"].includes(flag) ||
        Object.hasOwn(result, flag.slice(2)) || !argv[i + 1]) {
      throw Error("Unknown or repeated setup option");
    }
    result[flag.slice(2)] = argv[i + 1];
  }
  validateNames(result);
  return result;
}

export function validateNames(options) {
  if (!WORKER_NAME.test(options.worker ?? "") ||
      options.worker.includes("--") ||
      options.worker === "workshop-visitor-terminal-staging" ||
      !DB_NAME.test(options.database ?? "") ||
      !UUID.test(options["database-id"] ?? "") ||
      /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(options["database-id"] ?? "")) {
    throw Error("Choose a unique lowercase Worker name, new D1 name, and a genuine D1 UUID");
  }
  return options;
}

export function makeConfig(template, options, namespaces) {
  validateNames(options);
  if (!Array.isArray(namespaces) || namespaces.length !== 2 ||
      namespaces.some(x => !Number.isSafeInteger(x) || x < 1 || x > 2147483647) ||
      namespaces[0] === namespaces[1]) {
    throw Error("Two different positive Cloudflare namespace IDs are required");
  }
  const expected = [
    'name = "REPLACE_WITH_YOUR_UNIQUE_WORKER_NAME"',
    'database_name = "REPLACE_WITH_YOUR_NEW_D1_DATABASE_NAME"',
    'database_id = "REPLACE_WITH_YOUR_NEW_D1_DATABASE_ID"',
    'namespace_id = "1001"',
    'namespace_id = "1002"'
  ];
  for (const marker of expected) {
    if (template.split(marker).length !== 2) throw Error("Unexpected self-host template layout");
  }
  let result = template
    .replace(expected[0], 'name = "' + options.worker + '"')
    .replace(expected[1], 'database_name = "' + options.database + '"')
    .replace(expected[2], 'database_id = "' + options["database-id"] + '"')
    .replace(expected[3], 'namespace_id = "' + namespaces[0] + '"')
    .replace(expected[4], 'namespace_id = "' + namespaces[1] + '"');
  validateConfig(result);
  return result;
}

export function validateConfig(contents) {
  if (typeof contents !== "string" || contents.length > 20_000) {
    throw Error("Self-host Wrangler configuration is incomplete or unsafe");
  }
  const values = pattern => [...contents.matchAll(pattern)].map(match => match[1]);
  const occurrences = (pattern, count = 1) =>
    (contents.match(pattern) ?? []).length === count;
  const names = values(/^name = "([^"]+)"$/gm);
  const dbs = values(/^database_name = "([^"]+)"$/gm);
  const ids = values(/^database_id = "([^"]+)"$/gm);
  const ns = values(/^namespace_id = "([^"]+)"$/gm);
  const rateBlocks = contents.split(/^\[\[ratelimits\]\]$/m);
  const rateLimits = rateBlocks.slice(1).map(block => {
    const simple = block.match(/^\[ratelimits\.simple\]([\s\S]*?)(?=^\[|$)/m)?.[1];
    return {
      limit: simple?.match(/^limit = (\d+)$/m)?.[1],
      period: simple?.match(/^period = (\d+)$/m)?.[1]
    };
  });
  if (names.length !== 3 ||
      !WORKER_NAME.test(names[0]) || names[0].includes("--") ||
      names[0] === "workshop-visitor-terminal-staging" ||
      names[1] !== "SVG_RATE_LIMITER" ||
      names[2] !== "SVG_GLOBAL_RATE_LIMITER" ||
      dbs.length !== 1 || !DB_NAME.test(dbs[0]) ||
      ids.length !== 1 || !UUID.test(ids[0]) ||
      /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(ids[0]) ||
      ns.length !== 2 || ns.some(x =>
        !/^[1-9][0-9]*$/.test(x) || Number(x) > 2147483647) ||
      ns[0] === ns[1] ||
      !occurrences(/^\[\[d1_databases\]\]$/gm) ||
      !occurrences(/^\[vars\]$/gm) ||
      !occurrences(/^\[triggers\]$/gm) ||
      !occurrences(/^\[\[ratelimits\]\]$/gm, 2) ||
      !occurrences(/^\[ratelimits\.simple\]$/gm, 2) ||
      !occurrences(/^main = "worker\/index\.ts"$/gm) ||
      !occurrences(/^workers_dev = true$/gm) ||
      !occurrences(/^binding = "DB"$/gm) ||
      !occurrences(/^migrations_dir = "worker\/migrations"$/gm) ||
      !occurrences(/^PUBLISHING_ENABLED = "false"$/gm) ||
      !occurrences(/^SVG_RATE_LIMIT_ENABLED = "true"$/gm) ||
      !occurrences(/^crons = \["17 \* \* \* \*"\]$/gm) ||
      !occurrences(/^limit = \d+$/gm, 2) ||
      !occurrences(/^period = \d+$/gm, 2) ||
      rateLimits.length !== 2 ||
      rateLimits[0].limit !== "60" || rateLimits[0].period !== "60" ||
      rateLimits[1].limit !== "120" || rateLimits[1].period !== "60" ||
      /REPLACE_WITH_|STAGING_D1_|fangcui2007|GITHUB_CLIENT_SECRET|PILOT_GITHUB_USER_ID/i.test(contents)) {
    throw Error("Self-host Wrangler configuration is incomplete or unsafe");
  }
  return { worker: names[0], database: dbs[0], databaseId: ids[0] };
}

function strongSecret(value) {
  return typeof value === "string" && /^[0-9a-f]{96}$/.test(value.trim());
}

async function exists(path) {
  try { await stat(path); return true; }
  catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function initialize(options, { root = ROOT, randomNamespace = () => randomInt(1_000_000, 2_000_000_000), secretBytes = () => randomBytes(48).toString("hex") } = {}) {
  validateNames(options);
  // Refuse partial setup or overwriting ANY credential/config, even if it was
  // created by a previous unsuccessful manual invocation.
  if ((await Promise.all(FILES.map(f => exists(join(root, f))))).some(Boolean)) {
    throw Error("Self-host setup already exists or is partial. No file was replaced; inspect it manually.");
  }
  const template = await readFile(join(root, "wrangler.selfhost.example.toml"), "utf8");
  const first = randomNamespace();
  let second = randomNamespace();
  for (let i = 0; second === first && i < 16; i++) second = randomNamespace();
  const config = makeConfig(template, options, [first, second]);
  const adminToken = secretBytes(), visitSecret = secretBytes();
  if (!strongSecret(adminToken) || !strongSecret(visitSecret) || adminToken === visitSecret) {
    throw Error("Unsafe secret generation; no files created");
  }
  const contents = [config, adminToken + "\n", visitSecret + "\n"];
  const created = [];
  try {
    for (let i = 0; i < FILES.length; i++) {
      const path = join(root, FILES[i]);
      await writeFile(path, contents[i], { flag: "wx", mode: 0o600 });
      created.push(path);
    }
  } catch {
    // Only remove paths created by this invocation; never touch existing files.
    for (const path of created) await rm(path, { force: true });
    throw Error("Setup could not finish; existing files were preserved");
  }
  return { worker: options.worker, database: options.database };
}

export async function checkSetup({ root = ROOT } = {}) {
  const config = validateConfig(await readFile(join(root, FILES[0]), "utf8"));
  const admin = await readFile(join(root, FILES[1]), "utf8");
  const visit = await readFile(join(root, FILES[2]), "utf8");
  if (!strongSecret(admin) || !strongSecret(visit) || admin.trim() === visit.trim()) {
    throw Error("Missing, identical, or malformed local secret files");
  }
  return { worker: config.worker, database: config.database };
}

async function main() {
  try {
    const args = parseSetupArgs(process.argv.slice(2));
    if (args.command === "help") { process.stdout.write(HELP); return; }
    const result = args.command === "check" ? await checkSetup() : await initialize(args);
    process.stdout.write("PASS: local self-host " + (args.command === "init" ? "setup" : "configuration") +
      " for Worker " + result.worker + " and D1 " + result.database +
      ". No remote changes. Confirm your Cloudflare account before running Wrangler.\n");
  } catch (error) {
    process.stderr.write("Self-host setup stopped: " +
      (error instanceof Error ? error.message : "Unexpected error") + "\n");
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
