#!/usr/bin/env node
/**
 * Build a source-only, reviewable self-host distribution archive.
 * No network, git operations, D1 mutations, Cloudflare deployment, or secrets.
 *
 * The output is a standard ZIP with deterministic file ordering, fixed file
 * timestamps, UTF-8 names and CRC-32. Every member is selected from a fixed
 * allowlist; never enumerate the repository or include user-supplied paths.
 *
 * A self-host user extracts it, runs npm install, creates their OWN D1 and uses the
 * scripts only after explicitly choosing an account and deployment target.
 */
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_DIR = "Workshop-Visitor-Terminal-Self-Host";
export const ZIP_NAME = PACKAGE_DIR + ".zip";
export const ALLOWED_FILES = Object.freeze([
  ".gitignore",
  "docs/SELF_HOSTING.md",
  "package.json",
  "src/model.ts",
  "worker/index.ts",
  "worker/service.ts",
  "worker/publishing.ts",
  "worker/migrations/0001_initial.sql",
  "worker/migrations/0002_atomic_increment.sql",
  "worker/migrations/0003_publishing.sql",
  "worker/migrations/0004_visit_budget.sql",
  "wrangler.selfhost.example.toml",
  "scripts/self-host-setup.mjs",
  "scripts/self-host-publish.mjs",
  "scripts/self-host-verify.mjs",
  "worker/self-host-dryrun.mjs",
  "worker/self-host-smoke.mjs"
]);
const MAX_MEMBER_BYTES = 3_000_000;
const MAX_ZIP_BYTES = 6_000_000;

export function safeZipPath(path) {
  return typeof path === "string" &&
    path.length > 0 && path.length < 250 &&
    !path.split("/").some(part => part === "." || part === ".." || !part) &&
    !path.includes("\\") && !path.startsWith("/") &&
    /^[a-zA-Z0-9._/-]+$/.test(path);
}

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function archive(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 100) {
    throw Error("Archive requires a bounded set of source files");
  }
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path, "en"));
  const names = new Set();
  const local = [], central = [];
  let offset = 0, centralSize = 0;
  for (const { path, data } of sorted) {
    if (!safeZipPath(path) || names.has(path)) throw Error("Unsafe or duplicate ZIP member");
    names.add(path);
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (bytes.byteLength > MAX_MEMBER_BYTES) throw Error("Oversized self-host file");
    const name = Buffer.from(PACKAGE_DIR + "/" + path, "utf8");
    const compressed = deflateRawSync(bytes, { level: 9 });
    const checksum = crc32(bytes);

    // ZIP local header: 30 bytes, method=8 (deflate), UTF-8 bit 11,
    // fixed DOS timestamp 1980-01-01. No data descriptors.
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(20, 4);
    l.writeUInt16LE(0x0800, 6);
    l.writeUInt16LE(8, 8);
    l.writeUInt16LE(0, 10);
    l.writeUInt16LE(33, 12);
    l.writeUInt32LE(checksum, 14);
    l.writeUInt32LE(compressed.length, 18);
    l.writeUInt32LE(bytes.length, 22);
    l.writeUInt16LE(name.length, 26);
    l.writeUInt16LE(0, 28);
    local.push(l, name, compressed);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(checksum, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(bytes.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += l.length + name.length + compressed.length;
    centralSize += c.length + name.length;
    if (offset + centralSize > MAX_ZIP_BYTES) throw Error("Archive exceeds size limit");
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...local, ...central, end]);
}

export async function buildSelfHostPackage({ root = ROOT, output = join(ROOT, "dist", ZIP_NAME) } = {}) {
  const files = await Promise.all(ALLOWED_FILES.map(async path => ({
    path, data: await readFile(join(root, path))
  })));
  // The standalone ZIP is deliberately limited to source, documentation and
  // project manifests. No .dev.vars, tokens, .env, local D1, dist or .wrangler.
  const result = archive(files);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, result);
  const sha256 = createHash("sha256").update(result).digest("hex");
  const checksumPath = output + ".sha256";
  await writeFile(checksumPath, sha256 + "  " + ZIP_NAME + "\n", "utf8");
  return { path: output, checksumPath, sha256, bytes: result.length, members: files.length, zip: result };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const built = await buildSelfHostPackage();
    console.log("PASS: source-only self-host preview ZIP generated (" +
      built.members + " allowed files, " + built.bytes + " bytes).");
    console.log("Output: dist/" + ZIP_NAME + " and its SHA256 checksum file.");
    console.log("No Cloudflare account, secrets or remote APIs were accessed.");
  } catch {
    console.error("Self-host archive build failed. No release was published.");
    process.exitCode = 1;
  }
}
