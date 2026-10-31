# v0.5: verified GitHub publishing / GitHub 身份验证发布

**Status: code/testing only — publishing remains OFF by default.** The existing Cloudflare staging counter and public GitHub Pages Studio must not be represented as a public hosting service yet.

## English

### Purpose and trust model

- Public counter images remain under \`GET /v1/counters/{slug}.svg\`. The number represents qualifying upstream requests, **not unique human visitors or exact GitHub profile views**.
- Only a **verified GitHub numeric user ID**, returned by GitHub's \`GET /user\`, can own a counter. The GitHub login/display name is stored for display only and cannot grant access.
- GitHub OAuth \`read:user\` authorization is exchanged **server side only**. GitHub tokens and Cloudflare administrator secrets are never sent to Studio.
- The browser generates a strong PKCE verifier, stores it only in tab sessionStorage for the authorization redirect and removes it after use. D1 stores one-time hashed OAuth state and ticket records.
- A one-time authorization ticket is redeemed for an opaque **one-hour session** in browser memory. D1 stores only the session token's SHA-256 digest. A page reload requires a new login.
- Cross-origin browser APIs require the exact approved Studio Origin and bearer authorization; credentials are never put in URLs or sent as cookies.
- At most **three** counters per verified account. New slugs are random. Updates always require \`owner_user_id = verified GitHub numeric ID\` in SQL.
- Pre-v0.5 administrator counters have \`owner_user_id = NULL\`; no account can claim them merely by choosing the same username.
- All user designs are sanitized and limited to 16 KB input. Anonymous creation/editing and browser calls to the administrator routes remain forbidden.
- The Worker also rate limits OAuth starts by a temporary keyed fingerprint, but Cloudflare WAF, edge rate limits, quotas, abuse monitoring and OAuth app review are still needed **before any public rollout**.

### API contract (disabled until reviewed)

| Verb | Path | Purpose |
| --- | --- | --- |
| POST | \`/v1/auth/github/start\` | Issue a state-bound GitHub authorize URL for a browser PKCE challenge |
| GET | \`/v1/auth/github/callback\` | Verify state, redeem GitHub code server-side, return one-use ticket via redirect |
| POST | \`/v1/auth/exchange\` | Exchange ticket + original verifier for a one-hour browser bearer session |
| GET | \`/v1/me\` | Return verified GitHub ID/login for a valid session |
| POST | \`/v1/auth/logout\` | Revoke a session |
| GET | \`/v1/my/counters\` | List up to three counters owned by the authenticated ID |
| POST | \`/v1/my/counters\` | Publish sanitized design and get an immutable stable SVG URL |
| PUT | \`/v1/my/counters/{slug}/design\` | Replace design without resetting hit count |
| GET | \`/v1/counters/{slug}.svg\` | Public dynamic SVG (already available in v0.4) |

### GitHub OAuth App prerequisite — **do not configure a public release yet**

To perform an authorized isolated OAuth pilot, the repository owner must explicitly choose to proceed:

1. Navigate to GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**. Use an app distinct from the main GitHub profile or existing integrations.
2. Suggested application name: \`Workshop Visitor Terminal Staging\`.
3. Homepage URL: \`https://guitar0788.github.io/workshop-Visitor-Terminal/\`
4. Authorization callback URL: \`https://workshop-visitor-terminal-staging.fangcui2007.workers.dev/v1/auth/github/callback\`
5. Configure \`GITHUB_CLIENT_ID\` and \`GITHUB_CLIENT_SECRET\` as private **cloudflare-staging Environment secrets** only after an explicit pilot authorization. Never send the client secret via chat, issues, screenshots or commit.
6. Before enabling the Worker, configure environment-specific values:
   - \`PUBLISHING_ENABLED=true\` **only** after credential and security validation.
   - \`STUDIO_ORIGIN=https://guitar0788.github.io/workshop-Visitor-Terminal/\`
   - \`PUBLIC_API_ORIGIN=https://workshop-visitor-terminal-staging.fangcui2007.workers.dev/\`
7. The GitHub Pages build needs **both** \`VITE_PUBLISH_ENABLED=true\` and \`VITE_PUBLISH_API_ORIGIN\` pointing to the reviewed staging Worker to show sign-in. These are **not enabled in the current Pages pipeline**.
8. Test full GitHub login/redirect, multi-account authorization, malicious origins, replay, mobile use, cache behavior, session expiry, delete/retention policy and Cloudflare resource/billing limits before authorizing public rollout.

**Important:** Do **not** set a GitHub OAuth client secret as a \`VITE_\` build variable. Vite variables are compiled into public JavaScript.

### No production change from this code merge

- Default \`PUBLISHING_ENABLED=false\` in the staging Wrangler template.
- Default frontend \`VITE_PUBLISH_ENABLED\` absent → publish panel displays a clear preview-only notice, not a broken sign-in button.
- Admin-only v0.4 routes and existing test counters continue to work.
- The existing GitHub profile README and previous Komarev counter remain untouched.
- Migration \`0003_publishing.sql\` is additive. Never edit prior migrations after they have run.

### Known limitations

This is a bounded **technical beta**. User-hosted counters cannot yet be deleted, transferred or imported from the existing profile counter; a final abuse policy, retention/deletion, rate-limit and observability plan is required. GitHub image proxy caching prevents accurate per-page-view statistics and the current five-minute pseudonymous grouping is not equivalent to unique visitors.

## 简体中文

### 目前进度

v0.5 已增加 GitHub OAuth 登录、专用数据库表、用户身份与计数器的归属校验、在线设计保存、可复制的 README Markdown 和手机端发布面板。

**现在只是完成代码与自动化测试准备，公开发布开关默认关闭。** 即使 PR 合并，也不会自动开放登录或触碰你的个人主页。

### 安全设计

- 使用 GitHub 官方授权，服务端验证 GitHub 返回的数字用户 ID，不按昵称来确定归属。
- GitHub OAuth 密钥和 Cloudflare 管理密钥不会发送给浏览器。
- 登录状态短期有效（1 小时），凭证只存浏览器内存，刷新页面需要重新登录。
- 每个 GitHub 账户最多创建三个计数器，修改设计必须经过服务端归属校验。
- 旧版本管理员计数器保持原有所有权状态，不会因相同用户名而被自动认领。
- SVG 链接是稳定的，但 GitHub 图片缓存会导致显示更新延迟；数字仍只是抵达服务器的有效图片请求，不是精确独立访客量。

### 以后启用 GitHub 登录时需要你做什么

这一步**现在还不用做**。在我们决定进行 v0.5 OAuth 试运行后：

1. GitHub 个人设置 → **开发者设置** → **OAuth 应用** → **新建 OAuth 应用**。
2. 应用名称填写 \`Workshop Visitor Terminal Staging\`。
3. **主页 URL**：\`https://guitar0788.github.io/workshop-Visitor-Terminal/\`
4. **授权回调 URL**：\`https://workshop-visitor-terminal-staging.fangcui2007.workers.dev/v1/auth/github/callback\`
5. 将新应用的 Client ID 和 Client Secret 存入 GitHub 环境 \`cloudflare-staging\` 的加密机密。不要把 Secret 发到聊天。
6. 之后我们再经过审查，单独开启 Worker 与 GitHub Pages 的发布功能开关，并完成真实手机、跨用户和访问限制测试。

### 暂不进行的操作

不会更新你的 \`guitar0788/guitar0788\` 个人主页 README，不会替换旧访客计数器，不会把 staging 测试次数当成真实历史访问量，不会自动把测试服务改成公共托管平台。

### 参考

- [GitHub — Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Cloudflare — D1 database](https://developers.cloudflare.com/d1/)
