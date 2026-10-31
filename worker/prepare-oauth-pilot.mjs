#!/usr/bin/env node
/**
 * Manual, isolated, one-owner OAuth pilot preparation.
 * No remote calls and no credential values printed to standard output.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildStagingConfig, validateStagingOrigin, validateStagingSecrets } from "./prepare-staging.mjs";

export const APPROVED_ORIGIN =
  "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev";
export const APPROVED_STUDIO =
  "https://guitar0788.github.io/workshop-Visitor-Terminal/";
export const APPROVED_GITHUB_USER_ID = "124379632";

export function prepareOAuthPilot(environment, template) {
  const base = validateStagingSecrets(environment);
  if (validateStagingOrigin(environment.STAGING_ORIGIN) !== APPROVED_ORIGIN) {
    throw Error("OAuth pilot may only use the pre-approved staging workers.dev hostname");
  }
  if (environment.PILOT_GITHUB_USER_ID !== APPROVED_GITHUB_USER_ID) {
    throw Error("OAuth pilot requires the verified owner numeric GitHub ID");
  }
  const id = environment.GITHUB_CLIENT_ID;
  const secret = environment.GITHUB_CLIENT_SECRET;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(id) ||
      typeof secret !== "string" || secret.trim().length < 16) {
    throw Error("Missing or invalid GitHub OAuth App credentials in environment secrets");
  }
  if ([base.workerSecrets.ADMIN_TOKEN, base.workerSecrets.VISIT_HASH_SECRET,
       environment.CLOUDFLARE_API_TOKEN].includes(secret) ||
      [base.workerSecrets.ADMIN_TOKEN, base.workerSecrets.VISIT_HASH_SECRET,
       environment.CLOUDFLARE_API_TOKEN].includes(id)) {
    throw Error("GitHub OAuth credentials must not reuse Cloudflare or admin secrets");
  }
  const original = buildStagingConfig(template, base.databaseId);
  if (!/^PUBLISHING_ENABLED\s*=\s*"false"\s*$/m.test(original)) {
    throw Error("Refusing to enable OAuth without the explicit default-off staging template");
  }
  const config = original.replace(
    /^PUBLISHING_ENABLED\s*=\s*"false"\s*$/m,
    'PUBLISHING_ENABLED = "true"\n' +
    'STUDIO_ORIGIN = "' + APPROVED_STUDIO + '"\n' +
    'PUBLIC_API_ORIGIN = "' + APPROVED_ORIGIN + '/"\n' +
    'PILOT_GITHUB_USER_ID = "' + APPROVED_GITHUB_USER_ID + '"'
  );
  return {
    config,
    workerSecrets: {
      ...base.workerSecrets,
      GITHUB_CLIENT_ID: id,
      GITHUB_CLIENT_SECRET: secret
    }
  };
}

async function main() {
  const template = await readFile("wrangler.staging.example.toml", "utf8");
  const { config, workerSecrets } = prepareOAuthPilot(process.env, template);
  if (!process.env.RUNNER_TEMP) throw Error("RUNNER_TEMP missing");
  const secretFile = join(process.env.RUNNER_TEMP, "wvt-oauth-pilot-secrets.json");
  await writeFile("wrangler.staging.toml", config, { flag: "wx", mode: 0o600 });
  await writeFile(secretFile, JSON.stringify(workerSecrets), { flag: "wx", mode: 0o600 });
  console.log("Validated staging-only OAuth pilot configuration for approved user ID.");
  console.log("OAuth credentials are never printed or stored in source control.");
}
if (process.argv[1] && /[/\\]prepare-oauth-pilot\.mjs$/.test(process.argv[1])) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "OAuth pilot configuration error");
    process.exitCode = 1;
  });
}
