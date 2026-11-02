#!/usr/bin/env node
/**
 * Read-only by default. Optionally create one Workers spend notification.
 * Never creates usage_block policies, updates existing policies, or logs
 * account IDs, API tokens, notification email addresses, or API response bodies.
 */
import process from "node:process";

const API = "https://api.cloudflare.com/client/v4/accounts/";
export const POLICY_NAME = "Workshop Visitor Terminal — Workers spend notification";

export function parseArgs(argv) {
  const options = { apply: false, confirm: false, thresholdCents: null, email: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--confirm-create-notification") options.confirm = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--threshold-cents") {
      const value = argv[++i];
      if (!value || !/^\d+$/.test(value)) throw new Error("Invalid --threshold-cents.");
      options.thresholdCents = Number(value);
    } else if (arg === "--email") {
      options.email = argv[++i] ?? null;
    } else {
      throw new Error("Unknown option: " + arg);
    }
  }
  if (options.apply) {
    if (!options.confirm) throw new Error("Creation requires --confirm-create-notification.");
    if (!Number.isSafeInteger(options.thresholdCents) ||
        options.thresholdCents < 1 || options.thresholdCents > 100000000) {
      throw new Error("Creation requires --threshold-cents between 1 and 100000000.");
    }
    if (typeof options.email !== "string" ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.email) ||
        options.email.length > 254) {
      throw new Error("Creation requires a valid bare --email address.");
    }
  }
  return options;
}

function credentials(env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("Set CLOUDFLARE_ACCOUNT_ID to the 32-character account ID.");
  }
  if (typeof token !== "string" || token.length < 20) {
    throw new Error("Set CLOUDFLARE_API_TOKEN in the local process environment.");
  }
  return { accountId, token };
}

async function requestPolicies(accountId, token, method, body, fetchImpl) {
  const response = await fetchImpl(API + encodeURIComponent(accountId) +
    "/billing/spend-policies", {
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000)
    });
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !payload || payload.success !== true) {
    // Cloudflare error bodies may contain account metadata; suppress them.
    throw new Error("Cloudflare Billing API request failed (HTTP " +
      response.status + "); details suppressed.");
  }
  return payload.result;
}

export async function listWorkerSpendPolicies({ accountId, token, fetchImpl = fetch }) {
  const result = await requestPolicies(accountId, token, "GET", null, fetchImpl);
  if (!Array.isArray(result)) throw new Error("Cloudflare returned an unexpected policy list.");
  return result.filter(item => item && item.product_id === "workers" &&
    (item.action === "notification" || item.action === "usage_block") &&
    typeof item.enabled === "boolean" && Number.isSafeInteger(item.threshold_cents));
}

export async function createWorkerSpendNotification({
  accountId, token, thresholdCents, email, fetchImpl = fetch
}) {
  const result = await requestPolicies(accountId, token, "POST", {
    action: "notification",
    enabled: true,
    name: POLICY_NAME,
    product_id: "workers",
    threshold_cents: thresholdCents,
    notification_email: email
  }, fetchImpl);
  if (!result || result.action !== "notification" || result.product_id !== "workers" ||
      result.enabled !== true || result.threshold_cents !== thresholdCents) {
    throw new Error("Cloudflare did not confirm the requested notification-only policy.");
  }
  return result;
}

export async function runUsageAlertCommand(argv, env = process.env, io = {}, fetchImpl = fetch) {
  const write = io.write ?? (value => process.stdout.write(value + "\n"));
  const options = parseArgs(argv);
  if (options.help) {
    write("Read-only: node scripts/cloudflare-spend-alerts.mjs\n" +
      "Create: --apply --confirm-create-notification --threshold-cents 100 --email alerts@example.com\n" +
      "Requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in the local environment.\n" +
      "Only creates Workers action=notification; never creates usage_block.");
    return 0;
  }
  const { accountId, token } = credentials(env);
  const policies = await listWorkerSpendPolicies({ accountId, token, fetchImpl });
  const notifications = policies.filter(policy => policy.action === "notification");
  const blockers = policies.filter(policy => policy.action === "usage_block");
  const existing = policies.find(policy => policy.name === POLICY_NAME);
  write("Workers spend policies: " + notifications.length + " notification, " +
    blockers.length + " usage-block.");
  if (existing) {
    write("Workshop Visitor Terminal policy already exists (" + existing.action +
      ", enabled=" + existing.enabled + ", threshold=" +
      (existing.threshold_cents / 100).toFixed(2) + " USD). No policy changed.");
    if (existing.action !== "notification") {
      write("WARNING: the existing named policy is not a notification; review it manually.");
    }
    return 0;
  }
  if (!options.apply) {
    write("Read-only check complete. No Cloudflare settings changed.");
    return 0;
  }
  await createWorkerSpendNotification({
    accountId, token, thresholdCents: options.thresholdCents,
    email: options.email, fetchImpl
  });
  write("Created a Workers spend notification at " +
    (options.thresholdCents / 100).toFixed(2) +
    " USD. It sends email only and does not block usage.");
  return 0;
}

const invoked = process.argv[1] &&
  new URL(import.meta.url).pathname === new URL("file://" + process.argv[1]).pathname;
if (invoked) {
  runUsageAlertCommand(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  }).catch(error => {
    process.stderr.write((error instanceof Error ? error.message : "Usage alert check failed") + "\n");
    process.exitCode = 1;
  });
}
