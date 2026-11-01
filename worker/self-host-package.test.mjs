import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  ALLOWED_FILES, PACKAGE_DIR, ROOT, archive, buildSelfHostPackage,
  crc32, safeZipPath
} from "../scripts/build-selfhost-package.mjs";

function extractZip(buffer) {
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50, "ZIP central directory footer");
  assert.equal(buffer.readUInt16LE(eocd + 20), 0);
  const total = buffer.readUInt16LE(eocd + 10);
  const size = buffer.readUInt32LE(eocd + 12);
  const directory = buffer.readUInt32LE(eocd + 16);
  assert.equal(directory + size, eocd);
  const found = new Map();
  let position = directory;
  for (let i = 0; i < total; i++) {
    assert.equal(buffer.readUInt32LE(position), 0x02014b50);
    assert.equal(buffer.readUInt16LE(position + 10), 8);
    assert.equal(buffer.readUInt16LE(position + 8), 0x0800);
    const checksum = buffer.readUInt32LE(position + 16);
    const compSize = buffer.readUInt32LE(position + 20);
    const origSize = buffer.readUInt32LE(position + 24);
    const nameSize = buffer.readUInt16LE(position + 28);
    const offset = buffer.readUInt32LE(position + 42);
    const name = buffer.subarray(position + 46, position + 46 + nameSize).toString("utf8");
    assert(name.startsWith(PACKAGE_DIR + "/"), "Expected portable extraction root");
    assert(safeZipPath(name));
    assert(!found.has(name));
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
    assert.equal(buffer.readUInt16LE(offset + 8), 8);
    const localNameSize = buffer.readUInt16LE(offset + 26);
    const localExtra = buffer.readUInt16LE(offset + 28);
    assert.equal(buffer.subarray(offset + 30, offset + 30 + localNameSize).toString("utf8"), name);
    const bodyStart = offset + 30 + localNameSize + localExtra;
    const inflated = inflateRawSync(buffer.subarray(bodyStart, bodyStart + compSize));
    assert.equal(inflated.length, origSize);
    assert.equal(crc32(inflated), checksum, "Actual file must match ZIP CRC");
    found.set(name.slice(PACKAGE_DIR.length + 1), inflated);
    position += 46 + nameSize + buffer.readUInt16LE(position + 30) +
      buffer.readUInt16LE(position + 32);
  }
  assert.equal(position, eocd);
  return found;
}

test("ZIP encoder is deterministic, rejects unsafe paths and has correct CRC", () => {
  const x = archive([
    { path: "z/test.txt", data: Buffer.from("Hello UTF-8 🛠") },
    { path: ".gitignore", data: Buffer.from("secrets\n") }
  ]);
  const y = archive([
    { path: ".gitignore", data: Buffer.from("secrets\n") },
    { path: "z/test.txt", data: Buffer.from("Hello UTF-8 🛠") }
  ]);
  assert.deepEqual(x, y, "Packaging order must not change bytes");
  assert.equal(extractZip(x).get("z/test.txt").toString("utf8"), "Hello UTF-8 🛠");
  for (const path of ["../token", "/etc/passwd", "a//b", "a\\b", "a/./b", "a/../b", "a:b", ""]) {
    assert.equal(safeZipPath(path), false);
    assert.throws(() => archive([{ path, data: Buffer.from("bad") }]));
  }
  assert.throws(() => archive([{ path: "a", data: "x" }, { path: "a", data: "y" }]));
  assert.throws(() => archive([{ path: "large", data: Buffer.alloc(3_000_001) }]));
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("release preview ZIP contains ONLY reviewed project sources and never secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wvt-selfhost-package-"));
  try {
    const result = await buildSelfHostPackage({
      root: ROOT, output: join(dir, "SelfHostPreview.zip")
    });
    assert(result.bytes < 6_000_000);
    assert.equal(result.members, ALLOWED_FILES.length);
    const extracted = extractZip(result.zip);
    assert.deepEqual([...extracted.keys()].sort(), [...ALLOWED_FILES].sort());
    assert(![...extracted.keys()].some(name =>
      /\.dev\.vars|\.env|\.wvt-admin-token|\.wvt-visit-secret|wrangler\.toml|\.sqlite|node_modules|dist\//i.test(name)));
    for (const path of ALLOWED_FILES) {
      assert.deepEqual(extracted.get(path), await readFile(join(ROOT, path)),
        "Distribution file must match its repository source: " + path);
    }
    const entry = extracted.get("worker/index.ts").toString("utf8");
    const service = extracted.get("worker/service.ts").toString("utf8");
    const publishing = extracted.get("worker/publishing.ts").toString("utf8");
    const manifest = JSON.parse(extracted.get("package.json").toString("utf8"));
    const lock = JSON.parse(extracted.get("package-lock.json").toString("utf8"));
    assert.match(entry, /from "\.\/service"/);
    assert.match(service, /from "\.\/publishing"/);
    assert.match(service, /from "\.\.\/src\/model"/);
    assert.match(publishing, /from "\.\.\/src\/model"/);
    assert(manifest.devDependencies.wrangler, "Reproducible Wrangler install manifest");
    assert(lock.packages[""].devDependencies.wrangler, "Root npm lockfile should cover Wrangler");
    assert.match(extracted.get("wrangler.selfhost.example.toml").toString("utf8"),
      /PUBLISHING_ENABLED = "false"/);
    assert.match(extracted.get("docs/SELF_HOSTING.md").toString("utf8"), /自托管/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
