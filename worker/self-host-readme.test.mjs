import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseReadmeArgs, validatedDiagnosticSlug, createReadmeSnippet,
  recoverReadmeSnippet, auditReadmeMarkdown, auditReadmeFile
} from "../scripts/self-host-readme.mjs";

const ORIGIN = "https://wvt-friend-mac-01.wvt-friend-mac-01.workers.dev";
const SLUG = "livecheck-aabbccddeeff11";
const report = () => ({
  schemaVersion: 1,
  kind: "workshop-visitor-terminal-live-check",
  runtime: "REMOTE_SELF_HOST",
  result: "PASS",
  diagnosticCounter: SLUG,
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
  billingIsolation: "NOT_VERIFIED"
});

test("recover exact README SVG from existing completed macOS live-check report, offline only", async () => {
  const root = await mkdtemp(join(tmpdir(), "wvt-readme-recover-"));
  try {
    const file = join(root, "selfhost-live-result.json");
    await writeFile(file, JSON.stringify(report()));
    let checks = 0;
    const result = await recoverReadmeSnippet({
      origin: ORIGIN,
      report: file,
      verifyLocalHostname: async origin => {
        checks++;
        assert.equal(origin, ORIGIN);
      }
    });
    assert.equal(checks, 1);
    assert.equal(result.slug, SLUG);
    assert.equal(result.url, ORIGIN + "/v1/counters/" + SLUG + ".svg");
    assert.equal(result.markdown, "![Visitor counter](" + result.url + ")");
    assert(!result.markdown.includes("my-counter"));
    // A recovery may never modify a previously saved receipt or call a URL.
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), report());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reject malformed/mismatched reports and local CI receipts", () => {
  for (const bad of [
    null, {}, { ...report(), result: "FAILED" },
    { ...report(), runtime: "LOCAL_INTEGRATION" },
    { ...report(), diagnosticCounterPersists: false },
    { ...report(), diagnosticCounter: "my-counter" },
    { ...report(), diagnosticCounter: "livecheck-../../private" },
    { ...report(), diagnosticCounter: "livecheck-ABCDEF12345678" },
    { ...report(), observed: { ...report().observed, firstSvgGetIncrements: "SKIPPED" } }
  ]) assert.throws(() => validatedDiagnosticSlug(bad));
});

test("reject malformed or wrong-destination URL without network requests", () => {
  const valid = parseReadmeArgs([
    "--report", "selfhost-live-result.json"
  ], { WVT_API_URL: ORIGIN });
  assert.equal(valid.origin, ORIGIN);
  assert.equal(valid.report, "selfhost-live-result.json");
  assert.equal(parseReadmeArgs(["--help"]).help, true);
  for (const invalid of [
    ["--report", "selfhost-live-result.json"],
    ["--report", "selfhost-live-result.json", "--api", "http://wvt-friend-mac-01.wvt-friend-mac-01.workers.dev"],
    ["--report", "selfhost-live-result.json", "--api", "http://127.0.0.1:8787"],
    ["--report", "selfhost-live-result.json", "--api", "https://github.com"],
    ["--report", "selfhost-live-result.json", "--api", "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev"],
    ["--report", "selfhost-live-result.json", "--api", ORIGIN + "/v1/counters/test.svg"],
    ["--report", "../config/.dev.vars"],
    ["--report", "a.json", "--report", "b.json"]
  ]) assert.throws(() => parseReadmeArgs(invalid, {}));
  assert.throws(() => createReadmeSnippet(ORIGIN, "my-counter"));
});

test("CLI success path prints the actual diagnostic rather than a placeholder", async () => {
  const source = await readFile("scripts/self-host-live-check.mjs", "utf8");
  assert.match(source, /createReadmeSnippet\(resolveSelfHostApi\(args\.api\), result\.diagnosticCounter\)\.markdown/);
  assert.match(source, /This diagnostic is NOT the illustrative my-counter slug/);
  const packageSource = await readFile("scripts/build-selfhost-package.mjs", "utf8");
  assert.match(packageSource, /scripts\/self-host-readme\.mjs/);
});

test("local README audit detects correct, wrong and missing images without network access", async () => {
  const expected = ORIGIN + "/v1/counters/" + SLUG + ".svg";
  const right = "![Visits](<" + expected + ">)";
  assert.equal(auditReadmeMarkdown(right, expected), "MATCH");
  assert.equal(auditReadmeMarkdown("![Other](" + ORIGIN + "/v1/counters/my-counter.svg)", expected), "DIFFERENT_COUNTER_URL");
  assert.equal(auditReadmeMarkdown("![Other](https://other.example/v1/counters/my-counter.svg)", expected), "DIFFERENT_COUNTER_URL");
  assert.equal(auditReadmeMarkdown("plain text " + expected, expected), "MISSING_COUNTER_IMAGE");
  assert.equal(auditReadmeMarkdown("<!-- " + right + " -->", expected), "MISSING_COUNTER_IMAGE");
  const fence = String.fromCharCode(96).repeat(3);
  assert.equal(auditReadmeMarkdown(fence + "markdown\n" + right + "\n" + fence, expected), "MISSING_COUNTER_IMAGE");
  assert.equal(auditReadmeMarkdown("![Other](https://invalid.example/image.png)\n" + right, expected), "MATCH");
  const root = await mkdtemp(join(tmpdir(), "wvt-readme-audit-"));
  try {
    const path = join(root, "README.md");
    await writeFile(path, right, "utf8");
    assert.equal(await auditReadmeFile(path, expected), "MATCH");
    await writeFile(path, "x".repeat(200_001));
    await assert.rejects(auditReadmeFile(path, expected), /200 KB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("optional README path accepts Markdown but rejects private token or config paths", () => {
  const valid = parseReadmeArgs(["--api", ORIGIN, "--report", "live.json", "--readme", "README.md"]);
  assert.equal(valid.readme, "README.md");
  for (const path of [".wvt-admin-token", ".dev.vars", "README.html", "test.json"]) {
    assert.throws(() => parseReadmeArgs(["--api", ORIGIN, "--report", "live.json", "--readme", path]));
  }
});
