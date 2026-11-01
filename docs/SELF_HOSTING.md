# Self-host dynamic visitor counters / 自托管动态访客计数器

**Technical preview: manual deployment only.** Anyone may use the offline editor without Cloudflare. Real dynamic counters require the user's **own Cloudflare Worker and D1**. This does not give users access to the maintainer's account, existing counters, or owner-only OAuth pilot.

## 中文指南（Windows / macOS / Linux）

### 0. 离线编辑与动态计数的区别

- 下载的 `Workshop-Studio-Offline.html` 可断网使用，输出静态 SVG 和 JSON 设计。
- **动态访客计数**需要运行自己的公开 Worker，并将次数写入自己的 D1。它可能产生 Cloudflare 用量，**不保证零费用**。
- 统计的是到达 Worker 的合格图片请求，不是 GitHub 主页的精确浏览人数，也不是独立访客；GitHub 的图片代理会缓存 SVG。
- 不要把管理员密钥放进 HTML、GitHub README 或任何前端 JavaScript。

### 1. 安装工具并创建独立数据库

要求安装 Node.js 20+、Git，并拥有自己的 Cloudflare 账户。

```sh
git clone https://github.com/guitar0788/workshop-Visitor-Terminal.git
cd workshop-Visitor-Terminal
npm install
npx wrangler login
npx wrangler whoami
```

核对 `whoami` 显示的是**你自己的账户**，然后创建名称全新的 D1 数据库：

```sh
npx wrangler d1 create my-visitor-counter-db
```

将仓库中的 `wrangler.selfhost.example.toml` 复制成 `wrangler.selfhost.toml`。编辑其中：

1. `name`：填入自己的独立 Worker 名称，如 `my-visitor-counter-worker`，不能使用维护者的 staging 名称。
2. `database_name`：自己刚创建的 D1 名称，如 `my-visitor-counter-db`。
3. `database_id`：上一步命令返回的**真实 D1 UUID**。
4. `ratelimits`：使用自己账户内不与其他 Worker 冲突的两个 `namespace_id`。

保留 `PUBLISHING_ENABLED = "false"` 和 `SVG_RATE_LIMIT_ENABLED = "true"`，避免意外开放 OAuth 注册或关闭流量防护。`wrangler.selfhost.toml` 已加入 `.gitignore`，不可将其提交到仓库。

### 2. 生成并保存两份不同的密钥

下面一行同时适用于 Windows CMD、PowerShell 和常见 Unix Shell。它不会在终端显示私钥，且不会覆盖已存在的密钥文件。

```sh
node -e "const fs=require('node:fs');const {randomBytes}=require('node:crypto');for(const f of ['.wvt-admin-token','.wvt-visit-secret'])fs.writeFileSync(f,randomBytes(48).toString('hex'),{flag:'wx',mode:0o600});"
```

`.wvt-admin-token` 是管理员凭据，`.wvt-visit-secret` 用于匿名访客指纹 HMAC。请保存在自己的安全目录中，不要截图、分享或提交。两者已经纳入 `.gitignore`；共用电脑还应检查文件访问权限。

### 3. 本地检查后，再自行部署

先对自己的**本地**数据库执行迁移：

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.selfhost.toml
```

如需本地启动，使用私有且不提交的 `.dev.vars` 文件分别设置 `ADMIN_TOKEN` 和 `VISIT_HASH_SECRET`，再执行：

```sh
npx wrangler dev --local --config wrangler.selfhost.toml
```

在开始远程部署前自行检查 Cloudflare Workers 和 D1 的用量及计费政策。以下命令会**实际修改自己的 Cloudflare 资源**，由使用者手工执行；项目 CI 不会代替执行：

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.selfhost.toml
npx wrangler deploy --config wrangler.selfhost.toml
npx wrangler secret put ADMIN_TOKEN --config wrangler.selfhost.toml < .wvt-admin-token
npx wrangler secret put VISIT_HASH_SECRET --config wrangler.selfhost.toml < .wvt-visit-secret
```

只有创建者明确选择执行上述命令时才会进行远程部署。第一次部署后、秘密尚未设置完整时，计数功能应返回 HTTP 503。完成后测试自己的 `https://<your-worker>.<your-subdomain>.workers.dev/health`；注意 `/health` 只检查基本路由，不证明数据库已经就绪。

### 4. 发布离线 Studio 中设计的 JSON

在 [Workshop Studio](https://guitar0788.github.io/workshop-Visitor-Terminal/) 或离线单文件编辑器选择「保存设计」，得到 `visitor-terminal.design.json`。把该文件放在本地仓库目录。**不要**使用账户数据快照或 HTML 文件充当设计 JSON。

首次创建：将示例地址替换成自己的 HTTPS Worker 根地址，并替换 GitHub 用户名：

```sh
node scripts/self-host-publish.mjs create --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug my-counter --owner YOUR_GITHUB_NAME --design visitor-terminal.design.json --token-file .wvt-admin-token
```

编辑现有计数器的样式，**保留原来的次数与 SVG 地址**：

```sh
node scripts/self-host-publish.mjs update --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug my-counter --design visitor-terminal.design.json --token-file .wvt-admin-token
```

查询次数（不会增加次数）：

```sh
node scripts/self-host-publish.mjs inspect --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug my-counter --token-file .wvt-admin-token
```

成功发布后 CLI 输出对应的 README Markdown，例如 `![Visitor counter](https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/v1/counters/my-counter.svg)`。用户自行决定是否粘贴进**自己的** README；工具不会自动编辑任何 GitHub 仓库。

如果首次 `create` 已写入记录但设计上传失败，请使用 `update` 重试，而不是再次创建或清空数据库。管理员令牌只从本地忽略文件或 `WVT_ADMIN_TOKEN` 环境变量读取，不通过命令行参数传入。

### 5. 费用与安全

- 自托管用户负责自己的 Cloudflare 额度、费用报警、备份、秘密轮换和 Worker/D1 生命周期；本项目不会承担这些用量。
- 模板设置了每机房近似的两级 SVG 限流。数据库还有全局 UTC 日最多接纳 20,000 条新去重访问记录的机制。**它们不能彻底限制所有 Worker 请求或全部 D1 读取量**。
- 管理 API 由 `ADMIN_TOKEN` 保护，令牌不可暴露在公开网页中。CLI 禁止把密钥发送到本项目维护者的 staging Worker，并禁止跟随可能泄漏令牌的 HTTP 重定向。
- Worker 定时清理陈旧的去重窗口；不会清零累计访问次数。公共 SVG 支持不计数的 `HEAD` 访问。
- 这不是多人 SaaS、不是公开 OAuth 注册，也不提供旧计数器的自动迁移。

## English summary

Use **your own** Cloudflare account, Worker, D1 database, separate strong Worker secrets and independent rate-limit namespace IDs. The provided `wrangler.selfhost.example.toml` disables GitHub OAuth and uses existing server-side counting logic. Run local migrations first, then manually opt in to remote D1 migrations and deployment. Export a Studio `schemaVersion: 1` design JSON, and run `node scripts/self-host-publish.mjs create|update|inspect` against **your own HTTPS Worker** with a private `--token-file`. Success prints the dynamic SVG Markdown; it does not update a GitHub profile automatically.

This is a technical preview, not a hosted service or promise of free Cloudflare capacity. Image cache effects mean counts represent qualifying upstream requests, not unique people.

Official Cloudflare references: [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/) and [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
