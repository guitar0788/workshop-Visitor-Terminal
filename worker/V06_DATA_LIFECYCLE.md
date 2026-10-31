# v0.6 — Owner-scoped published-counter deletion / 已发布计数器删除

## Scope

This change covers **only a published counter** owned by the currently authenticated, GitHub-verified account. It is not account deletion, a transfer of existing admin counters, migration of profile statistics, or a multiuser public release. The existing owner-only pilot allowlist stays enabled.

## 中文说明

- 登录 GitHub 后打开「导出 → 发布到 GitHub → 我的已发布计数器」。
- 找到希望删除的计数器，点击「删除此计数器」。操作初始状态是关闭的，**不会因为载入设计、保存或退出登录而触发**。
- 展开确认区域后，阅读永久删除提示，**手动输入完整计数器 ID**（例如 `v` 加 24 位十六进制字符），再点击「确认永久删除」。可随时点击「取消」。
- 成功后，只删除当前 GitHub 数字用户 ID 拥有的这条 D1 `counters` 记录及关联的 `request_windows` 统计去重记录；其余计数器、设计和历史访问次数不变。
- 删除后，旧地址 `GET /v1/counters/{slug}.svg` 将返回 HTTP 404（可能受已有浏览器/GitHub 图片缓存影响，短时间仍显示旧图片）。所有引用该地址的 README 图片最终失效。**此删除不可撤销。**
- 删除后当前编辑器画布不清空，不会自动创建新计数器；当前选中的计数器若已删除，将解除选中；账户的最多三个发布名额释放一个。
- D1 的备份、快照和第三方缓存可能有独立保留周期。本功能不承诺即时清除各类备份和 CDN 历史缓存；完整账户/个人数据删除另行设计。

## API contract / API 约定

Authenticated same-Studio origin:

```http
DELETE /v1/my/counters/{slug}
Origin: https://guitar0788.github.io
Authorization: Bearer <session>
Content-Type: application/json

{"confirm":"DELETE","confirmSlug":"v..."}
```

Only valid lowercase `v` + 24 hex slugs are supported. The body must include **both** literal `DELETE` and a slug equal to the URL path. Server-side D1 deletion uses `WHERE slug = ? AND owner_user_id = ?` in one atomic statement. It never derives ownership from the mutable GitHub login name.

Expected statuses:

| Status | Meaning |
| --- | --- |
| 200 | `{ "deleted": true, "slug": "..." }` after one successful deletion |
| 400 | Missing or malformed JSON / exact typed confirmation missing |
| 401 | No authenticated allowed pilot session, or expired/revoked token |
| 403 | Origin is not the approved Studio origin |
| 404 | Counter is not owned, not found, malformed slug, or already deleted |
| 405 | Unsupported method (only DELETE allowed for this route) |
| 503 | Temporary database problem or publishing disabled |

**No automatic cleanup sweep deletes live counters.** This is an explicit destructive action on one verified record. The existing D1 migration already defines `request_windows.slug` with `ON DELETE CASCADE`; no new migration or production database is required for this stage.

## Acceptance / 验收

1. Publish and update a test counter; existing count and slug remain stable.
2. Click Delete but cancel; verify the counter remains unchanged.
3. Enter the wrong ID; the destructive action is disabled.
4. Enter the exact ID; delete a disposable test counter only after copying any desired design or README reference.
5. Confirm it disappears from 'My counters', the old SVG eventually returns 404, and the quota frees one slot; the editor design remains open.
6. Try a different account, revoked session, or altered Origin; deletion must be refused without touching counters.
7. Check mobile controls and Chinese/English text; a keyboard entry must not trigger deletion by itself.

## Release gates

- Code/test changes must pass Verify on a PR branch first. **Merging to `main` does not deploy the Worker**, and the repository's tracked `pilot` Pages channel will keep the existing live UI unchanged.
- Real staging activation requires a **separate, explicitly authorized manual OAuth Pilot** run and must not run against any production or profile counter.
- Do not change the user's GitHub profile README or pre-existing Komarev visitor count.
- Public-user enablement remains blocked on verified multi-account isolation, rate/cost controls, complete account data management, backup/retention policy, and production-release review.
