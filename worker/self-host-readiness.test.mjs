import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm, mkdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  parseReadinessArgs, checkNodeVersion, inspectOfflineReadiness,
  writeReadinessReport
} from "../scripts/self-host-readiness.mjs";
import { initialize } from "../scripts/self-host-setup.mjs";

const opts = {
  worker: "private-workshop-worker", database: "private-workshop-db",
  "database-id": "12345678-aaaa-4bbb-8ccc-123456789abc"
};
const sources = [
  ".gitignore", "package.json", "package-lock.json",
  "wrangler.selfhost.example.toml",
  "worker/index.ts", "worker/service.ts", "worker/publishing.ts",
  "src/model.ts",
  "worker/migrations/0001_initial.sql",
  "worker/migrations/0002_atomic_increment.sql",
  "worker/migrations/0003_publishing.sql",
  "worker/migrations/0004_visit_budget.sql",
  "scripts/self-host-publish.mjs", "scripts/self-host-verify.mjs"
];

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "wvt-releasegate-"));
  try {
    for (const path of sources) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await cp(path, join(root, path));
    }
    await initialize(opts, { root, randomNamespace: (() => {
      let id = 100120; return () => ++id;
    })() });
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("only offline check and optional report path are accepted", () => {
  assert.equal(parseReadinessArgs(["check"]).command, "check");
  assert.deepEqual(parseReadinessArgs(["check", "--report", "report.json"]), {
    command: "check", report: "report.json"
  });
  assert.equal(parseReadinessArgs(["--help"]).help, true);
  for (const args of [
    [], ["deploy"], ["check", "--remote"], ["check", "--report"],
    ["check", "--report", "--delete"], ["check", "--report", "x", "--api", "y"],
    ["check", "--report", "x", "--remote", "true"]
  ]) assert.throws(() => parseReadinessArgs(args));
  assert.equal(checkNodeVersion("22.12.0"), true);
  assert.equal(checkNodeVersion("24.0.1"), true);
  for (const v of ["20.14.0", "21.99.0", "22.1.0", "23.5.0", "25.0.0", "x", "", null])
    assert.throws(() => checkNodeVersion(v));
});

test("the local-only report is sanitized and never claims remote verification", async () => {
  await fixture(async root => {
    const report = await inspectOfflineReadiness({ root, nodeVersion: "22.9.0" });
    assert.equal(report.local, "PASS");
    assert.equal(report.releaseGate, "PENDING_INDEPENDENT_CLOUDFLARE_TEST");
    assert(Object.values(report.checks).every(x => x === "PASS"));
    assert(Object.values(report.live).every(x => x === "NOT_TESTED"));
    const output = join(root, "readiness-report.json");
    await writeReadinessReport(report, output);
    const saved = await readFile(output, "utf8");
    assert.deepEqual(JSON.parse(saved), report);
    const token = (await readFile(join(root, ".wvt-admin-token"), "utf8")).trim();
    const secret = (await readFile(join(root, ".wvt-visit-secret"), "utf8")).trim();
    assert(!saved.includes(token));
    assert(!saved.includes(secret));
    assert(!saved.includes(opts.worker));
    assert(!saved.includes(opts.database));
    assert(!saved.includes(opts["database-id"]));
    assert(!/([0-9a-f]{96})/i.test(saved));
    await assert.rejects(() => writeReadinessReport(report, output), { code: "EEXIST" });
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), report);
    assert((await stat(output)).size > 100);
  });
});

test("readiness fails closed when Worker/D1 limits, secrets or ignore rules are unsafe", async () => {
  await fixture(async root => {
    const configPath = join(root, "wrangler.selfhost.toml");
    const config = await readFile(configPath, "utf8");
    for (const change of [
      x => x.replace("limit = 60", "limit = 60000"),
      x => x.replace("workers_dev = true", "workers_dev = false"),
      x => x + "\n[[d1_databases]]\nbinding = \"EXTRA\"\n",
      x => x.replace('PUBLISHING_ENABLED = "false"', 'PUBLISHING_ENABLED = "true"')
    ]) {
      await writeFile(configPath, change(config));
      await assert.rejects(() => inspectOfflineReadiness({ root }), /unsafe/);
    }
    await writeFile(configPath, config);
    await writeFile(join(root, ".wvt-visit-secret"),
      await readFile(join(root, ".wvt-admin-token"), "utf8"));
    await assert.rejects(() => inspectOfflineReadiness({ root }), /identical/);
  });
  await fixture(async root => {
    const ignorePath = join(root, ".gitignore");
    await writeFile(ignorePath, "# no ignore\n");
    await assert.rejects(() => inspectOfflineReadiness({ root }), /gitignored/);
  });
});

test("readiness rejects altered dependency locks or missing D1 migrations", async () => {
  await fixture(async root => {
    const lockPath = join(root, "package-lock.json");
    const original = await readFile(lockPath, "utf8");
    const changed = JSON.parse(original);
    changed.packages["node_modules/react"].resolved = "https://other.example/react.tgz";
    await writeFile(lockPath, JSON.stringify(changed));
    await assert.rejects(() => inspectOfflineReadiness({ root }), /Untrusted/);
    await writeFile(lockPath, original);
    const migration = join(root, "worker/migrations/0004_visit_budget.sql");
    await writeFile(migration, "");
    await assert.rejects(() => inspectOfflineReadiness({ root }), /empty/);
  });
});
