# v0.6 — Personal publishing data portability and session controls
# v0.6 — 账户数据导出与所有设备退出

**Status:** GitHub-verified owner-only OAuth staging pilot. Public multiuser registration remains disabled.

## 中文使用说明

登录 Workshop Studio 后，在「发布到 GitHub」的账户区域可使用：

**下载我的已发布数据（JSON）**：将当前 GitHub 账户拥有的计数器 SVG 设计、ID、累计访问量、创建时间、公开图片 URL 和 GitHub 数字账户 ID 导出到本机 JSON 文件。服务端不保存临时文件、不触发计数、不提供其他账户或旧版管理员计数器的数据，也不会导出访客指纹、GitHub OAuth 令牌、会话令牌或账户安全记录。

**重要**：这是**用于个人留档的数据快照**，不等于可自动重新导入云端的灾难恢复备份；现阶段没有自动将旧 SVG 链接、访问总量或计数器所有权从文件中恢复的接口。请将文件妥善存储，因为它包含设计内容和 GitHub 账户身份信息。导出不删除也不修改任何现有数据。

**退出所有设备的登录**：点击后先展开说明面板，再点击二次确认。服务器会使用已经验证的 GitHub **数字 ID** 执行 `DELETE FROM publish_sessions WHERE github_user_id = ?`，该账户目前所有浏览器令牌即刻失效，包括发起操作的会话。其他账户的会话、所有已发布计数器、访问量、SVG 地址和编辑器本地内容均不会改变。各设备必须重新通过 GitHub 登录才能编辑已发布数据。

普通「退出登录」按钮仍然只撤销当前设备的一份令牌。与「删除此计数器」相比，全设备退出**不是删除账户或删除计数器**，不会使公开 SVG 失效。

## API 约定

所有接口继续要求 `PUBLISHING_ENABLED=true`、正确的 GitHub OAuth 服务端凭据、允许名单中的可信 GitHub 数字 ID、来源为指定 GitHub Pages Studio、1 小时内有效的内存 Bearer 会话。不允许仅通过 GitHub 用户名或其他浏览器请求头伪造身份。

### GET /v1/my/export

- HTTP 200：`formatVersion:1`、`exportedAt`、`account:{githubId,githubLogin}`、`maxCounters:3`、`counters:[{slug,hits,createdAt,imageUrl,design}]`。
- 只从 `WHERE owner_user_id = ?` 读取当前账户发布的最多三条计数器，不会读取其他账户的记录或任何私密 OAuth 表。
- 返回 `Cache-Control: no-store`，浏览器仅在用户主动下载时用 `Blob` 生成本地文件，不采用第三方存储服务。
- 未登录、撤销或过期会话 HTTP 401；错误来源 HTTP 403；不支持的 HTTP 方法返回 405。
- 有效账户无已发布计数器时返回空数组，而不是暴露全局数据。

### POST /v1/auth/logout-all

必须以 JSON 提交 `{"confirm":"LOGOUT_ALL"}`，仅允许经认证的用户执行，不能通过 GET 或 CSRF 触发。返回 `{"signedOutEverywhere":true}`，然后客户端清除本机的会话和已发布计数器管理状态。

- 无有效会话：401；错误来源：403；错误确认：400；非 POST：405。
- D1 原子删除指定数字 GitHub ID 的全部 `publish_sessions` 记录；不修改用户已发布计数器和其他账户的会话。
- 网络出错后界面不得假称其他设备已退出；提示重试，且不自动删除任何已有作品。

## 测试及上线限制

自动回归测试覆盖：只导出本账户，拒绝匿名与跨来源读取，隐藏令牌/访客指纹，导出结果 ID 与图片来源校验，两份会话同时撤销、不影响不同 ID 的账户、重新登录保留原计数器。

这并非「删除全部账户数据」或真实云端完整备份，也不代表已经可以向任意 GitHub 用户开放注册。后续仍需规划**完整账户销毁和数据保留政策、Cloudflare 账号用量与安全告警、真实多账户浏览器验收**。

上线仅通过本项目已验证 `main` 分支 `Verify` 及 OAuth Pilot Auto 的受控 staging 环境进行。不得重置真实 D1 或触碰任何其他仓库的 README。

## English summary

The signed-in Studio can download a **client-side JSON snapshot of only its own published counters** (design, URL, hits, timestamps and verified numeric account identity), excluding OAuth tickets, session hashes and visitor fingerprints. It is **not an automatic cloud restore mechanism**.

A separate explicitly confirmed **Sign out on all devices** action invalidates every server-side session for the currently verified numeric GitHub account without deleting any counter. Other users' sessions are unaffected. Anonymous, unapproved-Origin and unapproved-account requests remain forbidden.

Both features stay behind the single-owner staging allowlist, and do not make the service publicly multiuser-ready.
