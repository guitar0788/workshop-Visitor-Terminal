import test from "node:test";
import assert from "node:assert/strict";
import {
  POLICY_NAME, createWorkerSpendNotification, parseArgs, runUsageAlertCommand
} from "../scripts/cloudflare-spend-alerts.mjs";

const accountId = "a".repeat(32);
const token = "cloudflare-secret-token-value-123456";
const email = "private-alert@example.com";
const env = { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token };
const response = (result, status = 200, success = true) =>
  new Response(JSON.stringify({ success, result }), {
    status, headers: { "Content-Type": "application/json" }
  });

test("CLI is read-only by default and rejects unrecognized or unsafe actions", () => {
  assert.deepEqual(parseArgs([]), {
    apply: false, confirm: false, thresholdCents: null, email: null, help: false
  });
  assert.throws(() => parseArgs(["--apply"]), /confirm-create-notification/);
  assert.throws(() => parseArgs(["--apply", "--confirm-create-notification",
    "--threshold-cents", "0", "--email", email]), /threshold-cents/);
  assert.throws(() => parseArgs(["--apply", "--confirm-create-notification",
    "--threshold-cents", "100", "--email", "not-an-email"]), /email/);
  assert.throws(() => parseArgs(["--usage-block"]), /Unknown option/);
});

test("default command only reads Workers policies and never prints secrets", async () => {
  const calls = [];
  const output = [];
  const code = await runUsageAlertCommand([], env, { write: value => output.push(value) },
    async (url, init) => {
      calls.push({ url: String(url), init });
      return response([
        { name: "other", product_id: "workers", action: "notification",
          enabled: true, threshold_cents: 2500, notification_email: email },
        { name: "blocker", product_id: "workers", action: "usage_block",
          enabled: true, threshold_cents: 5000 },
        { name: "unrelated", product_id: "durable_objects", action: "notification",
          enabled: true, threshold_cents: 500 }
      ]);
    });
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.match(calls[0].url, /billing\/spend-policies$/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer " + token);
  assert.equal(calls[0].init.body, undefined);
  const log = output.join("\n");
  for (const secret of [token, accountId, email]) assert.equal(log.includes(secret), false);
  assert.match(log, /1 notification, 1 usage-block/);
  assert.match(log, /No Cloudflare settings changed/);
});

test("explicit apply creates only an enabled Workers notification policy", async () => {
  const calls = [];
  const output = [];
  const args = ["--apply", "--confirm-create-notification",
    "--threshold-cents", "125", "--email", email];
  const code = await runUsageAlertCommand(args, env, { write: value => output.push(value) },
    async (url, init) => {
      calls.push({ url: String(url), init });
      if (init.method === "GET") return response([]);
      const body = JSON.parse(init.body);
      return response({
        action: "notification", product_id: "workers", enabled: true,
        threshold_cents: 125, notification_email: body.notification_email
      });
    });
  assert.equal(code, 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "POST");
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body, {
    action: "notification", enabled: true, name: POLICY_NAME,
    product_id: "workers", threshold_cents: 125, notification_email: email
  });
  assert.equal(JSON.stringify(body).includes("usage_block"), false);
  const log = output.join("\n");
  for (const secret of [token, accountId, email]) assert.equal(log.includes(secret), false);
  assert.match(log, /1.25 USD/);
  assert.match(log, /does not block usage/);
});

test("an existing named policy is never silently changed or duplicated", async () => {
  const calls = [];
  const output = [];
  await runUsageAlertCommand([
    "--apply", "--confirm-create-notification",
    "--threshold-cents", "200", "--email", email
  ], env, { write: value => output.push(value) }, async (_url, init) => {
    calls.push(init.method);
    return response([{
      name: POLICY_NAME, product_id: "workers", action: "notification",
      enabled: true, threshold_cents: 100
    }]);
  });
  assert.deepEqual(calls, ["GET"]);
  assert.match(output.join("\n"), /already exists/);
  assert.match(output.join("\n"), /No policy changed/);
});

test("API failures suppress provider response bodies and credentials", async () => {
  await assert.rejects(
    runUsageAlertCommand([], env, { write: () => {} }, async () =>
      new Response(JSON.stringify({
        success: false, errors: [{ message: "private detail " + token + " " + accountId }]
      }), { status: 403 })),
    error => {
      assert.match(error.message, /HTTP 403/);
      assert.equal(error.message.includes(token), false);
      assert.equal(error.message.includes(accountId), false);
      return true;
    }
  );
});

test("invalid local credentials fail before any network request", async () => {
  let called = false;
  await assert.rejects(
    runUsageAlertCommand([], {}, { write: () => {} }, async () => {
      called = true;
      return response([]);
    }),
    /CLOUDFLARE_ACCOUNT_ID/
  );
  assert.equal(called, false);
});

test("direct helper calls reject unsafe thresholds and recipients before network access", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return response({});
  };
  await assert.rejects(createWorkerSpendNotification({
    accountId, token, thresholdCents: 0, email, fetchImpl
  }), /threshold/);
  await assert.rejects(createWorkerSpendNotification({
    accountId, token, thresholdCents: 100, email: "not-an-email", fetchImpl
  }), /recipient/);
  assert.equal(called, false);
});

test("transport failures do not echo provider error details or credentials", async () => {
  await assert.rejects(
    runUsageAlertCommand([], env, { write: () => {} }, async () => {
      throw new Error("network failure " + token + " " + accountId);
    }),
    error => {
      assert.match(error.message, /details suppressed/);
      assert.equal(error.message.includes(token), false);
      assert.equal(error.message.includes(accountId), false);
      return true;
    }
  );
});

test("an existing named usage-block policy is reported but never modified", async () => {
  const calls = [];
  const output = [];
  await runUsageAlertCommand([
    "--apply", "--confirm-create-notification",
    "--threshold-cents", "200", "--email", email
  ], env, { write: value => output.push(value) }, async (_url, init) => {
    calls.push(init.method);
    return response([{
      name: POLICY_NAME, product_id: "workers", action: "usage_block",
      enabled: true, threshold_cents: 100
    }]);
  });
  assert.deepEqual(calls, ["GET"]);
  assert.match(output.join("\\n"), /not a notification/);
  assert.match(output.join("\\n"), /No policy changed/);
});
