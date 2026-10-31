# Cloudflare staging / Cloudflare 隔离测试

**English | [简体中文](#简体中文)**

This is an **opt-in staging deployment**, not production. It does not modify the GitHub profile README, the existing Komarev counter, or the GitHub Pages Studio. **It cannot run until the repository owner explicitly supplies a dedicated Cloudflare staging account/database configuration through GitHub Environment secrets.**

## English

### Safety boundary

- Manual workflow only: **Actions → Cloudflare Staging (manual) → Run workflow** on \`main\`.
- The workflow requires the exact typed confirmation **STAGING-ONLY** and the exact staging \`workers.dev\` URL.
- The database must be named \`workshop-visitor-terminal-staging\` and its ID must match the supplied secret. The workflow checks both using the Cloudflare API **before any remote writes**.
- Only the Worker named \`workshop-visitor-terminal-staging\` is deployed. No production domain or custom route is configured.
- Test counters use randomly generated \`staging-smoke-...\` and \`staging-legacy-...\` slugs, and a **fictional baseline of 47**, never a real user's numbers.
- The staging database remains available after the workflow so the test results can be inspected. It can incur Cloudflare usage; review plan quotas and set alerts before enabling.
- The API token and Worker secrets must never be shared in issues, README, public commits or ChatGPT messages.

### One-time account preparation (by the owner)

1. In [Cloudflare Dashboard](https://dash.cloudflare.com/), sign in or create an account and inspect Workers & Pages billing and daily usage limits. Make sure you have a \`workers.dev\` subdomain assigned.
2. Under **D1**, create a new, empty database named exactly \`workshop-visitor-terminal-staging\`. Record its UUID privately. **Never choose a production database.**
3. In Cloudflare **Account API Tokens**, create a *custom scoped token* limited to this test account, with the permissions required to edit Workers and D1 databases. Do not use a Global API Key.
4. In the [GitHub repository environments](https://github.com/guitar0788/workshop-Visitor-Terminal/settings/environments), create an environment named **cloudflare-staging**. Configure approval/protection rules if supported.
5. Add five **environment secrets** (not public repository variables):
   - \`CLOUDFLARE_API_TOKEN\`: scoped Cloudflare API token.
   - \`CLOUDFLARE_ACCOUNT_ID\`: 32-character hexadecimal Cloudflare account ID.
   - \`STAGING_D1_DATABASE_ID\`: UUID of the new staging-only database.
   - \`STAGING_ADMIN_TOKEN\`: a separately generated random 32+ character token for *staging admin API*.
   - \`STAGING_VISIT_HASH_SECRET\`: a distinct random 32+ character string for HMAC request deduplication.
6. Find your assigned Cloudflare \`workers.dev\` subdomain. The expected Worker URL will be:
   \`https://workshop-visitor-terminal-staging.<your-subdomain>.workers.dev\`

**Never type the secret values into a chat or an issue.** Environment secret values are hidden after saving.

### Deploy and verify (manual, not automatic)

1. Open [Actions](https://github.com/guitar0788/workshop-Visitor-Terminal/actions), select **Cloudflare Staging (manual)**, then **Run workflow**.
2. Choose \`main\`, set **confirm_scope** to \`STAGING-ONLY\`, and provide the exact HTTPS **staging_origin** URL above.
3. Read the workflow results: build/tests → credentials preflight → verify D1 ID/name → **remote D1 migrations** → staging Worker deployment → HTTP API and deduplication checks → second deployment → persistent data checks.
4. If any gate fails, **stop** and inspect the step. Do not copy credentials into a GitHub comment to troubleshoot. Never fall back to a different DB.
5. Before any public counter rollout, independently assess access control, request abuse, data retention, GitHub Camo caching, quotas and billing. This staging workflow does **not** enable public signup.

### What is actually verified?

The workflow verifies the deployed Worker HTTP API and D1 persistence across redeployment on Cloudflare's infrastructure, including unauthorized requests, \`HEAD\` handling, SVG escaping, five-minute deduplication and one-time legacy baseline protection. It does **not** prove unique-human-visitor accuracy, a per-profile-view metric or GitHub image-cache behavior.

### Current status

**Workflow prepared, cloud staging account/database not connected or verified. No remote deployment has occurred.**

## 简体中文

**本项目的 Cloudflare staging 是独立测试环境，并非正式计数服务。** 没有你在 GitHub 中设置的 Cloudflare 授权凭据，工作流不会连接云端；不会自动修改你的个人主页、原 Komarev 计数器或 GitHub Pages 编辑器。

### 安全约束

- 必须在 GitHub Actions 中**手动运行**，不会因为提交代码或合并 PR 而部署。
- 必须输入准确的确认词 \`STAGING-ONLY\`，且只能部署到专用 \`workers.dev\` 测试地址。
- 数据库必须叫 \`workshop-visitor-terminal-staging\`。工作流会在任何远程写入前核对数据库 **名称与 ID**，不匹配立即停止。
- Worker 只能叫 \`workshop-visitor-terminal-staging\`，不配置正式域名。
- 测试使用随机创建的独立计数器，以及 **47 次虚构历史访问量**。不会读取、迁移或覆盖你的真实访客次数。
- 云端测试可能使用 Cloudflare 免费额度，建议先检查账户套餐、配额与使用量预警。
- **任何 API Token、密钥和管理员密码都不要发在聊天、GitHub Issue 或 README 中。**

### 你需要一次性完成的设置

1. 打开 [Cloudflare 控制台](https://dash.cloudflare.com/)，注册或登录，确认 Workers & Pages 的费用及额度，并查看分配给你的 \`workers.dev\` 子域名。
2. 在 **D1** 页面新建专用数据库，名称必须为 \`workshop-visitor-terminal-staging\`。保存数据库 UUID，不能使用正式业务数据库。
3. 到 Cloudflare 的 **Account API Tokens** 创建仅限该测试账户的自定义令牌，授予部署 Workers 与操作 D1 所需权限，**不要使用 Global API Key**。
4. 打开 [GitHub 仓库的 Environments 设置](https://github.com/guitar0788/workshop-Visitor-Terminal/settings/environments)，新建环境，名字填写 \`cloudflare-staging\`；如支持，启用审批保护。
5. 在该环境下的 **Environment secrets** 添加以下五个名称，具体值只在 GitHub 设置中输入，不要发送给我：
   - \`CLOUDFLARE_API_TOKEN\`：Cloudflare 自定义 API 令牌
   - \`CLOUDFLARE_ACCOUNT_ID\`：Cloudflare 账户 ID
   - \`STAGING_D1_DATABASE_ID\`：刚创建的测试数据库 UUID
   - \`STAGING_ADMIN_TOKEN\`：随机生成的 32 位以上专用管理员密钥
   - \`STAGING_VISIT_HASH_SECRET\`：另外生成、不能重复的 32 位以上 HMAC 密钥
6. 找到你账户的 \`workers.dev\` 子域名。测试 Worker 的完整地址将类似：
   \`https://workshop-visitor-terminal-staging.<你的子域名>.workers.dev\`

### 开始测试

进入仓库 [Actions](https://github.com/guitar0788/workshop-Visitor-Terminal/actions)，选中 **Cloudflare Staging (manual)**，点击 **Run workflow**，分支选 \`main\`。确认词输入 \`STAGING-ONLY\`，另一个输入框填入测试 Worker 的完整 HTTPS 地址。

工作流会先检查密钥和数据库身份，然后才执行远程迁移与部署；随后检查真实 SVG 接口、计数去重、历史初始化、Worker 重新部署后的持久化结果。

**如果部署失败，先查看失败步骤，不要将密钥复制出来发给任何人。**

### 当前状态

**已准备测试流程；尚未连接 Cloudflare 账户，也没有进行云端部署。** 测试完成后再单独讨论如何安全面向普通用户开放，不能直接把 staging 服务当成正式的公共平台。
