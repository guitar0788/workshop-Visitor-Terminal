#!/usr/bin/env node
/**
 * Attest the exact CI ZIP after Linux and Windows smoke jobs have succeeded.
 *
 * This is only a GitHub Actions preview manifest, not a digital signature,
 * published release, security certification, or a Cloudflare live test.
 *
 * No network access, shell commands, secret reading, remote deployments,
 * or database operations. The manifest names the PR's head SHA (not the
 * pull_request merge SHA) and the digest of the ZIP actually downloaded
 * by the final validation job.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const ARCHIVE_NAME = "Workshop-Visitor-Terminal-Self-Host.zip";
export const MANIFEST_NAME = "Workshop-SelfHost-Preview-Manifest.json";
export const ZIP_SHA_FILE = ARCHIVE_NAME + ".sha256";
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;

export function validateDigestSidecar(source, expectedZipName = ARCHIVE_NAME) {
  if (typeof source !== "string") throw Error("Missing ZIP digest file");
  const exact = new RegExp("^([a-f0-9]{64})  " +
    expectedZipName.replaceAll(".", "\\.") + "\\r?\\n$");
  const match = source.match(exact);
  if (!match || !HASH.test(match[1])) {
    throw Error("ZIP SHA256 sidecar is malformed or names another file");
  }
  return match[1];
}

export function createPreviewManifest({ sourceHeadSha, workflowRunId, digest, bytes }) {
  if (!SHA.test(sourceHeadSha ?? "") ||
      !/^[1-9]\d{0,18}$/.test(String(workflowRunId ?? "")) ||
      !HASH.test(digest ?? "") ||
      !Number.isSafeInteger(bytes) || bytes < 1000 || bytes > 6_000_000) {
    throw Error("Invalid source revision, workflow identity or ZIP digest");
  }
  return {
    schemaVersion: 1,
    project: "workshop-visitor-terminal",
    status: "VALIDATED_CI_PREVIEW_NOT_A_RELEASE",
    source: {
      repository: "guitar0788/workshop-Visitor-Terminal",
      pr: 21,
      headSha: sourceHeadSha,
      workflowRunId: String(workflowRunId)
    },
    artifact: {
      file: ARCHIVE_NAME,
      bytes,
      sha256: digest
    },
    tested: {
      linuxIndependentZipInstallAndWorkerD1: "PASS",
      windowsIndependentZipInstallAndWorkerD1: "PASS",
      macosIndependentZipInstallAndWorkerD1: "PASS",
      isolatedSecurityAndPackagingChecks: "PASS"
    },
    notVerified: {
      separateCloudflareAccountOwnership: "NOT_TESTED",
      realRemoteWorkerDeployment: "NOT_TESTED",
      realRemoteD1AndBilling: "NOT_TESTED",
      githubImageProxyCounting: "NOT_TESTED",
      mainBranchFullVerifyForThisArtifact: "NOT_ATTESTED_BY_THIS_MANIFEST"
    },
    caveat: "The GitHub Actions preview is not an official Release, cryptographic signing, proof of cloud ownership, or guarantee of zero fees."
  };
}

export async function createManifestFromPreview({
  directory,
  sourceHeadSha,
  workflowRunId
}) {
  if (typeof directory !== "string" || !directory) {
    throw Error("A preview archive directory is required");
  }
  const zip = await readFile(join(directory, ARCHIVE_NAME));
  const digestFile = await readFile(join(directory, ZIP_SHA_FILE), "utf8");
  const expected = validateDigestSidecar(digestFile);
  const actual = createHash("sha256").update(zip).digest("hex");
  if (expected !== actual) {
    throw Error("Downloaded ZIP does not match its SHA256 sidecar");
  }
  const manifest = createPreviewManifest({
    sourceHeadSha, workflowRunId, digest: actual, bytes: zip.length
  });
  // A previously generated manifest must not be overwritten.
  await writeFile(join(directory, MANIFEST_NAME),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  return manifest;
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || args[0].startsWith("-")) {
      throw Error("Expected one local archive directory");
    }
    const value = await createManifestFromPreview({
      directory: args[0],
      sourceHeadSha: process.env.WVT_EXPECT_HEAD_SHA,
      workflowRunId: process.env.WVT_WORKFLOW_RUN_ID
    });
    console.log("PASS: archive digest and PR head verified for " +
      value.source.headSha.slice(0, 12));
    console.log("Linux/Windows CI passed. Independent Cloudflare testing remains NOT_TESTED.");
  } catch {
    console.error("Self-host preview manifest could not be verified or created.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
