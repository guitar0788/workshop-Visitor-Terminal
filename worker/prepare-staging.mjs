#!/usr/bin/env node
/**
 * Validates staging-only GitHub Actions credentials and writes an ignored
 * Wrangler config + an ephemeral secrets JSON without printing secret values.
 *
 * This file has no Cloudflare network access and never deploys anything.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT = /^[0-9a-f]{32}$/i;
const PLACEHOLDER = "STAGING_D1_ID_PLACEHOLDER";

export function validateStagingSecrets(e) {
  const values = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN",
    "STAGING_D1_DATABASE_ID", "STAGING_ADMIN_TOKEN",
    "STAGING_VISIT_HASH_SECRET"];
  for (const key of values) {
    if (typeof e[key] !== "string" || !e[key].trim()) {
      throw Error("Missing required staging configuration: " + key);
    }
  }
  if (!ACCOUNT.test(e.CLOUDFLARE_ACCOUNT_ID)) {
    throw Error("Invalid Cloudflare account ID format");
  }
  if (!UUID.test(e.STAGING_D1_DATABASE_ID) ||
      /^00000000-0000-0000-0000-000000000000$/i.test(e.STAGING_D1_DATABASE_ID)) {
    throw Error("Staging D1 ID must be a real non-placeholder UUID");
  }
  if (e.STAGING_ADMIN_TOKEN.length < 32 || e.STAGING_VISIT_HASH_SECRET.length < 32 ||
      e.STAGING_ADMIN_TOKEN === e.STAGING_VISIT_HASH_SECRET) {
    throw Error("Staging Worker secrets must be two different 32+ character values");
  }
  if (e.STAGING_ADMIN_TOKEN === e.CLOUDFLARE_API_TOKEN ||
      e.STAGING_VISIT_HASH_SECRET === e.CLOUDFLARE_API_TOKEN) {
    throw Error("Cloudflare API token cannot be reused as a Worker secret");
  }
  return {
    databaseId: e.STAGING_D1_DATABASE_ID,
    workerSecrets: {
      ADMIN_TOKEN: e.STAGING_ADMIN_TOKEN,
      VISIT_HASH_SECRET: e.STAGING_VISIT_HASH_SECRET
    }
  };
}

export function buildStagingConfig(template, databaseId) {
  if (!UUID.test(databaseId) || !template.includes(PLACEHOLDER)) {
    throw Error("Invalid staging template or database ID");
  }
  if (!template.includes('name = "workshop-visitor-terminal-staging"') ||
      !template.includes('database_name = "workshop-visitor-terminal-staging"') ||
      !template.includes('workers_dev = true')) {
    throw Error("Staging template safety markers are missing");
  }
  return template.replace(PLACEHOLDER, databaseId);
}

export function validateStagingOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      !/^workshop-visitor-terminal-staging\.[a-z0-9-]+\.workers\.dev$/i.test(url.hostname) ||
      url.port !== "") {
    throw Error("Staging origin must be the exact HTTPS workers.dev hostname for the staging Worker");
  }
  return url.origin;
}

async function main() {
  const { databaseId, workerSecrets } = validateStagingSecrets(process.env);
  const template = await readFile("wrangler.staging.example.toml", "utf8");
  const config = buildStagingConfig(template, databaseId);
  const dir = process.env.RUNNER_TEMP;
  if (!dir) throw Error("RUNNER_TEMP is required");
  const secretPath = join(dir, "wvt-staging-worker-secrets.json");
  // wx avoids silently overwriting a pre-existing test or credential file.
  await writeFile("wrangler.staging.toml", config, { flag: "wx", mode: 0o600 });
  await writeFile(secretPath, JSON.stringify(workerSecrets), { flag: "wx", mode: 0o600 });
  console.log("Staging configuration validated. Secret contents are never logged.");
}
if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Staging setup failed");
    process.exitCode = 1;
  });
}
