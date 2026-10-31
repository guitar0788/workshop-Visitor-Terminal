import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(".github/workflows/oauth-pilot.yml", "utf8");
const normal = await readFile(".github/workflows/cloudflare-staging.yml", "utf8");
const pages = await readFile(".github/workflows/publish-pages.yml", "utf8");

test("OAuth pilot is explicitly manual, scoped to main and the approved staging domain", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*push:/m);
  assert.match(workflow, /github\.ref == .refs\/heads\/main./);
  assert.match(workflow, /OAUTH-PILOT-ONLY/);
  assert.match(workflow, /workshop-visitor-terminal-staging\.fangcui2007\.workers\.dev/);
  assert.match(workflow, /environment: cloudflare-staging/);
  assert.match(workflow, /PILOT_GITHUB_USER_ID: "124379632"/);
});

test("requires remote DB guard and OAuth readiness before exposing the Pages UI", () => {
  const indexOf = x => workflow.indexOf(x);
  assert(indexOf("node worker/verify-staging-d1.mjs") > 0);
  assert(indexOf("node worker/verify-staging-d1.mjs") < indexOf("wrangler d1 migrations apply"));
  assert(indexOf("wrangler d1 migrations apply") < indexOf("wrangler deploy"));
  assert(indexOf("node worker/oauth-pilot-preflight.mjs") > indexOf("wrangler deploy"));
  assert.match(workflow, /pages:\s*\n\s*name:[^\n]*\n\s*needs: worker/);
  assert.match(workflow, /VITE_PUBLISH_ENABLED: "true"/);
  assert.match(workflow, /VITE_PUBLISH_PILOT: "true"/);
});

test("GitHub OAuth uses allowed CLIENT_* secret names without changing Worker env names", () => {
  const prefix = "$" + "{", suffix = "}";
  const idLines = workflow.split("\n").filter(line =>
    line.trim() === "GITHUB_CLIENT_ID: " + prefix + "{ secrets.CLIENT_ID " + suffix + suffix);
  const secretLines = workflow.split("\n").filter(line =>
    line.trim() === "GITHUB_CLIENT_SECRET: " + prefix + "{ secrets.CLIENT_SECRET " + suffix + suffix);
  assert.equal(idLines.length, 2);
  assert.equal(secretLines.length, 1);
  assert.doesNotMatch(workflow, /secrets\.GITHUB_CLIENT_(?:ID|SECRET)/);
  assert.doesNotMatch(normal, /secrets\.CLIENT_(?:ID|SECRET)/);
});

test("default workflows still disable the pilot when manually redeployed", () => {
  assert.doesNotMatch(normal, /GITHUB_CLIENT_SECRET|VITE_PUBLISH_ENABLED/);
  assert.doesNotMatch(pages, /VITE_PUBLISH_ENABLED|VITE_PUBLISH_PILOT/);
  assert.match(pages, /workflow_dispatch:/);
  assert.match(normal, /workflow_dispatch:/);
});
