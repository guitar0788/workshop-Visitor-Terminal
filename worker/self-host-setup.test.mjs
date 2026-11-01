import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseSetupArgs, makeConfig, validateConfig, initialize, checkSetup
} from "../scripts/self-host-setup.mjs";

const options = {
  worker: "my-visitor-worker",
  database: "my-visitor-d1",
  "database-id": "9abc1234-5678-4abc-8123-abc123456789"
};

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "wvt-setup-"));
  try {
    const template = await readFile("wrangler.selfhost.example.toml", "utf8");
    await writeFile(join(root, "wrangler.selfhost.example.toml"), template);
    await fn(root, template);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("only expected local setup actions and arguments are accepted", () => {
  assert.equal(parseSetupArgs(["--help"]).command, "help");
  assert.equal(parseSetupArgs(["check"]).command, "check");
  const init = parseSetupArgs([
    "init", "--worker", options.worker, "--database", options.database,
    "--database-id", options["database-id"]
  ]);
  assert.equal(init.worker, options.worker);
  for (const argv of [
    [], ["init"], ["deploy"], ["destroy"], ["check", "--remote"],
    ["init", "--worker", "workshop-visitor-terminal-staging",
      "--database", options.database, "--database-id", options["database-id"]],
    ["init", "--worker", "a\"\n[PUBLISHING_ENABLED]", 
      "--database", options.database, "--database-id", options["database-id"]],
    ["init", "--worker", options.worker, "--database", options.database,
      "--database-id", "00000000-0000-0000-0000-000000000000"],
    ["init", "--worker", options.worker, "--database", options.database,
      "--database-id", options["database-id"], "--extra", "x"]
  ]) assert.throws(() => parseSetupArgs(argv));
});

test("generated config uses unique binding namespaces and refuses malformed input", async () => {
  await fixture(async (_root, template) => {
    const result = makeConfig(template, options, [120001, 120002]);
    const info = validateConfig(result);
    assert.equal(info.database, options.database);
    assert.equal(info.worker, options.worker);
    assert.match(result, /PUBLISHING_ENABLED = "false"/);
    assert.match(result, /SVG_RATE_LIMIT_ENABLED = "true"/);
    assert(!result.includes("REPLACE_WITH_"));
    assert.throws(() => makeConfig(template, options, [1, 1]));
    assert.throws(() => makeConfig(template, options, [0, 2]));
    assert.throws(() => makeConfig(template.replace("1001", "tampered"), options, [1, 2]));
    assert.throws(() => validateConfig(result.replace(
      'PUBLISHING_ENABLED = "false"', 'PUBLISHING_ENABLED = "true"')));
    assert.throws(() => validateConfig(result.replace(
      'database_id = "' + options["database-id"] + '"',
      'database_id = "00000000-0000-0000-0000-000000000000"')));
  });
});

test("initialization generates private, distinct secrets and checks config without internet", async () => {
  await fixture(async root => {
    const sequence = [551234, 551234, 551235];
    const result = await initialize(options, {
      root,
      randomNamespace: () => sequence.shift()
    });
    assert.equal(result.worker, options.worker);
    assert.equal((await checkSetup({ root })).database, options.database);
    const admin = (await readFile(join(root, ".wvt-admin-token"), "utf8")).trim();
    const visitor = (await readFile(join(root, ".wvt-visit-secret"), "utf8")).trim();
    assert.match(admin, /^[0-9a-f]{96}$/);
    assert.match(visitor, /^[0-9a-f]{96}$/);
    assert.notEqual(admin, visitor);
    const config = await readFile(join(root, "wrangler.selfhost.toml"), "utf8");
    assert.match(config, /namespace_id = "551234"/);
    assert.match(config, /namespace_id = "551235"/);
    await assert.rejects(() => initialize(options, { root }), /already exists/);
    assert.equal((await readFile(join(root, ".wvt-admin-token"), "utf8")).trim(), admin);
  });
});

test("refuses weak, repeated secrets without writing any deployment config", async () => {
  await fixture(async root => {
    await assert.rejects(() => initialize(options, {
      root, secretBytes: () => "weak", randomNamespace: () => 50000
    }), /namespace|Unsafe secret/);
    const entries = await readdir(root);
    assert.deepEqual(entries, ["wrangler.selfhost.example.toml"]);
  });
});

test("existing partial configuration and secrets are never overwritten", async () => {
  await fixture(async root => {
    await writeFile(join(root, ".wvt-admin-token"), "private-existing");
    await assert.rejects(() => initialize(options, { root }), /already exists/);
    assert.equal(await readFile(join(root, ".wvt-admin-token"), "utf8"), "private-existing");
    await assert.rejects(() => checkSetup({ root }));
    assert(!((await readdir(root)).includes("wrangler.selfhost.toml")));
  });
});

test("preflight refuses changing protective flags, missing tokens or duplicate secret values", async () => {
  await fixture(async root => {
    await initialize(options, { root, randomNamespace: (() => { let n = 800000; return () => ++n; })() });
    const token = await readFile(join(root, ".wvt-admin-token"), "utf8");
    await writeFile(join(root, ".wvt-visit-secret"), token);
    await assert.rejects(() => checkSetup({ root }), /identical/);
    await writeFile(join(root, ".wvt-visit-secret"), "f".repeat(96));
    const configPath = join(root, "wrangler.selfhost.toml");
    const config = await readFile(configPath, "utf8");
    await writeFile(configPath, config.replace(
      'SVG_RATE_LIMIT_ENABLED = "true"', 'SVG_RATE_LIMIT_ENABLED = "false"'));
    await assert.rejects(() => checkSetup({ root }), /unsafe/);
  });
});

test("tampered Worker entry, extra D1 bindings and altered rate limits fail closed", async () => {
  await fixture(async (_root, template) => {
    const original = makeConfig(template, options, [120111, 120112]);
    const bad = [
      original.replace('main = "worker/index.ts"', 'main = "worker/other.ts"'),
      original.replace('workers_dev = true', 'workers_dev = false'),
      original.replace('limit = 60', 'limit = 999999'),
      original.replace('limit = 120', 'limit = 999999'),
      original.replace('period = 60', 'period = 10'),
      original.replace('crons = ["17 * * * *"]', 'crons = []'),
      original.replace('name = "SVG_RATE_LIMITER"', 'name = "UNLIMITED"'),
      original + '\n[[d1_databases]]\nbinding = "MORE"\n',
      original + '\nPUBLISHING_ENABLED = "true"\n',
      original + '\nSVG_RATE_LIMIT_ENABLED = "false"\n',
      original.replace('my-visitor-worker', 'my-visitor-worker-')
    ];
    for (const unsafe of bad) assert.throws(() => validateConfig(unsafe), /unsafe/);
    assert.equal(validateConfig(original).worker, options.worker);
  });
});
