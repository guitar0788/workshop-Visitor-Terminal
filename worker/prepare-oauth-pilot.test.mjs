import test from "node:test";
import assert from "node:assert/strict";
import {
  APPROVED_GITHUB_USER_ID, APPROVED_ORIGIN, APPROVED_STUDIO,
  prepareOAuthPilot
} from "./prepare-oauth-pilot.mjs";

const template = [
  'name = "workshop-visitor-terminal-staging"',
  'main = "worker/index.ts"',
  'workers_dev = true',
  'database_name = "workshop-visitor-terminal-staging"',
  'database_id = "STAGING_D1_ID_PLACEHOLDER"',
  '[vars]',
  'PUBLISHING_ENABLED = "false"'
].join("\n");

const fixture = () => ({
  STAGING_ORIGIN: APPROVED_ORIGIN,
  PILOT_GITHUB_USER_ID: APPROVED_GITHUB_USER_ID,
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "cloudflare-" + "b".repeat(40),
  STAGING_D1_DATABASE_ID: "3a52f952-852f-4b53-8cb0-8492d08d626c",
  STAGING_ADMIN_TOKEN: "admin-" + "c".repeat(40),
  STAGING_VISIT_HASH_SECRET: "hash-" + "d".repeat(40),
  GITHUB_CLIENT_ID: "Ov23liExampleClient123456",
  GITHUB_CLIENT_SECRET: "ghsecret-" + "e".repeat(45)
});

test("prepares strictly allowlisted staging OAuth configuration", () => {
  const result = prepareOAuthPilot(fixture(), template);
  assert.match(result.config, /^PUBLISHING_ENABLED = "true"$/m);
  assert(result.config.includes('STUDIO_ORIGIN = "' + APPROVED_STUDIO + '"'));
  assert(result.config.includes('PUBLIC_API_ORIGIN = "' + APPROVED_ORIGIN + '/"'));
  assert(result.config.includes('PILOT_GITHUB_USER_ID = "' + APPROVED_GITHUB_USER_ID + '"'));
  assert(!result.config.includes(fixture().GITHUB_CLIENT_SECRET));
  assert.equal(result.workerSecrets.GITHUB_CLIENT_ID, fixture().GITHUB_CLIENT_ID);
  assert.equal(result.workerSecrets.GITHUB_CLIENT_SECRET, fixture().GITHUB_CLIENT_SECRET);
  assert.equal(result.workerSecrets.ADMIN_TOKEN, fixture().STAGING_ADMIN_TOKEN);
});
test("refuses any nonapproved worker hostname, owner account or modified template", () => {
  for (const bad of [
    { STAGING_ORIGIN: "https://example.com" },
    { STAGING_ORIGIN: "https://workshop-visitor-terminal-staging.other.workers.dev" },
    { PILOT_GITHUB_USER_ID: "999" },
    { GITHUB_CLIENT_ID: "" },
    { GITHUB_CLIENT_SECRET: "" },
    { GITHUB_CLIENT_SECRET: "short" },
    { GITHUB_CLIENT_SECRET: fixture().STAGING_ADMIN_TOKEN },
    { GITHUB_CLIENT_ID: fixture().CLOUDFLARE_API_TOKEN }
  ]) {
    assert.throws(() => prepareOAuthPilot({ ...fixture(), ...bad }, template));
  }
  assert.throws(() => prepareOAuthPilot(fixture(),
    template.replace('PUBLISHING_ENABLED = "false"', 'PUBLISHING_ENABLED = "true"')));
  assert.throws(() => prepareOAuthPilot(fixture(),
    template.replace('name = "workshop-visitor-terminal-staging"',
      'name = "production-counter"')));
});
