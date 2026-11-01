import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { initialize } from "../scripts/self-host-setup.mjs";
import {
  parseDoctorArgs, inspectSelfHostDoctor
} from "../scripts/self-host-doctor.mjs";

const WORKER = "wvt-friend-mac-01";
const ACCOUNT = "wvt-friend-mac-01";
const ORIGIN = "https://" + WORKER + "." + ACCOUNT + ".workers.dev";
const SLUG = "livecheck-aabbccddeeff11";
const FILES = [
  ".gitignore", "package.json", "package-lock.json",
  "wrangler.selfhost.example.toml",
  "worker/index.ts", "worker/service.ts", "worker/publishing.ts",
  "src/model.ts", "src/card-art.ts", "src/minecraft-card-art.ts",
  "src/approved-reference-cards.ts", "src/approved-three-card-image.ts",
  "src/approved-clean-card-image.ts",
  "worker/migrations/0001_initial.sql",
  "worker/migrations/0002_atomic_increment.sql",
  "worker/migrations/0003_publishing.sql",
  "worker/migrations/0004_visit_budget.sql",
  "scripts/self-host-publish.mjs", "scripts/self-host-verify.mjs"
];

const fakeReceipt = () => ({
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

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "wvt-doctor-"));
  try {
    for (const file of FILES) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await cp(file, join(root, file));
    }
    await initialize({
      worker: WORKER, database: "private-d1-not-a-hostname",
      "database-id": "12345678-aaaa-4bbb-8ccc-123456789abc"
    }, { root, randomNamespace: (() => { let n = 100012; return () => ++n; })() });
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const doctor = (args, root, environment = {}) =>
  inspectSelfHostDoctor(args, { root, environment, nodeVersion: "22.12.0" });

test("doctor allows offline-first workflow and rejects ambiguous remote/write flags", () => {
  assert.deepEqual(parseDoctorArgs([]), {});
  assert.deepEqual(parseDoctorArgs(["--help"]), { help: true });
  assert.equal(parseDoctorArgs(["--account-subdomain", ACCOUNT, "--slug", SLUG]).slug, SLUG);
  for (const argv of [
    ["deploy"], ["--remote", "true"], ["--cloudflare-token", "secret"],
    ["--account-subdomain"], ["--slug", SLUG],
    ["--report", "receipt.json"], ["--readme", "README.md"],
    ["--account-subdomain", ACCOUNT, "--readme", "README.md"],
    ["--account-subdomain", ACCOUNT, "--report", "../private.json"],
    ["--account-subdomain", ACCOUNT, "--readme", "../../token.md", "--slug", SLUG],
    ["--account-subdomain", ACCOUNT, "--slug", "my/counter"],
    ["--account-subdomain", ACCOUNT, "--slug", "BAD"],
    ["--account-subdomain", ACCOUNT, "--account-subdomain", ACCOUNT],
    ["--account-subdomain", "https://example.workers.dev"],
    ["--account-subdomain", ACCOUNT, "--report", "receipt.json", "--readme", ".dev.vars"]
  ]) assert.throws(() => parseDoctorArgs(argv), JSON.stringify(argv));
});

test("doctor checks real local private setup and never pretends to verify Cloudflare", async () => {
  await fixture(async root => {
    const admin = (await readFile(join(root, ".wvt-admin-token"), "utf8")).trim();
    const secret = (await readFile(join(root, ".wvt-visit-secret"), "utf8")).trim();
    const result = await doctor(parseDoctorArgs([]), root);
    assert.match(result, /PASS: offline self-host configuration/);
    assert.match(result, /UNVERIFIED/);
    assert.match(result, /NEXT: From YOUR Cloudflare dashboard/);
    assert(!result.includes(WORKER));
    assert(!result.includes(admin));
    assert(!result.includes(secret));
    assert(!result.includes("12345678-aaaa"));
    assert(!result.includes("private-d1-not-a-hostname"));
  });
});

