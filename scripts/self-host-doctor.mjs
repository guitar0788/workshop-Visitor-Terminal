#!/usr/bin/env node
/**
 * Offline self-host diagnosis: combine the existing local readiness gate,
 * private Worker configuration, known counter slug or already-saved receipt,
 * and an optional local README audit. No subprocess, network, D1 or writes.
 *
 * This tool never asserts that a remote Worker, counter or GitHub image works.
 */
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectOfflineReadiness } from "./self-host-readiness.mjs";
import { checkSetup } from "./self-host-setup.mjs";
import { parseUrlArgs, makeOwnOrigin } from "./self-host-url.mjs";
import { recoverReadmeSnippet, auditReadmeFile } from "./self-host-readme.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_JSON = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9._-]+\.json$/;
const LOCAL_MARKDOWN = /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9._-]+\.(?:md|markdown)$/i;
const HELP = [
  "Offline self-host doctor. No Cloudflare, D1, DNS, GitHub or deployment calls.",
  "  node scripts/self-host-doctor.mjs",
  "  node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_LABEL",
  "  node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_LABEL --slug KNOWN_COUNTER",
  "  node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_LABEL --report selfhost-live-result.json --readme README.md",
  "This checks local config, private secret separation, locked files, Worker",
  "address, previously saved receipt and README links. It NEVER creates a",
  "counter, changes credentials, edits README, or verifies a real cloud account."
].join("\n") + "\n";

export function parseDoctorArgs(argv) {
  if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) return { help: true };
  if (argv.length % 2 !== 0) throw Error("Options must be pairs (see --help)");
  const result = {};
  const allowed = new Set(["account-subdomain", "slug", "report", "readme"]);
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i].startsWith("--") ? argv[i].slice(2) : "";
    const value = argv[i + 1];
    if (!allowed.has(name) || Object.hasOwn(result, name) ||
        !value || value.startsWith("--")) {
      throw Error("Unknown, duplicate or incomplete offline doctor option");
    }
    result[name] = value;
  }
  if (result["account-subdomain"]) {
    parseUrlArgs(["--account-subdomain", result["account-subdomain"],
      ...(result.slug ? ["--slug", result.slug] : [])]);
  } else if (result.slug || result.report || result.readme) {
    throw Error("Provide --account-subdomain before auditing a known counter or receipt");
  }
  if (result.report && !LOCAL_JSON.test(result.report)) {
    throw Error("Receipt must be a relative local .json file under the self-host directory");
  }
  if (result.readme && !LOCAL_MARKDOWN.test(result.readme)) {
    throw Error("README must be a relative local .md/.markdown file");
  }
  if (result.readme && !result.slug && !result.report) {
    throw Error("README audit requires an existing --slug or successful --report");
  }
  return result;
}

export async function inspectSelfHostDoctor(args, {
  root = ROOT,
  environment = process.env,
  nodeVersion = process.versions.node,
  readiness = inspectOfflineReadiness,
  setup = checkSetup,
  recover = recoverReadmeSnippet,
  audit = auditReadmeFile
} = {}) {
  if (args.help) return HELP;
  const status = await readiness({ root, nodeVersion });
  if (status.local !== "PASS" ||
      status.releaseGate !== "PENDING_INDEPENDENT_CLOUDFLARE_TEST") {
    throw Error("Unexpected local readiness status");
  }
  const lines = [
    "PASS: offline self-host configuration, distinct private credentials,",
    "locked dependencies, rate limits and D1 migration files checked.",
    "NO REMOTE CHECKS OR WRITES: Cloudflare ownership, deployed D1,",
    "real SVG availability, GitHub rendering and billing remain UNVERIFIED."
  ];
  if (!args["account-subdomain"]) {
    lines.push(
      "NEXT: From YOUR Cloudflare dashboard, find the account-level workers.dev",
      "subdomain. Then re-run with --account-subdomain ACCOUNT_LABEL.",
      "Do NOT enter a full URL or the D1 database name."
    );
    return lines.join("\n") + "\n";
  }
  const config = await setup({ root });
  const origin = makeOwnOrigin(config.worker, args["account-subdomain"]);
  if (environment.WVT_API_URL && environment.WVT_API_URL !== origin &&
      environment.WVT_API_URL !== origin + "/") {
    throw Error("WVT_API_URL disagrees with the locally configured Worker origin");
  }
  lines.push(
    "WORKER ORIGIN (locally constructed, not network-verified): " + origin,
    "The Worker and account labels may repeat; D1 names do not appear in this URL."
  );
  let slug = args.slug;
  if (args.report) {
    const receipt = await recover({
      origin,
      report: join(root, args.report),
      verifyLocalHostname: async receivedOrigin => {
        if (receivedOrigin !== origin) throw Error("Untrusted receipt Worker origin");
      }
    });
    if (slug && slug !== receipt.slug) {
      throw Error("Existing slug conflicts with the saved diagnostic receipt");
    }
    slug = receipt.slug;
    lines.push(
      "RECEIPT: saved report claims a completed remote live check;",
      "this is NOT signed proof of Worker ownership, current D1 state or billing."
    );
  }
  if (slug) {
    // parseDoctorArgs ensures slug validity; recheck for programmatic callers.
    parseUrlArgs(["--account-subdomain", args["account-subdomain"], "--slug", slug]);
    const image = origin + "/v1/counters/" + slug + ".svg";
    lines.push(
      "COUNTER SLUG (provided or read from a saved receipt): " + slug,
      "EXACT SVG URL: " + image,
      "README MARKDOWN: ![Visitor counter](" + image + ")"
    );
    if (args.readme) {
      const result = await audit(join(root, args.readme), image);
      if (!["MATCH", "DIFFERENT_COUNTER_URL", "MISSING_COUNTER_IMAGE"].includes(result)) {
        throw Error("Unexpected local README audit result");
      }
      lines.push("LOCAL README IMAGE AUDIT: " + result,
        result === "MATCH" ? "Matching local Markdown URL; GitHub cache/rendering NOT verified." :
        "Use the exact README Markdown above in your OWN repository; no file was changed.");
    }
    lines.push("URL generation is not proof the slug exists on the remote Worker.");
  } else {
    lines.push(
      "No counter slug or saved receipt supplied. The doctor will NOT guess one.",
      "Optional remote READ-ONLY recovery (requires the owner's admin token; D1 reads may incur usage):",
      "node scripts/self-host-publish.mjs list --api " + origin +
        " --token-file .wvt-admin-token",
      "Older Workers can return HTTP 405. Do NOT recreate or redeploy automatically."
    );
  }
  return lines.join("\n") + "\n";
}

async function main() {
  try {
    process.stdout.write(await inspectSelfHostDoctor(parseDoctorArgs(process.argv.slice(2))));
  } catch {
    // Never echo raw private config, tokens, paths, network errors, or report bodies.
    process.stderr.write(
      "Offline self-host diagnosis failed. Check local setup, exact account " +
      "subdomain, optional receipt/README and WVT_API_URL. Nothing was deployed or changed.\n"
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
