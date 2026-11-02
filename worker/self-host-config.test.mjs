import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public self-host template uses a new isolated DB and never enables central OAuth", async () => {
  const template = await readFile("wrangler.selfhost.example.toml", "utf8");
  const ignore = await readFile(".gitignore", "utf8");
  assert.match(template, /main = "worker\/index\.ts"/);
  assert.match(template, /database_id = "REPLACE_WITH_YOUR_NEW_D1_DATABASE_ID"/);
  assert.match(template, /PUBLISHING_ENABLED = "false"/);
  assert.match(template, /SVG_RATE_LIMIT_ENABLED = "true"/);
  assert.match(template, /SELF_HOST_ADMIN_LIST_ENABLED = "true"/);
  assert.match(template, /name = "SVG_GLOBAL_RATE_LIMITER"/);
  assert.match(template, /name = "SVG_RATE_LIMITER"/);
  assert.match(ignore, /wrangler\.selfhost\.toml/);
  assert.match(ignore, /\.wvt-admin-token/);
  for (const report of ["self-host-readiness.json", "selfhost-live-result.json", "selfhost-ci-report.json", "live-check.json"]) {
    assert(ignore.split(/\r?\n/).includes(report), "Local acceptance report is not gitignored: " + report);
  }
  assert.doesNotMatch(template, /fangcui2007|PILOT_GITHUB_USER_ID|GITHUB_CLIENT_SECRET/);
});
