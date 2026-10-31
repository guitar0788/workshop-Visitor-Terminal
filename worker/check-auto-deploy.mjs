#!/usr/bin/env node
/**
 * Fail-closed gate for automatic, owner-only OAuth staging deployment.
 *
 * This module never reads secrets or accesses Cloudflare. It only runs after
 * the Verify workflow successfully completes on an authoritative main push.
 */
import { readFile, appendFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { parseChannel } from "./decide-pages-deploy.mjs";

export const APPROVED_REPOSITORY = "guitar0788/workshop-Visitor-Terminal";

export function isDeployRelevant(path) {
  // Documentation, tests, and unrelated GitHub files never redeploy Worker.
  if (/^(?:src|worker)\//.test(path)) {
    if (/\.(?:md|test\.ts|test\.mjs|spec\.ts)$/.test(path)) return false;
    return true;
  }
  if (/^public\//.test(path)) return true;
  return [
    "index.html", "package.json", "package-lock.json",
    "vite.config.ts", "wrangler.staging.example.toml",
    ".github/workflows/oauth-pilot-auto.yml"
  ].includes(path) || /^tsconfig[^/]*\.json$/.test(path);
}

/** This decision is intentionally independent of any secret values. */
export function mayAutoDeploy(options) {
  const {
    eventName, sourceEvent, conclusion, branch, repository, headRepository,
    channel, expectedSha, checkedOutSha, currentMainSha, changedPaths
  } = options;
  if (eventName !== "workflow_run" || sourceEvent !== "push" ||
      conclusion !== "success" || branch !== "main" ||
      repository !== APPROVED_REPOSITORY ||
      headRepository !== APPROVED_REPOSITORY || channel !== "pilot") return false;
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "") ||
      checkedOutSha !== expectedSha || currentMainSha !== expectedSha) return false;
  return Array.isArray(changedPaths) && changedPaths.some(isDeployRelevant);
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", timeout: 15000 }).trim();
}

async function main() {
  const channel = parseChannel(await readFile(".github/pages-deploy-channel.txt", "utf8"));
  const checkedOutSha = git("rev-parse", "HEAD");
  const line = git("ls-remote", "--exit-code", "origin", "refs/heads/main").split(/\s+/);
  const currentMainSha = line[0] ?? "";
  const changedPaths = git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
    .split(/\r?\n/).filter(Boolean);

  const enabled = mayAutoDeploy({
    eventName: process.env.GITHUB_EVENT_NAME,
    sourceEvent: process.env.VERIFY_SOURCE_EVENT,
    conclusion: process.env.VERIFY_CONCLUSION,
    branch: process.env.VERIFY_HEAD_BRANCH,
    repository: process.env.GITHUB_REPOSITORY,
    headRepository: process.env.VERIFY_HEAD_REPOSITORY,
    channel,
    expectedSha: process.env.VERIFY_HEAD_SHA,
    checkedOutSha, currentMainSha, changedPaths
  });
  if (!process.env.GITHUB_OUTPUT) throw Error("Missing GitHub Actions output file");
  await appendFile(process.env.GITHUB_OUTPUT, "deploy=" + String(enabled) + "\n");
  console.log(enabled
    ? "Authorized: verified current main and runtime changes; deploy owner-only staging."
    : "Skipped: non-pilot channel, stale/untrusted commit, or no runtime changes.");
  console.log("No repository outside Workshop Visitor Terminal is eligible.");
}

if (process.argv[1] && /[/\\]check-auto-deploy\.mjs$/.test(process.argv[1])) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : "Auto deployment verification failed");
    process.exitCode = 1;
  });
}
