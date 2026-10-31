# v0.4 Cloudflare Worker + D1 counter prototype

**Stage: local Wrangler integration tests, NOT deployed.** Workshop Studio on GitHub Pages remains a static editor; its preview values are examples.

## Endpoints

| Method | Path | Purpose | Auth |
| --- | --- | --- | --- |
| GET | /health | Basic health response (does not test D1) | None |
| GET | /v1/counters/{slug}.svg | Show an SVG and count a qualifying upstream request | Public |
| HEAD | /v1/counters/{slug}.svg | Check SVG availability without counting | Public |
| POST | /v1/admin/counters | Register one counter | Bearer ADMIN_TOKEN |
| GET | /v1/admin/counters/{slug} | Review count and legacy provenance | Bearer ADMIN_TOKEN |
| POST | /v1/admin/counters/{slug}/design | Replace sanitized SVG design | Bearer ADMIN_TOKEN |
| POST | /v1/admin/counters/{slug}/legacy | One-time historical baseline | Bearer ADMIN_TOKEN |

No public signup, public design updates, or shared hosting UI in v0.4. Never copy an ADMIN_TOKEN into client-side JavaScript or a public README.

## Request counting semantics

A hit is a qualifying **upstream image request** reaching this Worker, not a human profile view or a unique visitor.

- One counted request at most per counter, IP-based HMAC fingerprint, and **five-minute window**. The digest is pseudonymous; raw IPs and User-Agent values are not stored.
- GitHub Camo proxies, GitHub's own image cache, shared public IPs, bots, and browser caching make this an imperfect metric. A GitHub proxy can represent many people; therefore this metric **must never be called Unique Visitors**.
- Without the Cloudflare-provided CF-Connecting-IP header, the Worker serves the image but does not increment the number.
- HEAD requests do not increment. Counter totals survive Workers redeployments because they live in D1.
- The five-minute window data is pruned by an hourly scheduled Worker.
- HMAC and rate windows reduce accidental abuse; **this is not a complete anti-bot solution**. Public launch needs Cloudflare rate limits/WAF, monitoring and quota alerts before open enrollment.
- **Atomic counting:** migration `0002_atomic_increment.sql` installs an SQLite `AFTER INSERT` trigger. Each accepted request receipt and its count increment happen in one D1 transaction; duplicate inserts do not run the trigger.
- Returning Cache-Control: max-age=60 does not override GitHub's image caching policy.

## Local preparation

Use Node.js 20 or later.

1. Create a Cloudflare account; install the Wrangler CLI locally: npm install -D wrangler (or use npx wrangler).
2. Create your D1 database: npx wrangler d1 create workshop-visitor-terminal
3. Copy wrangler.example.toml to wrangler.toml and replace the placeholder database_id with the **actual ID** returned from step 2. Keep this file out of Git.
4. Apply migrations locally first:
   npx wrangler d1 migrations apply workshop-visitor-terminal --local
5. Create a local-only .dev.vars file (not committed) with two **different random secrets**, each at least 32 characters:
   ADMIN_TOKEN=...
   VISIT_HASH_SECRET=...
6. Run npx wrangler dev to test the Worker with local D1.
7. Run npm test and npm run build from repository root; offline service tests run without Cloudflare credentials.
8. Run `node worker/local-smoke.mjs` after applying migrations. This launches Wrangler locally, tests actual HTTP requests against D1, stops and restarts the Worker, and verifies counts survive. The script generates disposable secrets and removes its `.dev.vars` file; **do not run it in a directory containing your own `.dev.vars`**.

## Deploy — requires a separate authorization decision

Do not deploy just because a PR has been merged.

After a test environment and security review, the repository owner must intentionally:

1. Confirm actual Cloudflare account, D1 database ID, worker name and billing exposure.
2. Apply remote D1 migrations with explicit --remote, using the correct database.
3. Store ADMIN_TOKEN and VISIT_HASH_SECRET as Cloudflare Worker **secrets**, not code or regular variables:
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put VISIT_HASH_SECRET
4. Deploy using npx wrangler deploy.
5. Check health and test SVG/HEAD behavior in an isolated counter before embedding anything in a profile README.

### Example admin payloads

Create (only with the secret):
~~~json
{"slug":"demo","owner":"guitar0788"}
~~~

Set a design (design data comes from Studio's exported JSON):
~~~json
{"design":{"schemaVersion":1,"theme":"pixel","width":420,"height":220,"background":"#101820","accent":"#7ee787","layers":[]}}
~~~

Apply **verified legacy baseline once, before any live requests**:
~~~json
{"hits":123,"source":"https://komarev.com/ghpvc/?username=example","capturedAt":"2026-10-31T00:00:00Z"}
~~~
These counts are **illustrative**, not an actual user's history. Save evidence of the source and timestamp; the Worker enforces one-time seeding and refuses to overwrite an active counter.

### Operational details

- SQLite migrations are in worker/migrations. Never edit already-applied migrations. `0002` depends on `0001` and is required before running this Worker version.
- D1 database_ID is specific to your account. The template ID intentionally is not deployable.
- Request-deduplication rows expire and are pruned, but total hits persist.
- The Worker refuses to serve counts if its required secrets are missing.
- This code is a controlled prototype, not an audited production multi-tenant service.
