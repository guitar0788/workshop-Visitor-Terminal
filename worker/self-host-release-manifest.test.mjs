import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ARCHIVE_NAME, MANIFEST_NAME, ZIP_SHA_FILE,
  validateDigestSidecar, createPreviewManifest, createManifestFromPreview
} from "../scripts/self-host-release-manifest.mjs";

const SHA = "a".repeat(40);
const RUN = "1234567890";

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "wvt-preview-attestation-"));
  const zip = Buffer.from("A deliberately synthetic ZIP fixture".repeat(100));
  const hash = createHash("sha256").update(zip).digest("hex");
  try {
    await writeFile(join(dir, ARCHIVE_NAME), zip);
    await writeFile(join(dir, ZIP_SHA_FILE), hash + "  " + ARCHIVE_NAME + "\n");
    await fn({ dir, zip, hash });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("preview JSON precisely distinguishes CI checks from unverified real cloud", async () => {
  await fixture(async ({ dir, hash, zip }) => {
    const manifest = await createManifestFromPreview({
      directory: dir, sourceHeadSha: SHA, workflowRunId: RUN
    });
    assert.equal(manifest.source.headSha, SHA);
    assert.equal(manifest.source.workflowRunId, RUN);
    assert.equal(manifest.artifact.bytes, zip.length);
    assert.equal(manifest.artifact.sha256, hash);
    assert.equal(manifest.status, "VALIDATED_CI_PREVIEW_NOT_A_RELEASE");
    assert(Object.values(manifest.tested).every(v => v === "PASS"));
    assert(Object.values(manifest.notVerified).every(v => v.startsWith("NOT_")));
    const raw = await readFile(join(dir, MANIFEST_NAME), "utf8");
    assert.deepEqual(JSON.parse(raw), manifest);
    assert(!raw.includes("ADMIN_TOKEN"));
    assert(!raw.includes("VISIT_HASH_SECRET"));
    assert(!raw.includes("CLOUDFLARE_API_TOKEN"));
    await assert.rejects(() => createManifestFromPreview({
      directory: dir, sourceHeadSha: SHA, workflowRunId: RUN
    }), { code: "EEXIST" });
    assert.equal(await readFile(join(dir, MANIFEST_NAME), "utf8"), raw);
  });
});

test("mismatched ZIP, altered digest and misleading manifest inputs are rejected", async () => {
  await fixture(async ({ dir, hash }) => {
    for (const invalid of [
      hash + "  other.zip\n",
      hash.toUpperCase() + "  " + ARCHIVE_NAME + "\n",
      hash + " *" + ARCHIVE_NAME + "\n",
      hash + "  " + ARCHIVE_NAME + "\ntrailing"
    ]) {
      await assert.rejects(async () => {
        await writeFile(join(dir, ZIP_SHA_FILE), invalid);
        await createManifestFromPreview({
          directory: dir, sourceHeadSha: SHA, workflowRunId: RUN
        });
      }, /sidecar/);
    }
    await writeFile(join(dir, ZIP_SHA_FILE),
      hash + "  " + ARCHIVE_NAME + "\n");
    await writeFile(join(dir, ARCHIVE_NAME), "tampered artifact");
    await assert.rejects(() => createManifestFromPreview({
      directory: dir, sourceHeadSha: SHA, workflowRunId: RUN
    }), /does not match/);
    const invalidRevisions = ["", "a".repeat(39), "https://example.com", "A".repeat(40), "0".repeat(64)];
    for (const head of invalidRevisions) {
      assert.throws(() => createPreviewManifest({
        sourceHeadSha: head, workflowRunId: RUN, digest: hash, bytes: 2000
      }));
    }
    for (const runId of ["", "0", "-1", "1e2", "123/1"]) {
      assert.throws(() => createPreviewManifest({
        sourceHeadSha: SHA, workflowRunId: runId, digest: hash, bytes: 2000
      }));
    }
  });
});

test("intermediate preview cannot be mistaken for post-Windows checked artifact", async () => {
  const source = await readFile(".github/workflows/self-host-preview.yml", "utf8");
  assert.match(source, /name: Workshop-SelfHost-CI-Input/);
  assert.match(source, /name: Workshop-SelfHost-Validated-Preview/);
  assert.match(source, /needs: \[package, windows-zip-smoke\]/);
  assert.match(source, /WVT_EXPECT_HEAD_SHA: \${{ github\.event\.pull_request\.head\.sha }}/);
  assert.match(source, /node scripts\/self-host-release-manifest\.mjs/);
  assert.doesNotMatch(source, /CLOUDFLARE_API_TOKEN/);
});