test("offline doctor reconstructs the repeated hostname and supplies a safe read-only recovery step", async () => {
  await fixture(async root => {
    const result = await doctor(parseDoctorArgs([
      "--account-subdomain", ACCOUNT
    ]), root);
    assert(result.includes("WORKER ORIGIN (locally constructed, not network-verified): " + ORIGIN));
    assert(result.includes("self-host-publish.mjs list --api " + ORIGIN));
    assert(!result.includes(".svg"));
    assert(!result.includes("private-d1-not-a-hostname"));
    assert.match(result, /Do NOT recreate or redeploy automatically/);
  });
});

test("known slug audits an existing README without writing or network access", async () => {
  await fixture(async root => {
    const file = join(root, "README.md");
    const markdown = "![Visitor counter](" + ORIGIN + "/v1/counters/" + SLUG + ".svg)\n";
    await writeFile(file, markdown);
    const args = parseDoctorArgs([
      "--account-subdomain", ACCOUNT, "--slug", SLUG, "--readme", "README.md"
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => { throw Error("DOCTOR NETWORK ACCESS FORBIDDEN"); };
    try {
      const result = await doctor(args, root);
      assert.match(result, /LOCAL README IMAGE AUDIT: MATCH/);
      assert(result.includes("README MARKDOWN: " + markdown.trim()));
      assert.match(result, /GitHub cache\/rendering NOT verified/);
      assert.equal(await readFile(file, "utf8"), markdown);
      await writeFile(file, "![Visitor counter](https://other.example/v1/counters/my-counter.svg)");
      const mismatch = await doctor(args, root);
      assert.match(mismatch, /LOCAL README IMAGE AUDIT: DIFFERENT_COUNTER_URL/);
      await writeFile(file, "There are no images.");
      const absent = await doctor(args, root);
      assert.match(absent, /LOCAL README IMAGE AUDIT: MISSING_COUNTER_IMAGE/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("saved successful remote receipt restores diagnostic slug but remains unverified evidence", async () => {
  await fixture(async root => {
    await writeFile(join(root, "selfhost-live-result.json"), JSON.stringify(fakeReceipt()));
    const args = parseDoctorArgs([
      "--account-subdomain", ACCOUNT, "--report", "selfhost-live-result.json"
    ]);
    const result = await doctor(args, root);
    assert(result.includes("COUNTER SLUG (provided or read from a saved receipt): " + SLUG));
    assert.match(result, /RECEIPT: saved report claims a completed remote live check/);
    assert.match(result, /NOT signed proof/);
    assert(result.includes("/v1/counters/" + SLUG + ".svg"));
    await assert.rejects(() => doctor(parseDoctorArgs([
      "--account-subdomain", ACCOUNT, "--report", "selfhost-live-result.json",
      "--slug", "another-counter"
    ]), root), /conflicts/);
    await writeFile(join(root, "selfhost-live-result.json"),
      JSON.stringify({ ...fakeReceipt(), result: "FAILED" }));
    await assert.rejects(() => doctor(args, root), /not a completed/);
  });
});

test("doctor refuses stale URL, tampered config, leaked old secrets and missing README", async () => {
  await fixture(async root => {
    const args = parseDoctorArgs(["--account-subdomain", ACCOUNT]);
    await assert.rejects(() => doctor(args, root, {
      WVT_API_URL: "https://other.other.workers.dev"
    }), /WVT_API_URL disagrees/);
    await assert.rejects(() => doctor(parseDoctorArgs([
      "--account-subdomain", ACCOUNT, "--slug", SLUG, "--readme", "README.md"
    ]), root), { code: "ENOENT" });
    const path = join(root, "wrangler.selfhost.toml");
    const config = await readFile(path, "utf8");
    await writeFile(path, config.replace('PUBLISHING_ENABLED = "false"',
      'PUBLISHING_ENABLED = "true"'));
    await assert.rejects(() => doctor(args, root), /unsafe/);
  });
});
