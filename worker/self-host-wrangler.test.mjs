import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { wranglerInvocation } from "./self-host-wrangler.mjs";

test("Windows/POSIX self-host tooling runs Wrangler through the same Node entrypoint", () => {
  const root = join("some", "project dir");
  const input = [
    "d1", "migrations", "apply", "DB", "--local",
    "--config", join(root, "wrangler.selfhost.smoke.toml"),
    "--persist-to", join(root, "local D1 temp")
  ];
  const call = wranglerInvocation(root, input);
  assert.equal(call.executable, process.execPath);
  assert.deepEqual(call.args,
    [join(root, "node_modules", "wrangler", "bin", "wrangler.js"), ...input]);
  assert(!call.args.some(x => x.endsWith("wrangler.cmd") || x === "--remote"));
  assert.deepEqual(input.slice(0, 3), ["d1", "migrations", "apply"]);
  for (const bad of [
    ["root", [42]], ["root", ["--local", null]],
    ["", ["deploy"]], ["/tmp", null]
  ]) assert.throws(() => wranglerInvocation(...bad));
});

test("self-host migration/dev/dry-run code never spawns the Windows .cmd shim", async () => {
  for (const file of ["worker/self-host-smoke.mjs", "worker/self-host-dryrun.mjs"]) {
    const src = await readFile(file, "utf8");
    assert.match(src, /wranglerInvocation\(ROOT/);
    assert.doesNotMatch(src, /wrangler\.cmd/);
    assert.doesNotMatch(src, /shell:\s*true/);
    assert.doesNotMatch(src, /"--remote"/);
  }
});
