# Cloudflare usage and spend alerts

**Status:** Safe CLI helper and operational guidance only. No Cloudflare account was queried or changed during development.

## 1. Account-wide spend budget alert — preferred cost warning

Cloudflare's **Budget alerts** monitor account-wide usage-based spend, not only this Worker.

For eligible Pay-as-you-go accounts:

1. Sign in to the Cloudflare Dashboard and select the correct account.
2. Open **Manage Account → Billing → Billable Usage**.
3. Select **Create budget alert**.
4. Add a low warning threshold first, then a higher threshold if useful (for example, $1 and $3).
5. Add the notification recipient and save.
6. Return to **Billable Usage → Budget alerts** and verify the alerts exist.

Important limitations:

- Cloudflare documents Budget alerts as available to **Pay-as-you-go accounts only**; Enterprise contract accounts are not supported. If the current account does not expose this feature, do not assume a Free account has an equivalent account-wide email alert.
- Alerts are informational. They do not cap, pause, or block usage.
- The alert is based on account-wide usage-based spend. Fixed plan subscription fees are not included.
- Cloudflare evaluates usage daily; this is not an immediate per-request emergency alarm. The invoice remains authoritative.
- This alert covers all usage-based products in the selected account, not just Workshop Visitor Terminal.

Official documentation:
- https://developers.cloudflare.com/billing/manage/budget-alerts/
- https://developers.cloudflare.com/billing/manage/billable-usage/
- https://developers.cloudflare.com/billing/understand/usage-based-billing/

## 2. Optional Workers-specific spend notification

The repository includes `scripts/cloudflare-spend-alerts.mjs` for the official Cloudflare Billing Spend Policies API.

- Default execution is **read-only**: it lists Workers spend policies and reports only action counts and the configured Workshop Visitor Terminal policy's threshold.
- It never prints the Cloudflare account ID, API token, notification email, policy ID, or provider response body.
- It never updates or deletes an existing policy.
- Creation requires all three explicit options: `--apply`, `--confirm-create-notification`, and a valid `--threshold-cents` plus `--email`.
- It can create only `product_id=workers`, `action=notification`, `enabled=true`.
- It never creates `usage_block`. It never changes an existing usage-block policy.
- It does not create Cloudflare's account-wide Budget alert. The two products are different.

Use a Cloudflare API token restricted to the intended account with the necessary Billing read permission for inspection; creation additionally needs Billing write permission. Keep `CLOUDFLARE_API_TOKEN` in a local environment variable or approved secret manager. Never place it in command-line arguments, shell history, source files, CI logs, GitHub Secrets for this project, or chat.

Read-only:

```sh
node scripts/cloudflare-spend-alerts.mjs
```

Explicit Workers-only notification creation (example: 1.00 USD):

```sh
node scripts/cloudflare-spend-alerts.mjs --apply --confirm-create-notification --threshold-cents 100 --email alerts@example.com
```

The CLI requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the process environment. **Do not run the creation command unless the account owner has chosen the threshold and recipient.** The development task does not run either command against a real account.

Official API:
- https://developers.cloudflare.com/api/resources/billing/subresources/spend_policies/

## 3. Existing application-level hard guards are not account-wide quotas

The Worker already has two independent safeguards:

- An optional Cloudflare edge rate limiter that rejects bursts before D1.
- A global D1 cap of 20,000 newly admitted unique visit receipts per UTC day. `GET /v1/admin/usage` exposes the current internal admission budget to the ADMIN_TOKEN.

These controls limit this application's admitted visit writes. They do **not** cap all Worker invocations, D1 reads, other applications in the Cloudflare account, or the Cloudflare bill.

Do not use GraphQL Analytics request totals as a substitute for invoice/billable-usage data. Cloudflare explicitly documents that GraphQL Analytics is not a measure of billable usage.

## 4. Operational response

If an alert fires:

1. Open Billable Usage and identify which product caused the increase.
2. Check Workers and D1 metrics separately; compare them with the Worker admission budget.
3. If unexpected SVG traffic is suspected, inspect the configured edge rate limiter and WAF/rate-limit settings before changing the global D1 budget.
4. Do not delete counters, reset visit totals, or restore D1 as a cost-control measure.
5. If spend continues unexpectedly, disable publishing or the affected Worker only through an explicitly reviewed owner action. An alert itself does not stop usage.

No new Cloudflare resource, Worker, D1 database, R2 bucket, Cron job, or paid add-on is required for these instructions.
