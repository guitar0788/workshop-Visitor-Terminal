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
    data.edgeRateLimitsEnabled !== true ||
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

export async function checkStagingSvgLimiter({ origin, fetchImpl = fetch }) {
  if (validateStagingOrigin(origin) !== APPROVED_STAGING) {
    throw Error("SVG edge protection preflight is scoped to the approved staging Worker");
  }
  // HEAD cannot create or increment a visit receipt, even if the slug exists.
  // A valid but highly improbable slug avoids modifying any real counter.
  const response = await fetchImpl(
    APPROVED_STAGING + "/v1/counters/v000000000000000000000000.svg",
    { method: "HEAD", redirect: "manual", cache: "no-store",
      signal: AbortSignal.timeout(12000) }
  );
  if (![200, 404, 429].includes(response.status) ||
      (response.status === 429 && response.headers.get("Retry-After") !== "60")) {
    throw Error("SVG rate limiter binding unavailable or unexpected HTTP " + response.status);
  }
  return response.status;
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
  const status = await checkStagingSvgLimiter({ origin: process.env.STAGING_ORIGIN });
  console.log("PASS: read-only SVG rate-limiter probe returned HTTP " + status + ".");
}

if (process.argv[1] && /[/\\]verify-budget-staging\.mjs$/.test(process.argv[1])) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : "Budget preflight failed");
    process.exitCode = 1;
  });
}
