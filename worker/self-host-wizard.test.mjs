import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { initialize, checkSetup } from "../scripts/self-host-setup.mjs";
import {
  parseWizardArgs, runGuidedSetup, checkWizard, explainWizardFailure, WIZARD_INTRO, WIZARD_NEXT
} from "../scripts/self-host-wizard.mjs";

const WORKER = "my-new-visitor-worker";
const DATABASE = "my-new-visitor-d1";
const UUID = "12345678-1234-4abc-8123-123456789abc";
const REQUIRED = [
  ".gitignore", "package.json", "package-lock.json",
  "wrangler.selfhost.example.toml",
  "worker/index.ts", "worker/service.ts", "worker/publishing.ts",
  "worker/migrations/0001_initial.sql",
  "worker/migrations/0002_atomic_increment.sql",
  "worker/migrations/0003_publishing.sql",
  "worker/migrations/0004_visit_budget.sql",
  "src/model.ts", "src/card-art.ts", "src/minecraft-card-art.ts",
  "src/approved-reference-cards.ts", "src/approved-three-card-image.ts",
  "src/approved-clean-card-image.ts",
  "scripts/self-host-publish.mjs", "scripts/self-host-verify.mjs"
];

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "wvt-wizard-"));
  try {
    for (const path of REQUIRED) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await cp(path, join(root, path));
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function answers(responses) {
  const pending = [...responses];
  const prompts = [];
  return {
    prompts,
    async ask(prompt) {
      prompts.push(prompt);
      if (!pending.length) throw Error("Unexpected additional prompt");
      return pending.shift();
    }
  };
}

test("wizard command modes are exact; no cloud or secret flags accepted", () => {
  assert.deepEqual(parseWizardArgs([]), { command: "start" });
  assert.deepEqual(parseWizardArgs(["--help"]), { command: "help" });
  assert.deepEqual(parseWizardArgs(["--check"]), { command: "check" });
  for (const argv of [
    ["--deploy"], ["--remote"], ["--cloudflare-token", "x"],
    ["init"], ["--check", "--steps"], ["--help", "--check"],
    ["--worker", WORKER], ["--token-file", ".wvt-admin-token"]
  ]) assert.throws(() => parseWizardArgs(argv), /Use the wizard/);
  assert.match(WIZARD_INTRO, /your OWN Cloudflare account/i);
  assert.match(WIZARD_NEXT, /NOT verify cloud ownership/);
});

test("cancelled or invalid wizard input never creates private local files", async () => {
  await fixture(async root => {
    for (const [values, status] of [
      [["NO"], "CANCELLED"],
      [["OWN", WORKER, DATABASE, UUID, "NO"], "CANCELLED"]
    ]) {
      const input = answers(values);
      const messages = [];
      const result = await runGuidedSetup({
        root, ask: input.ask, notify: message => messages.push(message),
        nodeVersion: "22.12.0"
      });
      assert.equal(result.status, status);
      assert.match(messages.at(-1), /No configuration or secret files were created/);
      for (const filename of ["wrangler.selfhost.toml", ".wvt-admin-token",
        ".wvt-visit-secret"]) {
        assert(!(await readdir(root)).includes(filename));
      }
    }
    const malformed = answers(["OWN", WORKER, DATABASE, "fake-uuid"]);
    await assert.rejects(() => runGuidedSetup({
      root, ask: malformed.ask, nodeVersion: "22.12.0"
    }), /genuine D1 UUID/);
    assert.equal(malformed.prompts.length, 4, "Bad UUID never reaches write confirmation");
    assert(!(await readdir(root)).includes("wrangler.selfhost.toml"));
  });
});

test("interactive first-run creates only the three reviewed local files and verifies readiness", async () => {
  await fixture(async root => {
    const input = answers(["OWN", WORKER, DATABASE, UUID, "CREATE"]);
    const messages = [];
    const oldFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = () => { calls++; throw Error("NETWORK OPERATION NOT ALLOWED"); };
    try {
      const output = await runGuidedSetup({
        root, ask: input.ask, notify: message => messages.push(message),
        nodeVersion: "22.12.0"
      });
      assert.deepEqual(output, { status: "LOCAL_READY", localChecks: "PASS" });
      assert.equal(input.prompts.length, 5);
      assert.match(messages.join("\n"), /LOCAL CONFIGURATION READY/);
      assert.equal(calls, 0);
      const state = await checkSetup({ root });
      assert.deepEqual(state, { worker: WORKER, database: DATABASE });
      const admin = await readFile(join(root, ".wvt-admin-token"), "utf8");
      const visit = await readFile(join(root, ".wvt-visit-secret"), "utf8");
      const toml = await readFile(join(root, "wrangler.selfhost.toml"), "utf8");
      assert.match(admin.trim(), /^[a-f0-9]{96}$/);
      assert.match(visit.trim(), /^[a-f0-9]{96}$/);
      assert.notEqual(admin, visit);
      assert(toml.includes(UUID));
      assert(toml.includes(WORKER));
      assert(toml.includes(DATABASE));
      const combined = messages.join("\n");
      for (const privateValue of [admin.trim(), visit.trim(), UUID]) {
        assert(!combined.includes(privateValue), "No credential/UUID may appear in output");
      }
      assert.match(await checkWizard({ root, nodeVersion: "22.12.0" }),
        /Remote account, billing, D1 writes and GitHub proxy NOT_TESTED/);
      assert.equal(calls, 0);
      // No automatic rerun/secret regeneration: existing local files remain intact.
      await assert.rejects(() => runGuidedSetup({
        root, ask: answers(["OWN", WORKER, DATABASE, UUID, "CREATE"]).ask,
        nodeVersion: "22.12.0"
      }), /already exists or is partial/);
      assert.equal(await readFile(join(root, ".wvt-admin-token"), "utf8"), admin);
      assert.equal(await readFile(join(root, ".wvt-visit-secret"), "utf8"), visit);
      assert.equal(await readFile(join(root, "wrangler.selfhost.toml"), "utf8"), toml);
    } finally {
      globalThis.fetch = oldFetch;
    }
  });
});

test("partial existing setup is never overwritten, even if a new UUID is supplied", async () => {
  await fixture(async root => {
    const file = join(root, ".wvt-admin-token");
    await writeFile(file, "owner-secret-KEEP-ME", "utf8");
    await assert.rejects(() => runGuidedSetup({
      root, ask: answers(["OWN", WORKER, DATABASE, UUID, "CREATE"]).ask,
      nodeVersion: "22.12.0"
    }), /already exists or is partial/);
    assert.equal(await readFile(file, "utf8"), "owner-secret-KEEP-ME");
    assert(!(await readdir(root)).includes("wrangler.selfhost.toml"));
    await assert.rejects(() => checkWizard({ root, nodeVersion: "22.12.0" }));
  });
});

test("wizard keeps a partially prepared configuration for manual diagnosis after a failed readiness gate", async () => {
  await fixture(async root => {
    await assert.rejects(() => runGuidedSetup({
      root, ask: answers(["OWN", WORKER, DATABASE, UUID, "CREATE"]).ask,
      nodeVersion: "22.12.0",
      readiness: async () => {
        throw Error("local readiness unexpectedly refused");
      }
    }), /local readiness unexpectedly refused/);
    const original = await readFile(join(root, ".wvt-admin-token"), "utf8");
    assert.match(original.trim(), /^[a-f0-9]{96}$/);
    assert.equal(await readFile(join(root, ".wvt-admin-token"), "utf8"), original);
    assert.deepEqual(await checkSetup({ root }), { worker: WORKER, database: DATABASE });
  });
});

test("Node versions and malformed injected readiness gates fail closed", async () => {
  await fixture(async root => {
    const input = answers(["OWN", WORKER, DATABASE, UUID, "CREATE"]);
    await assert.rejects(() => runGuidedSetup({
      root, ask: input.ask, nodeVersion: "20.0.0"
    }), /22\.12/);
    assert.equal(input.prompts.length, 0);
    await assert.rejects(() => checkWizard({
      root, readiness: async () => ({ local: "PASS", releaseGate: "PUBLISHED" })
    }), /Unexpected local readiness status/);
    assert(!(await readdir(root)).includes("wrangler.selfhost.toml"));
  });
});

test("first-run input errors have fixed instructions without private values", () => {
  const confidential = "private-account-UUID-secret/Users/person";
  const cases = [
    [new Error("Choose a unique lowercase Worker name, new D1 name, and a genuine D1 UUID"), "WVT-W01"],
    [new Error("Self-host setup already exists or is partial. No file was replaced; inspect it manually."), "WVT-W02"],
    [new Error("Interactive terminal required for first-run setup"), "WVT-W03"],
    [new Error("Unexpected local readiness status"), "WVT-W04"],
    [Object.assign(new Error(confidential), {code: "ENOENT"}), "WVT-D01"],
    [new Error(confidential), "WVT-D00"]
  ];
  for (const [error, expected] of cases) {
    const result = explainWizardFailure(error);
    assert(result.startsWith(expected), expected + " " + result);
    assert(!result.includes(confidential));
    assert(!result.includes("/Users/person"));
    assert(result.length < 550);
  }
});
