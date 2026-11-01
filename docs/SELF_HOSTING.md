# Self-host dynamic visitor counters / 自托管动态访客计数器

**Technical preview: manual deployment only.** Anyone may use the offline editor without Cloudflare. Real dynamic counters require the user's **own Cloudflare Worker and D1**. This does not give users access to the maintainer's account, existing counters, or owner-only OAuth pilot.

## 中文指南（Windows / macOS / Linux）

### 0. 离线编辑与动态计数的区别

- 下载的 `Workshop-Studio-Offline.html` 可断网使用，输出静态 SVG 和 JSON 设计。
- **动态访客计数**需要运行自己的公开 Worker，并将次数写入自己的 D1。它可能产生 Cloudflare 用量，**不保证零费用**。
- 统计的是到达 Worker 的合格图片请求，不是 GitHub 主页的精确浏览人数，也不是独立访客；GitHub 的图片代理会缓存 SVG。
- 不要把管理员密钥放进 HTML、GitHub README 或任何前端 JavaScript。

### 1. 安装工具并创建独立数据库

要求安装 Node.js 20+、Git，并拥有自己的 Cloudflare 账户。 当前 PR #21 仍处于 Draft 预览阶段，因此下面命令临时切换到开发分支；正式合并后可省略 `git switch`。

```sh
git clone https://github.com/guitar0788/workshop-Visitor-Terminal.git
cd workshop-Visitor-Terminal
git switch feat/v06-independent-self-hosting
npm install
npx wrangler login
npx wrangler whoami
```

核对 `whoami` 显示的是**你自己的账户**，然后创建名称全新的 D1 数据库：

```sh
npx wrangler d1 create my-visitor-counter-db
```

运行 **本地配置生成器**。将下方名称与上一步得到的真实 D1 UUID 替换成自己的值：

```sh
node scripts/self-host-setup.mjs init --worker my-visitor-worker --database my-visitor-counter-db --database-id YOUR_NEW_D1_UUID
node scripts/self-host-setup.mjs check
```

该命令仅在电脑本地生成 `wrangler.selfhost.toml`、`.wvt-admin-token` 和 `.wvt-visit-secret`，**不会访问 Cloudflare、部署 Worker 或修改远程 D1**。会生成两份不同的随机密钥和互不相同的限流命名空间 ID；每个命名空间还应检查不与自己的其他 Worker 冲突。

- 重复运行 `init` 不会覆盖现有文件或密钥。重新安装前请先安全备份它们，否则可能无法管理已有计数器。
- `check` 会核对 Worker/D1 名称、UUID、关闭 OAuth 的标志、限流标志以及两份不同的密钥；不验证 Cloudflare 账户身份，也不会发出网络请求。
- `wrangler.selfhost.toml` 与两份密钥文件均由 `.gitignore` 排除，不可上传到 GitHub。Windows 上还需注意所在文件夹的 NTFS 共享权限。
- **仅首次初始化时使用新建的 D1 数据库**；本工具不是从其他账户迁移或接管已有计数器的工具。

### 3. 先执行无需 Cloudflare 账户的端到端测试

在执行任何远程部署之前，使用本仓库自带的**一次性本地自托管测试**：

```sh
node worker/self-host-smoke.mjs
```

此脚本会临时创建**另一份测试配置与临时 D1**，用真实本地 Wrangler 启动后端，自动模拟创建计数器、通过本地 CLI 发布、访问计数、去重、修改设计、停止和重新启动，再检查是否保留同一 URL、样式和累计次数。

- 测试全程使用 `--local` 及独立临时数据库目录，**不会使用或迁移你的真实云端 D1**。
- 采用随机、临时的测试密钥；测试完成后删除创建的临时配置、测试密钥及数据库。不影响 `wrangler.selfhost.toml`、`.wvt-admin-token`、`.wvt-visit-secret`。
- 如果项目根目录已有 `.dev.vars` 或 `wrangler.selfhost.smoke.toml`，脚本会拒绝运行，以防覆盖它们。此时请使用干净的项目副本进行测试，不要删除已有用户密钥。
- 测试通过不代表 Cloudflare 账户身份、真实 D1、公开访问和费用控制已经完成实机验收。

