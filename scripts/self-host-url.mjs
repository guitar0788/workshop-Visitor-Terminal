#!/usr/bin/env node
/**
 * Offline Worker URL recovery for testers who confuse their Worker name with
 * the account-level workers.dev subdomain. No DNS, Cloudflare API, D1 reads,
 * secrets, deploys, and never an inferred counter slug.
 */
import { readFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "./self-host-setup.mjs";
import { validateApiOrigin } from "./self-host-publish.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const HELP = [
  "Reconstruct your own workers.dev URL OFFLINE from your private Worker config.",
  "  node scripts/self-host-url.mjs --account-subdomain YOUR_ACCOUNT_SUBDOMAIN",
  "  node scripts/self-host-url.mjs --account-subdomain YOUR_ACCOUNT_SUBDOMAIN --slug YOUR_EXISTING_COUNTER_SLUG",
  "Find the account's workers.dev subdomain in the Cloudflare dashboard.",
  "It is NOT your D1 database name. A repeated Worker/account label is normal.",
  "This tool does not discover Cloudflare ownership, query counters or contact a network."
].join("\n") + "\n";

export function parseUrlArgs(argv) {
  if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) return { help: true };
  if (argv.length === 0 || argv.length % 2) {
    throw Error("Provide --account-subdomain and optionally --slug (see --help)");
  }
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    const value = argv[i + 1];
    if (!["account-subdomain", "slug"].includes(key) || Object.hasOwn(args, key) ||
        !value || value.startsWith("--")) {
      throw Error("Unknown, duplicate or incomplete URL option");
    }
    args[key] = value;
  }
  if (!SUBDOMAIN.test(args["account-subdomain"] ?? "") ||
      args["account-subdomain"].includes("--") ||
      !args["account-subdomain"] || args["account-subdomain"].length > 63) {
    throw Error("Provide only the Cloudflare account workers.dev subdomain label, not a URL");
  }
  if (args.slug !== undefined && !SLUG.test(args.slug)) {
    throw Error("Invalid counter slug; never guess it from a D1 or Worker name");
  }
  return args;
}

export function makeOwnOrigin(worker, accountSubdomain) {
  if (!SUBDOMAIN.test(worker) || worker.includes("--") ||
      !SUBDOMAIN.test(accountSubdomain) || accountSubdomain.includes("--")) {
    throw Error("Invalid Worker or account subdomain");
  }
  return validateApiOrigin("https://" + worker + "." + accountSubdomain + ".workers.dev");
}

export async function inspectLocalOrigin(args, {
  root = ROOT,
  read = readFile,
  environment = process.env
} = {}) {
  if (args.help) return HELP;
  const config = validateConfig(await read(join(root, "wrangler.selfhost.toml"), "utf8"));
  const origin = makeOwnOrigin(config.worker, args["account-subdomain"]);
  // Prevent a stale WVT_API_URL from silently directing subsequent authenticated
  // commands to a different Worker; never contact either destination.
  if (environment.WVT_API_URL && environment.WVT_API_URL !== origin &&
      environment.WVT_API_URL !== origin + "/") {
    throw Error("WVT_API_URL differs from the locally reconstructed Worker URL; verify your Cloudflare dashboard before continuing");
  }
  const lines = [
    "OFFLINE ONLY: no Cloudflare/D1/GitHub requests, credentials or writes.",
    "Worker name (from local private config): " + config.worker,
    "Account workers.dev subdomain (user-supplied): " + args["account-subdomain"],
    "Full Worker origin: " + origin,
    "The D1 database name is NOT a hostname component.",
    "Identical Worker and account labels can appear twice. This is normal.",
    "Check the complete origin in your own Cloudflare dashboard; local reconstruction cannot verify account ownership."
  ];
  if (args.slug) {
    const svg = origin + "/v1/counters/" + args.slug + ".svg";
    lines.push(
      "Existing counter slug (user-supplied, NOT discovered): " + args.slug,
      "Direct SVG: " + svg,
      "GitHub README Markdown: ![Visitor counter](" + svg + ")",
      "An offline URL is NOT proof that this counter exists. A 404/Counter not found means verify the real slug and D1 resource first."
    );
  } else {
    lines.push(
      "No slug supplied: no SVG URL was invented.",
      "To recover slugs on a NEW self-host Worker, use the authenticated read-only command below (D1 reads may incur usage):",
      "node scripts/self-host-publish.mjs list --api " + origin + " --token-file .wvt-admin-token",
      "Existing Workers without the opt-in list endpoint return HTTP 405; do not redeploy or recreate counters automatically."
    );
  }
  return lines.join("\n") + "\n";
}

async function main() {
  try {
    const args = parseUrlArgs(process.argv.slice(2));
    process.stdout.write(await inspectLocalOrigin(args));
  } catch {
    // No raw private config, dashboard identifiers, token or path in errors.
    process.stderr.write("Offline Worker URL recovery failed. Check your private self-host config and exact Cloudflare account workers.dev subdomain. No remote request was made.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
