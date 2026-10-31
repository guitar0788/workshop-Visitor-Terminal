import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertDisposableLocalConfig } from "./backup-restore-drill.mjs";

const good = [
  'name = "workshop-visitor-terminal-api"',
  'database_name = "workshop-visitor-terminal"',
  'database_id = "00000000-0000-0000-0000-000000000000"'
].join("\n");

test("recovery drill accepts only the placeholder CI database and never staging", () => {
  assert.equal(assertDisposableLocalConfig(good), true);
  for (const invalid of [
    good.replace("workshop-visitor-terminal-api", "workshop-visitor-terminal-staging"),
    good.replace('database_name = "workshop-visitor-terminal"',
      'database_name = "workshop-visitor-terminal-staging"'),
    good.replace("00000000-0000-0000-0000-000000000000",
      "3a52f952-852f-4b53-8cb0-8492d08d626c"),
    good + '\nPUBLISHING_ENABLED = "true"',
    good + "\n# workers.dev marker",
    good.replace('database_name = ', 'bad_database_name = ')
  ]) assert.throws(() => assertDisposableLocalConfig(invalid));
});

test("local drill commands require local mode, separate persistence and temporary SQL", async () => {
  const source = await readFile("worker/backup-restore-drill.mjs", "utf8");
  const workflow = await readFile(".github/workflows/verify.yml", "utf8");
  assert.match(source, /"d1", "export", database, "--local"/);
  assert.match(source, /"d1", "execute", database, "--local"/);
  assert.match(source, /"--persist-to", restoreStore, "--file", backupFile/);
  assert.match(source, /mkdtemp\(join\(tmpdir\(\)/);
  assert.match(source, /rm\(scratch, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(source, /"--remote"/);
  assert.doesNotMatch(workflow, /upload-artifact/);
  assert.match(workflow, /node worker\/local-smoke\.mjs[\s\S]*node worker\/backup-restore-drill\.mjs/);
});

test("the authenticated live pilot deployment never runs any destructive restore", async () => {
  for (const path of [".github/workflows/oauth-pilot-auto.yml",
    ".github/workflows/oauth-pilot.yml"]) {
    const workflow = await readFile(path, "utf8");
    assert.doesNotMatch(workflow, /time-travel restore|backup-restore-drill|d1 export/);
    assert.match(workflow, /verify-staging-d1\.mjs/);
  }
});
