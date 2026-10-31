#!/usr/bin/env node
/**
 * v0.6 non-destructive disaster-recovery drill.
 *
 * Export the disposable, already-migrated LOCAL Wrangler D1 database and import
 * it into a separate LOCAL persistence directory. Compare essential records,
 * triggers, and budget state, then mutate ONLY the restored copy to prove
 * isolation. Never runs against a remote DB or exports actual staging data.
 * All SQL, paths and snapshots are removed after the drill.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const database = "workshop-visitor-terminal";
const config = "wrangler.toml";
const executable = process.platform === "win32"
  ? "node_modules/.bin/wrangler.cmd" : "./node_modules/.bin/wrangler";
const tables = [
  "counters", "request_windows", "visit_day_budget",
  "publish_oauth_states", "publish_login_tickets", "publish_sessions"
];
const triggers = ["count_new_window", "cap_unique_visits_by_utc_day",
  "record_admitted_visit_day"];
const MAX_BACKUP_BYTES = 32 * 1024 * 1024;

/**
 * No caller-supplied names, URLs, SQL, or flags are allowed.
 * Check the checked-out CI config, not a URL/secret provided by the user.
 */
export function assertDisposableLocalConfig(value) {
  assert.match(value, /^name\s*=\s*"workshop-visitor-terminal-api"\s*$/m);
  assert.match(value, /^database_name\s*=\s*"workshop-visitor-terminal"\s*$/m);
  assert.match(value,
    /^database_id\s*=\s*"00000000-0000-0000-0000-000000000000"\s*$/m);
  assert.doesNotMatch(value, /staging|workers\.dev|PUBLISHING_ENABLED\s*=\s*"true"/i);
  return true;
}

function wrangler(args) {
  // Runtime flags are built from fixed arguments, always --local, never remote.
  try {
    return execFileSync(executable, args, {
      encoding: "utf8", timeout: 90_000, maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (cause) {
    // Wrangler errors can include SQL/export contents; redact all output.
    // Only report the subcommand and a fixed table label, never SQL rows,
    // an exported file, raw Wrangler stderr, or environment contents.
    const phase = args[1] === "export" ? "local-export"
      : args.includes("--file") ? "isolated-local-import"
      : args.includes("--persist-to") ? "restored-local-query"
      : "source-local-query";
    const table = args.includes("--command")
      ? args[args.indexOf("--command") + 1]?.match(
          /(?:FROM|INTO|UPDATE)\s+(counters|request_windows|visit_day_budget|publish_oauth_states|publish_login_tickets|publish_sessions|sqlite_master)/i
        )?.[1] ?? "metadata"
      : "n/a";
    throw new Error("Disposable D1 recovery " + phase + " failed (table=" +
      table + ", exit=" + (cause?.status ?? "unknown") +
      "); no remote D1 operation was attempted");
  }
}

function command(sql, persist) {
  const args = ["d1", "execute", database, "--local", "--config", config,
    "--json", "--command", sql];
  if (persist) args.push("--persist-to", persist);
  const output = wrangler(args);
  let parsed;
  try { parsed = JSON.parse(output); }
  catch { throw Error("Wrangler local D1 JSON response was invalid"); }
  const rows = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
  if (!Array.isArray(rows)) throw Error("Unexpected local D1 response shape");
  return rows;
}

function digest(data) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function verifySnapshot(persist) {
  const snapshot = {};
  for (const table of tables) {
    snapshot[table] = command("SELECT * FROM " + table + " ORDER BY rowid", persist);
  }
  snapshot.schema = command(
    "SELECT type, name, tbl_name, sql FROM sqlite_master " +
    "WHERE type IN ('table','index','trigger') " +
    "AND name NOT LIKE 'sqlite_%' ORDER BY type,name", persist
  ).filter(row => !String(row.name).startsWith("_cf_"));
  for (const trigger of triggers) {
    assert(snapshot.schema.some(row => row.type === "trigger" && row.name === trigger),
      "Recovery copy is missing a required counter/receipt trigger");
  }
  // Wrangler D1 supports a curated SQL/PRAGMA surface. Schema and row-level
  // digests are the portable integrity check for this export/import drill;
  // low-level SQLite page integrity checks require an independent local
  // sqlite3 connection and are not claimed here.
  return snapshot;
}

async function main() {
  assertDisposableLocalConfig(await readFile(config, "utf8"));
  const scratch = await mkdtemp(join(tmpdir(), "wvt-local-recovery-"));
  const backupFile = join(scratch, "local-test-only.sql");
  const restoreStore = join(scratch, "isolated-restored-d1");
  try {
    const source = verifySnapshot(undefined);
    assert(source.counters.length >= 2,
      "Local recovery drill requires seeded disposable counters from local-smoke");
    assert(source.request_windows.length >= 1,
      "Local recovery drill requires qualifying test receipt");
    const sourceDigest = digest(source);

    // The ONLY export in this project is explicitly LOCAL. No GitHub artifact.
    wrangler(["d1", "export", database, "--local", "--config", config,
      "--output", backupFile, "--skip-confirmation"]);
    const metadata = await stat(backupFile);
    assert(metadata.size > 0 && metadata.size <= MAX_BACKUP_BYTES,
      "Local backup export was empty or exceeded the allowed disposable size");

    // Separate persistence path guarantees a fresh D1 database, while the
    // checked-out wrangler.toml still points only to the fake local CI UUID.
    wrangler(["d1", "execute", database, "--local", "--config", config,
      "--persist-to", restoreStore, "--file", backupFile]);
    const restored = verifySnapshot(restoreStore);
    assert.equal(digest(restored), sourceDigest,
      "Restored database schema, counters or receipt history differ from source");

    // Verify the recovered SQLite copy is actually independent of the source.
    const slug = String(restored.counters[0].slug);
    assert.match(slug, /^[a-z0-9-]{1,40}$/);
    const previous = Number(restored.counters[0].hits);
    command("UPDATE counters SET hits = hits + 1 WHERE slug = '" + slug + "'", restoreStore);
    const changed = command("SELECT hits FROM counters WHERE slug = '" + slug + "'", restoreStore);
    assert.equal(changed[0]?.hits, previous + 1);
    assert.equal(digest(verifySnapshot(undefined)), sourceDigest,
      "Recovery rehearsal changed its original local source database");

    console.log(
      "PASS: disposable D1 SQL export/import restored " + source.counters.length +
      " counter(s), receipt history, verified owner IDs, daily budgets, schema " +
      "and required triggers; local source stayed unchanged."
    );
    console.log("No staging D1, Cloudflare API, GitHub artifact or live data was accessed.");
  } finally {
    // SQL backups may contain short-lived OAuth/session records in future
    // fixtures. Never upload to public Actions artifacts or commit to GitHub.
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && /[/\\]backup-restore-drill\.mjs$/.test(process.argv[1])) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Recovery drill failed");
    process.exitCode = 1;
  });
}
