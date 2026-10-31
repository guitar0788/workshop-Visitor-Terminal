#!/usr/bin/env node
/**
 * Read-only Cloudflare staging readiness probe.
 * A just-deployed workers.dev route can briefly return an HTML error page.
 * This script never sends credentials, changes a counter, or prints HTML bodies.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { validateStagingOrigin } from "./prepare-staging.mjs";

const healthPath = "/health";
const expectedService = "workshop-visitor-terminal";

function clean(value, limit = 100) {
  return String(value ?? "")
    .replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, limit);
}

/** Safe to print in a public GitHub Actions log: never includes a body or a token. */
export function describeResponse(response, body = "") {
  const type = clean(response.headers.get("content-type") ?? "(missing)", 90);
  const ray = clean(response.headers.get("cf-ray") ?? "(none)", 80);
  const title = /<title[^>]*>([^<]{0,140})<\/title>/i.exec(body)?.[1];
  return "HTTP " + response.status + "; content-type=" + type + "; cf-ray=" + ray +
    (title ? "; HTML title=" + clean(title, 120) : "");
}

/**
 * Confirm a real Worker API response before doing ANY staging test writes.
 * The caller can inject fetch/pause for deterministic offline tests.
 */
export async function waitForStagingHealth(origin, {
  fetchImpl = fetch,
  pause = ms => sleep(ms),
  attempts = 30,
  delayMs = 2500
} = {}) {
  const target = validateStagingOrigin(origin) + healthPath;
  let last = "no response";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(target, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "application/json", "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(10000)
      });
      const body = await response.text();
      const type = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (response.status === 200 && type.includes("application/json")) {
        try {
          const parsed = JSON.parse(body);
          if (parsed?.status === "ok" && parsed?.service === expectedService) {
            return { attempt, health: parsed };
          }
          last = "HTTP 200 JSON received, but not the expected staging service";
        } catch {
          last = "HTTP 200 application/json response contained invalid JSON";
        }
      } else {
        last = describeResponse(response, body);
      }
    } catch (error) {
      // Never put an untrusted exception, URL query string or raw HTML in logs.
      last = "Network request failed (" +
        clean(error instanceof Error ? error.name : "unknown error", 40) + ")";
    }
    if (attempt < attempts) await pause(delayMs);
  }

  throw new Error(
    "Staging Worker /health did not become ready after " + attempts +
    " read-only attempts. Last response: " + last +
    ". Check Cloudflare Workers & Pages > workshop-visitor-terminal-staging " +
    "> Settings > Domains & Routes (workers.dev enabled), and check " +
    "whether Cloudflare Access or an edge challenge is returning HTML. " +
    "No staging counters were created by this preflight."
  );
}

async function main() {
  const origin = process.env.STAGING_ORIGIN;
  const outcome = await waitForStagingHealth(origin);
  console.log(
    "PASS: Cloudflare staging /health returned expected JSON on attempt " +
    outcome.attempt + "; no counter data was changed."
  );
}

if (process.argv[1] && /[/\\]health-preflight\.mjs$/.test(process.argv[1])) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Staging health check failed");
    process.exitCode = 1;
  });
}
