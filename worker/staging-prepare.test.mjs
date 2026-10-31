import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStagingConfig, validateStagingOrigin, validateStagingSecrets
} from "./prepare-staging.mjs";

const fixture = () => ({
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "token-" + "b".repeat(45),
  STAGING_D1_DATABASE_ID: "3a52f952-852f-4b53-8cb0-8492d08d626c",
  STAGING_ADMIN_TOKEN: "admin-" + "c".repeat(48),
  STAGING_VISIT_HASH_SECRET: "hash-" + "d".repeat(48)
});
test("requires separate legitimate staging credentials and D1 ID", () => {
  assert.equal(validateStagingSecrets(fixture()).databaseId, fixture().STAGING_D1_DATABASE_ID);
  assert.throws(() => validateStagingSecrets({ ...fixture(), STAGING_D1_DATABASE_ID:
    "00000000-0000-0000-0000-000000000000" }), /real non-placeholder/);
  assert.throws(() => validateStagingSecrets({ ...fixture(), STAGING_ADMIN_TOKEN:
    fixture().STAGING_VISIT_HASH_SECRET }), /different/);
  assert.throws(() => validateStagingSecrets({ ...fixture(), CLOUDFLARE_API_TOKEN: "" }),
    /Missing required/);
});
test("staging template never substitutes production identifiers", () => {
  const template = 'name = "workshop-visitor-terminal-staging"\n' +
    'database_name = "workshop-visitor-terminal-staging"\n' +
    'workers_dev = true\ndatabase_id = "STAGING_D1_ID_PLACEHOLDER"';
  const config = buildStagingConfig(template, fixture().STAGING_D1_DATABASE_ID);
  assert.match(config, /3a52f952-852f-4b53-8cb0-8492d08d626c/);
  assert.throws(() => buildStagingConfig(template.replace(
    'name = "workshop-visitor-terminal-staging"', 'name = "production-counter"'),
    fixture().STAGING_D1_DATABASE_ID), /safety markers/);
  assert.throws(() => buildStagingConfig(template.replace(
    'database_name = "workshop-visitor-terminal-staging"',
    'database_name = "production-counter"'), fixture().STAGING_D1_DATABASE_ID),
    /safety markers/);
});
test("rejects non-staging, arbitrary or HTTP smoke target origins", () => {
  const hostname = "https://workshop-visitor-terminal-staging.example.workers.dev";
  assert.equal(validateStagingOrigin(hostname), hostname);
  for (const bad of [
    "http://workshop-visitor-terminal-staging.example.workers.dev",
    "https://example.com",
    "https://workshop-visitor-terminal-api.example.workers.dev",
    "https://workshop-visitor-terminal-staging.example.workers.dev/hack",
    "https://workshop-visitor-terminal-staging.example.workers.dev?token=123"
  ]) assert.throws(() => validateStagingOrigin(bad));
});
