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
  "  node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_LABEL --steps",
  "  node scripts/self-host-doctor.mjs --steps  (local-only step list)",
  "  node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_LABEL --report selfhost-live-result.json --readme README.md",
  "This checks local config, private secret separation, locked files, Worker",
  "address, previously saved receipt and README links. It NEVER creates a",
  "counter, changes credentials, edits README, or verifies a real cloud account.",
  "--steps only PRINTS manual commands. Nothing is run or uploaded."
].join("\n") + "\n";

export function parseDoctorArgs(argv) {
  if (argv.length === 1 && ["--help", "-h", "help"].includes(argv[0])) return { help: true };
  const result = {};
  const allowed = new Set(["account-subdomain", "slug", "report", "readme"]);
  for (let i = 0; i < argv.length;) {
    if (argv[i] === "--steps") {
      if (result.steps) throw Error("Duplicate manual steps option");
      result.steps = true;
      i += 1;
      continue;
    }
    const name = argv[i]?.startsWith("--") ? argv[i].slice(2) : "";
    const value = argv[i + 1];
    if (!allowed.has(name) || Object.hasOwn(result, name) ||
        !value || value.startsWith("--")) {
      throw Error("Unknown, duplicate or incomplete offline doctor option");
    }
    result[name] = value;
    i += 2;
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


/**
 * Stable, sanitized diagnostic categories. Errors can contain local paths,
 * secret fragments or raw configuration: never echo their original messages.
 * This is a troubleshooting hint, NOT proof that any remote check succeeded.
 */
export function explainDoctorFailure(error) {
  const message = error instanceof Error ? error.message : "";
  const code = error && typeof error === "object" ? error.code : "";
  if (code === "ENOENT" || code === "ENOTDIR") {
    return "WVT-D01 MISSING_LOCAL_FILE: Check the extracted self-host directory, " +
      "wrangler.selfhost.toml, two private secret files, and any requested local README/receipt. " +
      "Do not delete or regenerate existing credentials.";
  }
  if (/supported Node\.js version|Node\.js 22\.12\+|locked toolchain/.test(message)) {
    return "WVT-D02 NODE_VERSION: Install Node.js 22.12+ or a supported newer release; " +
      "run node --version and retry the local check.";
  }
  if (/Missing, identical, or malformed local secret files|Unsafe secret generation/.test(message)) {
    return "WVT-D03 SECRET_FILES: Verify distinct local .wvt-admin-token and " +
      ".wvt-visit-secret files. Do not paste or upload their contents; " +
      "do not rerun init over an existing installation.";
  }
  if (/Wrangler configuration is incomplete or unsafe|Unexpected self-host template|private config/i.test(message)) {
    return "WVT-D04 WORKER_CONFIG: Run node scripts/self-host-setup.mjs check " +
      "and compare the ignored local configuration against wrangler.selfhost.example.toml. " +
      "Never overwrite existing Worker/D1 identifiers or secrets.";
  }
  if (/package-lock|lockfile|locked npm|Untrusted or incomplete npm dependency/.test(message)) {
    return "WVT-D05 DEPENDENCIES: Restore the validated ZIP's package.json " +
      "and package-lock.json together; run npm ci. Do not disable lockfile validation.";
  }
  if (/WVT_API_URL disagrees|Untrusted receipt Worker origin/.test(message)) {
    return "WVT-D06 ORIGIN_CONFLICT: WVT_API_URL or the saved receipt disagrees with " +
      "the locally configured Worker. Confirm the correct account-level workers.dev " +
      "subdomain in your OWN Cloudflare dashboard. Do not send credentials yet.";
  }
  if (/subdomain|Invalid Worker or account|Invalid counter slug|invalid.*URL/i.test(message)) {
    return "WVT-D07 URL_OR_SLUG: Supply only the account workers.dev subdomain label " +
      "(not a URL or D1 name); a counter slug must be an actual existing slug. " +
      "Identical Worker and account labels may appear twice in the full hostname.";
  }
  if (/receipt|live-check|JSON|diagnostic report|completed real-cloud/.test(message)) {
    return "WVT-D08 RECEIPT: Check the saved local successful live-check JSON. " +
      "A missing or failed report cannot prove a counter exists; do not repeat " +
      "the cloud write test automatically.";
  }
  if (/README|Markdown|.md\b|.markdown\b/i.test(message)) {
    return "WVT-D09 README_FILE: Check the path to your LOCAL README and the exact " +
      "existing SVG slug. This doctor does not download or edit GitHub files.";
  }
  return "WVT-D00 LOCAL_CHECK_FAILED: Review the extracted self-host files and run " +
    "node scripts/self-host-setup.mjs check, then node scripts/self-host-readiness.mjs check. " +
    "No cloud deployment or write was attempted.";
}

function manualSteps(origin = null) {
  const lines = [
    "MANUAL NEXT STEPS (PRINT-ONLY; NO COMMANDS EXECUTED):",
    "1. Run: npm ci (NETWORK: locked npm packages only; no Cloudflare account changes)",
    "2. Run: node scripts/self-host-setup.mjs check",
    "3. Run: node scripts/self-host-readiness.mjs check",
    "4. Run: node worker/self-host-smoke.mjs (disposable local D1 only)",
    "5. Run: npx wrangler whoami (NETWORK; verify YOUR account before using any resource)"
  ];
  if (!origin) {
    lines.push(
      "6. Find your OWN Cloudflare account workers.dev subdomain in the dashboard.",
      "7. Re-run doctor with --account-subdomain YOUR_ACCOUNT_LABEL --steps.",
      "No remote migration/deployment commands are shown before an account label is supplied."
    );
    return lines;
  }
  lines.push(
    "6. ONLY IF the named Worker/D1 are YOUR disposable resources and you accept usage:",
    "   npx wrangler d1 migrations apply DB --remote --config wrangler.selfhost.toml",
    "   npx wrangler deploy --config wrangler.selfhost.toml",
    "   npx wrangler secret put ADMIN_TOKEN --config wrangler.selfhost.toml",
    "   npx wrangler secret put VISIT_HASH_SECRET --config wrangler.selfhost.toml",
    "   For the two secret put prompts, supply the corresponding ignored files",
    "   interactively. NEVER include their values in shell arguments or GitHub.",
    "7. READ-ONLY remote verification (only after confirming the exact origin):",
    "   node scripts/self-host-verify.mjs --api " + origin +
      " --token-file .wvt-admin-token",
    "8. If a counter already exists, recover its slug WITHOUT creating another:",
    "   node scripts/self-host-publish.mjs list --api " + origin +
      " --token-file .wvt-admin-token",
    "   Note: list makes remote D1 reads and may return 405 for older Workers.",
    "9. Create/update counters only after separately opting in to a real D1 write.",
    "   GitHub caching means image requests are NOT accurate profile views.",
    "Manual commands above do not verify ownership, remote counters or billing."
  );
  return lines;
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
    if (args.steps) lines.push(...manualSteps());
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
  if (args.steps) lines.push(...manualSteps(origin));
  return lines.join("\n") + "\n";
}

async function main() {
  try {
    process.stdout.write(await inspectSelfHostDoctor(parseDoctorArgs(process.argv.slice(2))));
  } catch (error) {
    // Never echo raw config, secrets, private paths, URLs or report bodies.
    process.stderr.write(explainDoctorFailure(error) + "\n" +
      "Offline doctor stopped. No Cloudflare or D1 requests or writes occurred.\n");
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
