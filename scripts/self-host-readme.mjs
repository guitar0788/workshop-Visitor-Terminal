#!/usr/bin/env node
/**
 * Recover the exact public SVG URL and GitHub README Markdown from a completed
 * self-host live-check receipt, WITHOUT touching Cloudflare, D1, secrets or
 * the user's GitHub repository. Intended for already-finished acceptance.
 *
 * A completed receipt is not proof that a counter is still deployed.
 * The operator must check image rendering in their own account separately.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateApiOrigin, assertLocalWorkerHostname } from "./self-host-publish.mjs";

const DIAGNOSTIC = /^livecheck-[0-9a-f]{14}$/;
const MAX_REPORT_BYTES = 20_000;
const HELP = [
  "Print the existing live-test SVG URL and exact GitHub README Markdown.",
  "  node scripts/self-host-readme.mjs --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --report selfhost-live-result.json",
  "  node scripts/self-host-readme.mjs --report selfhost-live-result.json (uses WVT_API_URL)",
  "Local-only: no remote requests, admin tokens, Cloudflare API or D1 changes.",
  "Requires a successful live-check JSON report and a confirmed Worker URL."
].join("\n") + "\n";

export function parseReadmeArgs(argv, environment = process.env) {
  if (argv.length === 1 && ["help", "--help", "-h"].includes(argv[0])) return { help: true };
  const parsed = {};
  if (argv.length % 2 !== 0) throw Error("Expected --report and optional --api");
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.startsWith("--") ? argv[i].slice(2) : "";
    if (!["api", "report"].includes(name) || Object.hasOwn(parsed, name) ||
        !argv[i + 1] || argv[i + 1].startsWith("--")) {
      throw Error("Unknown, repeated or incomplete README option");
    }
    parsed[name] = argv[++i];
  }
  const api = parsed.api ?? environment.WVT_API_URL;
  if (!api || !parsed.report || !/^[a-zA-Z0-9._/-]+\.json$/.test(parsed.report)) {
    throw Error("Provide a local JSON report and your own public HTTPS Worker root");
  }
  const origin = validateApiOrigin(api);
  const host = new URL(origin).hostname;
  const labels = host.split(".");
  if (!origin.startsWith("https://") || labels.length !== 4 ||
      labels[2] !== "workers" || labels[3] !== "dev" ||
      !/^[a-z0-9-]+$/.test(labels[0]) || !/^[a-z0-9-]+$/.test(labels[1])) {
    throw Error("Use your own HTTPS Worker workers.dev URL, not a local or custom-domain URL");
  }
  return { origin, report: parsed.report };
}

export function validatedDiagnosticSlug(data) {
  if (!data || Array.isArray(data) || typeof data !== "object" ||
      data.schemaVersion !== 1 ||
      data.kind !== "workshop-visitor-terminal-live-check" ||
      data.runtime !== "REMOTE_SELF_HOST" ||
      data.result !== "PASS" ||
      data.diagnosticCounterPersists !== true ||
      !DIAGNOSTIC.test(data.diagnosticCounter ?? "") ||
      !data.observed || typeof data.observed !== "object" ||
      !["remoteD1Create", "svgHeadNoCount", "firstSvgGetIncrements",
        "sameClientRequestDeduplication", "designUpdatePreservesCount",
        "updatedSvgRendered"].every(key => data.observed[key] === "PASS")) {
    throw Error("Report is not a completed real-cloud live-check receipt");
  }
  return data.diagnosticCounter;
}

export function createReadmeSnippet(origin, slug) {
  const validated = parseReadmeArgs(["--api", origin, "--report", "receipt.json"]);
  if (!DIAGNOSTIC.test(slug)) throw Error("Invalid diagnostic counter slug");
  const url = validated.origin + "/v1/counters/" + slug + ".svg";
  return {
    url,
    markdown: "![Visitor counter](" + url + ")"
  };
}

export async function recoverReadmeSnippet({ origin, report, verifyLocalHostname = assertLocalWorkerHostname }) {
  await verifyLocalHostname(origin);
  const file = await readFile(report);
  if (file.length > MAX_REPORT_BYTES) throw Error("Live-check receipt exceeds size limit");
  let receipt;
  try { receipt = JSON.parse(file.toString("utf8")); }
  catch { throw Error("Live-check receipt is not valid JSON"); }
  const slug = validatedDiagnosticSlug(receipt);
  return { slug, ...createReadmeSnippet(origin, slug) };
}

async function main() {
  try {
    const args = parseReadmeArgs(process.argv.slice(2));
    if (args.help) { process.stdout.write(HELP); return; }
    const result = await recoverReadmeSnippet(args);
    process.stdout.write("Existing diagnostic counter: " + result.slug +
      "\nDirect SVG URL:\n" + result.url +
      "\nGitHub README (copy this complete line):\n" + result.markdown +
      "\nNo remote requests or writes were made. Verify live image availability separately.\n");
  } catch (e) {
    // Do not log private report bodies, URL query strings, credentials or stack traces.
    process.stderr.write("README recovery failed: " +
      (e instanceof Error ? e.message : "Unknown error") + "\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
