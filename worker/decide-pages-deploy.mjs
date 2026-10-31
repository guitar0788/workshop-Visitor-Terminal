#!/usr/bin/env node
/**
 * Fail-closed GitHub Pages deployment channel.
 * "pilot" is managed exclusively by an explicit OAuth Pilot workflow; ordinary
 * pushes must not turn off the active OAuth login. "preview" restores auto-deploy.
 * A manual Publish Workshop Studio run is an explicit preview rollback.
 */
import { readFile, appendFile } from "node:fs/promises";

export function parseChannel(file) {
  const values = file.split(/\r?\n/).map(x => x.trim())
    .filter(x => x && !x.startsWith("#"));
  if (values.length !== 1 || !["pilot", "preview"].includes(values[0])) {
    throw Error("Invalid or ambiguous Pages release channel; refusing to deploy");
  }
  return values[0];
}
export function shouldPublishPreview({ channel, eventName, ref }) {
  if (!["pilot", "preview"].includes(channel)) {
    throw Error("Unknown Pages release channel; refusing to deploy");
  }
  if (ref !== "refs/heads/main") return false;
  if (eventName === "workflow_dispatch") return true;
  if (eventName === "push") return channel === "preview";
  return false;
}

async function main() {
  const channel = parseChannel(await readFile(".github/pages-deploy-channel.txt", "utf8"));
  const allowed = shouldPublishPreview({
    channel,
    eventName: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF
  });
  const out = process.env.GITHUB_OUTPUT;
  if (!out) throw Error("This script is only intended to run under GitHub Actions");
  await appendFile(out, "publish_preview=" + String(allowed) + "\n");
  console.log(allowed
    ? "Authorized normal GitHub Pages preview deployment."
    : "Skipped ordinary GitHub Pages preview: active OAuth pilot or invalid release event.");
  console.log("Pages channel is " + channel + ". OAuth pilot UI is managed separately.");
}
if (process.argv[1] && /[/\\]decide-pages-deploy\.mjs$/.test(process.argv[1])) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Unable to verify Pages release channel");
    process.exitCode = 1;
  });
}