### 4. 本地检查后，再自行部署

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
npx wrangler secret put ADMIN_TOKEN --config wrangler.selfhost.toml
npx wrangler secret put VISIT_HASH_SECRET --config wrangler.selfhost.toml
```

上述两次 `secret put` 会提示输入密钥：分别从本机 `.wvt-admin-token` 和 `.wvt-visit-secret` 文件**复制完整的单行值**粘贴，不要把密钥放入命令行参数、截图或公开日志。使用 Windows CMD、PowerShell、macOS Terminal 或 Linux Shell 时均可采用此交互方式；不要在 PowerShell 中使用 `< 文件名` 重定向。

只有创建者明确选择执行上述命令时才会进行远程部署。第一次部署后、秘密尚未设置完整时，计数功能应返回 HTTP 503。单独的 `/health` 只证明路由工作，不证明 D1 已准备好。

**新：部署后只读验收（推荐）**

将地址换成自己 Worker 的真实 HTTPS 根地址，执行：

```sh
node scripts/self-host-verify.mjs --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --token-file .wvt-admin-token
```

它会依次确认服务身份、OAuth 发布门禁关闭、匿名管理员访问被拒绝、管理员密钥可读 D1 当日写入预算且限流标志正常，并向随机不存在的计数器发出一次 **HEAD** 请求（预期 HTTP 404）。所有探针仅使用 GET/HEAD，不会增加任何访问次数，也不会修改 D1、Cloudflare 配置或仓库文件。若出现 HTTP 401、403、429、503 或异常 HTML 响应，命令会停止并报告失败环节；**不要通过反复刷新真实 SVG 来排查**。

首次实际创建自己的计数器之后，可以进一步检查它的 SVG 是否已公开可读（同样只发送 HEAD，不增加次数）：

```sh
node scripts/self-host-verify.mjs --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --token-file .wvt-admin-token --slug my-counter
```

**安全提醒：** 工具不会自动发现自己的 Cloudflare 地址；请手动核对 `--api` 确实指向自己的 Worker。管理员密钥仅会发送至这个明确指定且通过地址校验的 HTTPS 目标，禁止重定向，也禁止维护者的 staging 地址。它无法核验 Cloudflare 账号的实际所有权、收费额度、域名 DNS、其他 Worker 的流量、真实跨机房限流或 GitHub 图片缓存行为。它验证的是现有服务端接口的可观察状态，不是完整生产环境安全审计。



### 5. 发布离线 Studio 中设计的 JSON

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

### 6. 费用与安全

- 自托管用户负责自己的 Cloudflare 额度、费用报警、备份、秘密轮换和 Worker/D1 生命周期；本项目不会承担这些用量。
- 模板设置了每机房近似的两级 SVG 限流。数据库还有全局 UTC 日最多接纳 20,000 条新去重访问记录的机制。**它们不能彻底限制所有 Worker 请求或全部 D1 读取量**。
- 管理 API 由 `ADMIN_TOKEN` 保护，令牌不可暴露在公开网页中。CLI 禁止把密钥发送到本项目维护者的 staging Worker，并禁止跟随可能泄漏令牌的 HTTP 重定向。
- Worker 定时清理陈旧的去重窗口；不会清零累计访问次数。公共 SVG 支持不计数的 `HEAD` 访问。
- 这不是多人 SaaS、不是公开 OAuth 注册，也不提供旧计数器的自动迁移。

## English summary

Use **your own** Cloudflare account and create a new D1 database. Run `node scripts/self-host-setup.mjs init --worker ... --database ... --database-id ...` and then `node scripts/self-host-setup.mjs check` to generate and validate a private local Wrangler config and two secrets without network access. The self-host template disables GitHub OAuth and reuses the existing counter backend. Run the disposable local end-to-end test `node worker/self-host-smoke.mjs` first, then run local migrations and explicitly opt in to remote D1 migrations and deployment. After deployment, run the read-only `node scripts/self-host-verify.mjs --api YOUR_WORKER_URL --token-file .wvt-admin-token` check (optionally `--slug` for an existing published counter). It verifies the Worker's identity, closed OAuth, private admin access, D1 budget and SVG HEAD without writing counts. Export a Studio `schemaVersion: 1` design JSON, and run `node scripts/self-host-publish.mjs create|update|inspect` against **your own HTTPS Worker** with a private `--token-file`. Success prints the dynamic SVG Markdown; it does not update a GitHub profile automatically.

This is a technical preview, not a hosted service or promise of free Cloudflare capacity. Image cache effects mean counts represent qualifying upstream requests, not unique people.

Official Cloudflare references: [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/) and [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
