#!/usr/bin/env node
/**
 * Read-only, owner-authorized live D1 budget verification for staging.
 * This NEVER creates, deletes, resets, or increments a counter and NEVER
 * prints the admin secret or any account/user data.
 */
import { validateStagingOrigin } from "./prepare-staging.mjs";

export const APPROVED_STAGING =
  "https://workshop-visitor-terminal-staging.fangcui2007.workers.dev";

export function validateUsage(data) {
  if (!data || typeof data !== "object" ||
    typeof data.utcDay !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.utcDay) ||
    data.maxDailyAdmitted !== 20_000 ||
    !Number.isSafeInteger(data.admitted) || data.admitted < 0 ||
    data.admitted > 20_000 || data.remaining !== 20_000 - data.admitted ||
    data.edgeLimitPerMinutePerCounter !== 60 ||
    data.edgeLimitPerMinutePerLocation !== 120) {
    throw Error("Unexpected staging rate-budget policy or malformed usage response");
  }
  return { date: data.utcDay, used: data.admitted, left: data.remaining };
}

export async function fetchStagingUsage({ origin, token, fetchImpl = fetch }) {
  if (validateStagingOrigin(origin) !== APPROVED_STAGING) {
    throw Error("Staging budget preflight is scoped to the approved Cloudflare Worker");
  }
  if (typeof token !== "string" || token.length < 32) {
    throw Error("Missing valid staging admin credential");
  }
  const response = await fetchImpl(APPROVED_STAGING + "/v1/admin/usage", {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      "Cache-Control": "no-cache"
    },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    throw Error("Staging budget check rejected: HTTP " + response.status);
  }
  return validateUsage(await response.json());
}

async function main() {
  const info = await fetchStagingUsage({
    origin: process.env.STAGING_ORIGIN,
    token: process.env.STAGING_ADMIN_TOKEN
  });
  console.log(
    "PASS: read-only UTC-day D1 write budget " + info.date +
    ": " + info.used + "/20000 admitted, " + info.left + " remaining."
  );
  if (info.left === 0) {
    console.log("WARNING: today's admitted visit budget exhausted; SVG images remain readable.");
  }
}

if (process.argv[1] && /[/\\]verify-budget-staging\.mjs$/.test(process.argv[1])) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : "Budget preflight failed");
    process.exitCode = 1;
  });
}
