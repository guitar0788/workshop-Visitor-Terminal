#!/usr/bin/env node
/**
 * Read the remote D1 list (fetched by Wrangler) and reject a configuration
 * which would mutate any database other than the dedicated staging database.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export function assertStagingDatabase(list, expectedId) {
  assert(Array.isArray(list), "D1 list must be a JSON array");
  const byId = list.filter(item => item && (item.uuid === expectedId || item.id === expectedId));
  assert.equal(byId.length, 1, "The exact staging D1 ID must exist once in this account");
  assert.equal(byId[0].name, "workshop-visitor-terminal-staging",
    "Database name mismatch: refusing any remote migration");
  return true;
}

if (process.argv[1]?.endsWith("/verify-staging-d1.mjs")) {
  const path = process.argv[2];
  if (!path) throw Error("Expected a file containing a Wrangler D1 JSON list");
  const list = JSON.parse(await readFile(path, "utf8"));
  assertStagingDatabase(list, process.env.STAGING_D1_DATABASE_ID);
  console.log("Verified the exact staging-only D1 database identity.");
}
