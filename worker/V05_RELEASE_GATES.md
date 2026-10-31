# v0.5 发布安全验收 / Release Gate

Status: **Owner-only staging pilot GO; public-user launch NO-GO.**

## 已完成 / Accepted

- Dedicated staging Worker + D1 passed live deployment, deduplication and redeploy persistence in [GitHub Actions #41219117268](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/runs/41219117268).
- Single-account GitHub OAuth and staging frontend deployed successfully in [OAuth Pilot #41223625422](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/runs/41223625422).
- Repository owner manually confirmed authentic GitHub OAuth sign-in; publishing a test counter; owned counter listing; public SVG rendering; README Markdown copy.
- Repository owner manually confirmed editing a published design without resetting counts, anonymous SVG rendering but no anonymous editing, sign-out/re-login data recovery, and mobile login / export.
- Existing code enforces a three-counter limit, origin gate, one-hour hashed bearer sessions, and numeric owner ID checks for editing.
- Additional acceptance tests in [PR #13](https://github.com/guitar0788/workshop-Visitor-Terminal/pull/13) cover the live counter identity and hit total surviving edits, revoked sessions, anonymous/foreign-origin rejection, and pilot-owner allowlist revocation.

## 未批准公开运营 / Public Release Blockers

1. **Deployment channel interference — mitigated for the pilot.** [PR #14](https://github.com/guitar0788/workshop-Visitor-Terminal/pull/14) introduced the tracked `.github/pages-deploy-channel.txt` marker (`pilot`) and safe Pages gate. The successful [push workflow #41226792363](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/runs/41226792363) confirmed ordinary main merges now skip the default-preview Pages deploy. Before opening a public service, a reviewed release-channel transition and production rollout/rollback policy are still required.
2. **User-controlled data lifecycle — high.** There is no authenticated counter deletion, reset, retention notice, or export/delete-account management. Never ask users to consume all three allowed counter slots for repeated tests.
3. **Public abuse and cost controls — high.** OAuth start has a small per-IP rate gate, but hosted SVG requests still incur Worker/D1 cost. Need real edge-level rate controls, observation, quotas, alerting, and documented failure behavior before admitting arbitrary public accounts.
4. **Account expansion / authorization — high.** The pilot deliberately hard-codes GitHub's verified numeric user ID. Do not remove this restriction merely to enable public sign-up; conduct cross-account manual and automated tests and document who can own/create/change counters.
5. **Storage and disaster recovery — medium.** Define backup, migration rollback/recovery, safe D1 schema changes, data export, and incident procedures. No production database has been authorized.
6. **Statistics semantics — medium.** Counts are deduplicated qualifying requests to the Cloudflare image endpoint, not unique humans or exact GitHub README/profile views; GitHub proxy caching can delay image and number updates. Product copy and README embed instructions must state these limits.
7. **Browser authentication hardening — medium.** Exercise OAuth state expiry and replay, ticket expiry and replay, 1-hour session expiry, malicious origins and unfamiliar browsers. Unit tests alone are insufficient for public-release sign-off.

## Remaining owner-only pilot acceptance matrix

| Gate | Test | Expected |
| --- | --- | --- |
| V05-S1 | Sign in with allowed GitHub identity | Account is GitHub-verified, no OAuth secret in browser |
| V05-S2 | Publish a test design | A new stable SVG URL and README Markdown |
| V05-S3 | Change design and save | Same slug/URL, updated design, prior hits preserved |
| V05-S4 | Open SVG anonymously | HTTP 200 image; GET may increment qualifying upstream count |
| V05-S5 | Anonymous editor attempts | Cannot read or modify another user's collection |
| V05-S6 | Log out then revisit | Old bearer credentials revoked; new login retrieves same counter |
| V05-S7 | Phone browser | Login, owned list and Markdown copy operate correctly |
| V05-S8 | Counter session expiration after one hour | Re-login required; no unauthorized save |
| V05-S9 | Upload/edit malformed designs and cross-account access | Rejected without changing saved artwork |
| V05-S10 | Default-pages deployment during pilot | **PASS:** PR #14 release gate skipped main-push preview publication |

## 版本状态与后续合并策略

- **Current production user-facing editor remains a staging pilot** until a separate signed-off public release. Do not replace the user's personal GitHub README or existing counter.
- PR #13 may be merged **after** verifying the PR #14 deployment gate remains on `pilot`; its code merge will not redeploy Pages or Cloudflare automatically. The backend security change must be deployed later through a separate owner-approved manual OAuth Pilot run.
- No Cloudflare/D1 migration, OAuth credential rotation, public registration or Pages deploy is authorized by this acceptance report.
- Do **not** manually click GitHub Actions → Publish Workshop Studio or the default Cloudflare Staging workflow while the pilot must remain enabled; these are explicit rollback workflows that turn the pilot off. A normal main push now safely skips preview publishing.
- To intentionally disable the pilot, follow [OAUTH_PILOT.md](OAUTH_PILOT.md) and verify both Pages and Worker state. D1 records are retained on rollback.

## 用户验证结果 / Manual result

2026-11-01: first and second browser acceptance suites reported successful by the repository owner, including mobile. This is **staging evidence**, not independent proof of multi-account security or production readiness.
