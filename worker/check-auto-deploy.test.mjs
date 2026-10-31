import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  APPROVED_REPOSITORY, isDeployRelevant, mayAutoDeploy
} from "./check-auto-deploy.mjs";

const SHA = "a".repeat(40);
const trusted = () => ({
  eventName: "workflow_run",
  sourceEvent: "push",
  conclusion: "success",
  branch: "main",
  repository: APPROVED_REPOSITORY,
  headRepository: APPROVED_REPOSITORY,
  channel: "pilot",
  expectedSha: SHA,
  checkedOutSha: SHA,
  currentMainSha: SHA,
  changedPaths: ["worker/publishing.ts"]
});

test("only approved current main pushes can automatically deploy staging", () => {
  assert.equal(mayAutoDeploy(trusted()), true);
  for (const rejected of [
    { eventName: "workflow_dispatch" },
    { sourceEvent: "pull_request" },
    { conclusion: "failure" },
    { conclusion: "skipped" },
    { branch: "feature" },
    { repository: "guitar0788/guitar0788" },
    { headRepository: "fork/workshop-Visitor-Terminal" },
    { channel: "preview" },
    { channel: "unknown" },
    { expectedSha: "a".repeat(39) },
    { checkedOutSha: "b".repeat(40) },
    { currentMainSha: "b".repeat(40) },
    { changedPaths: [] },
    { changedPaths: ["README.md", "worker/OAUTH_PILOT.md"] }
  ]) {
    assert.equal(mayAutoDeploy({ ...trusted(), ...rejected }), false,
      "Gate unexpectedly approved: " + JSON.stringify(rejected));
  }
});

test("runtime changes trigger, but documentation and test edits cannot trigger staging deployments", () => {
  for (const path of [
    "worker/publishing.ts", "worker/service.ts",
    "worker/migrations/0003_publishing.sql", "src/main.tsx",
    "src/style.css", "src/publish-client.ts", "index.html",
    "public/favicon.svg", "package-lock.json", "package.json",
    "wrangler.staging.example.toml", "tsconfig.json",
    ".github/workflows/oauth-pilot-auto.yml"
  ]) assert.equal(isDeployRelevant(path), true, path);
  for (const path of [
    "README.md", "worker/OAUTH_PILOT.md",
    "worker/check-auto-deploy.test.mjs", "worker/publishing.test.ts",
    "src/model.test.ts", "src/example.spec.ts",
    ".github/workflows/publish-pages.yml", ".github/pages-deploy-channel.txt"
  ]) assert.equal(isDeployRelevant(path), false, path);
});

test("pilot must be configured for automatic deployment, without changing manual rollback", async () => {
  const config = await readFile(".github/pages-deploy-channel.txt", "utf8");
  assert.match(config, /^pilot$/m);
  const workflow = await readFile(".github/workflows/oauth-pilot-auto.yml", "utf8");
  const manual = await readFile(".github/workflows/oauth-pilot.yml", "utf8");
  const preview = await readFile(".github/workflows/publish-pages.yml", "utf8");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \["Verify"\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /head_branch == 'main'/);
  assert.match(workflow, /head_repository\.full_name == github\.repository/);
  assert.match(workflow, /conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(workflow, /node worker\/check-auto-deploy\.mjs/);
  assert.match(workflow, /needs\.gate\.outputs\.deploy == 'true'/);
  assert.match(workflow, /secrets\.CLIENT_ID/);
  assert.match(workflow, /secrets\.CLIENT_SECRET/);
  assert.match(workflow, /PILOT_GITHUB_USER_ID: "124379632"/);
  assert.match(workflow, /cloudflare-staging/);
  assert.match(workflow, /STAGING_ORIGIN: "https:\/\/workshop-visitor-terminal-staging\.fangcui2007\.workers\.dev"/);
  assert.match(workflow, /VITE_PUBLISH_PILOT: "true"/);
  assert.match(workflow, /node worker\/verify-staging-d1\.mjs/);
  assert.match(workflow, /node worker\/oauth-pilot-preflight\.mjs/);
  assert.match(workflow, /group: workshop-cloudflare-staging/);
  assert.match(workflow, /group: github-pages/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.event == 'pull_request'/);
  assert.match(manual, /workflow_dispatch:/);
  assert.match(preview, /needs\.release_gate\.outputs\.publish_preview == 'true'/);
});

test("stale deployments are stopped before Cloudflare writes and before Pages publication", async () => {
  const workflow = await readFile(".github/workflows/oauth-pilot-auto.yml", "utf8");
  assert.equal((workflow.match(/git ls-remote origin refs\/heads\/main/g) ?? []).length, 2);
  assert.equal((workflow.match(/grep -qx 'pilot'/g) ?? []).length, 2);
  assert(workflow.indexOf("Recheck authoritative main before remote writes") <
    workflow.indexOf("wrangler d1 migrations apply"));
  assert(workflow.indexOf("Recheck verified main before replacing the pilot Pages site") <
    workflow.indexOf("actions/deploy-pages@v4"));
});
