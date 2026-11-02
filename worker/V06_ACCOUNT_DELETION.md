# v0.6 — Complete application-account data deletion

**Status:** API implementation and deterministic tests on a development branch. The endpoint is disabled by default. No remote account or D1 data has been deleted.

## 中文说明

### 删除范围

此操作删除当前已登录、由 GitHub OAuth 服务端验证的**数字 GitHub 用户 ID**在 Workshop Visitor Terminal 中持有的数据：

1. 该 ID 拥有的全部 `counters` 记录（包括设计、公开 SVG slug、累计访问数和创建时间）。
2. 这些计数器关联的全部 `request_windows` 记录（短期访客 HMAC 指纹和去重窗口）。
3. 该 ID 尚未使用的 `publish_login_tickets`。
4. 该 ID 的全部 `publish_sessions`，使所有设备立即退出。

四组删除通过 Cloudflare D1 `batch()` 在同一个事务中执行。若运行环境不支持原子 batch，接口失败关闭，不会降级成可能只删除一部分的连续 SQL 操作。

### 不删除的内容

- 不会删除或修改 GitHub 账户、GitHub 仓库、README 或个人主页。
- 不会删除 Cloudflare 账户、Worker、D1 数据库、API Token、Billing 设置或其他 Cloudflare 资源。
- 不会删除其他数字 GitHub ID 的计数器、访问记录、会话或登录票据。
- 不会认领或删除历史管理员计数器（`owner_user_id IS NULL`）。
- 全局 `visit_day_budget` 是所有用户共享的 UTC 日聚合限额，不按用户保存；删除个人账户不会重置它。
- 尚未完成 GitHub 身份交换的 OAuth state 不包含已验证用户 ID，不能安全地归属给某个账户；它们按原有短期过期规则清理。
- 不承诺立即清除 Cloudflare/SQLite 备份、D1 Time Travel 历史、浏览器/CDN/GitHub 图片代理缓存、第三方副本或用户已下载的 JSON 文件。
- 不会清除用户浏览器中的编辑器本地草稿、导出的 JSON 或 README 中的图片 Markdown。

删除后，引用已删除 SVG 的 README 图片会在缓存失效后返回 404。此操作不可撤销。

### 再次登录

这删除的是本应用的数据，不是 GitHub 身份。若该 GitHub ID 仍在当前 OAuth pilot 白名单中，用户以后可以重新登录；应用会创建一个空的应用账户，不会自动恢复旧计数器或旧访问量。用户需要从本地保存的 JSON 快照中自行留存设计和记录；当前没有云端自动恢复接口。

### API

默认关闭。只有显式设置 `ACCOUNT_DELETION_ENABLED=true` 才启用；`PUBLISHING_ENABLED=true`、原有 OAuth 配置、单账户数字 ID 白名单及 Studio Origin 检查仍然全部生效。

```http
DELETE /v1/my/account
Origin: https://guitar0788.github.io
Authorization: Bearer <current-session>
Content-Type: application/json

{
  "confirm": "DELETE_MY_ACCOUNT",
  "confirmLogin": "<exact login returned by the verified current session>"
}
```

- 必须输入精确短语 `DELETE_MY_ACCOUNT` 和当前会话的完整 GitHub login（区分大小写）。
- 未登录/会话已撤销：401。
- 非批准 Studio Origin：403。
- 缺少/错误确认：400。
- 非 DELETE：405。
- 未启用：404。
- D1 batch 不可用或失败：503；事务必须回滚，不得部分删除。
- 成功：200，只返回 `deleted`、`signedOutEverywhere` 和已删除计数器数量，不返回 slug、设计、访问指纹或会话信息。

**前端已有双重确认控件代码，但默认隐藏。** 只有构建时显式设置 `VITE_ACCOUNT_DELETION_UI_ENABLED=true` 且发布 UI 已启用，按钮才会出现；服务端还必须单独设置 `ACCOUNT_DELETION_ENABLED=true`。两个开关默认均关闭。当前没有在真实 pilot 中启用或测试删除。独立双账户真实浏览器验收、备份保留政策和正式法律/隐私审查仍是后续工作。

## English summary

The opt-in `DELETE /v1/my/account` route deletes only the currently verified numeric GitHub identity's app-owned counters, per-counter request receipts/fingerprints, unused login tickets, and all sessions. A single D1 batch is mandatory. Legacy admin rows, other identities, the global aggregate visit budget, GitHub itself, Cloudflare resources, local drafts, downloaded exports, backups and third-party caches are not deleted. Re-authentication can create a new empty app account while the pilot allowlist remains active.

The endpoint is disabled by default, has no UI control yet, and has not been run against any remote database. Keep the single-owner allowlist unchanged.
