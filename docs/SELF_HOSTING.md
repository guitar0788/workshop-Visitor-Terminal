# Self-host dynamic visitor counters / 自托管动态访客计数器

**Technical preview: manual deployment only.** Anyone may use the offline editor without Cloudflare. Real dynamic counters require the user's **own Cloudflare Worker and D1**. This does not give users access to the maintainer's account, existing counters, or owner-only OAuth pilot.

**发行验收阻断：** [Issue #22 — 独立 Cloudflare 账户实机验收](https://github.com/guitar0788/workshop-Visitor-Terminal/issues/22) 尚未完成。GitHub Linux/Windows CI 通过不能代替第三方自己的账户、远程 D1、访客计数和计费隔离验证。PR #21 保持 Draft；在验收完成及明确授权之前，不应合并或发布正式 Release。严禁公开管理员密钥、Cloudflare 账户 ID、D1 UUID 或私有 `wrangler.selfhost.toml`。

## 中文指南（Windows / macOS / Linux）

### 0. 离线编辑与动态计数的区别

- 下载的 `Workshop-Studio-Offline.html` 可断网使用，输出静态 SVG 和 JSON 设计。
- **动态访客计数**需要运行自己的公开 Worker，并将次数写入自己的 D1。它可能产生 Cloudflare 用量，**不保证零费用**。
- 统计的是到达 Worker 的合格图片请求，不是 GitHub 主页的精确浏览人数，也不是独立访客；GitHub 的图片代理会缓存 SVG。
- **GitHub 官方机制：** GitHub 使用 Camo 匿名图片代理，浏览器访问 GitHub 页面时，可能直接收到已缓存图片而不触发 Worker GET；因此卡片无法可靠测量每次 README 查看。直接访问公开 SVG URL 也可能增加上游图片请求，但不代表真人访问。不要承诺“每位访客 +1”“每次页面刷新 +1”，更不要通过高频查询或强行删除 Camo 缓存刷访问量。参见 [GitHub About anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls) 和 [GitHub Proxying User Images](https://github.blog/news-insights/product-news/proxying-user-images/)。
- **数据含义：** 只有实际到达自己的 Worker、通过 IP/日期去重及安全限额的 SVG GET 才可能新增数据库记录。独立账户、远程 GitHub 图片代理、真实访客映射和缓存刷新仍需分别验收。调低 `Cache-Control` 无法强制 GitHub Camo 为每位用户重新请求，还可能增加 Cloudflare 用量。
- 不要把管理员密钥放进 HTML、GitHub README 或任何前端 JavaScript。

### 1. 取得自托管文件并创建独立数据库

**方法 A：下载独立自托管 ZIP（预览阶段推荐）**

打开 [PR #21](https://github.com/guitar0788/workshop-Visitor-Terminal/pull/21)，找到最近一次 **成功且全部作业均为绿色** 的 `Build Self-Host Preview` 检查，打开其 GitHub Actions 页面。在页面下方 `Artifacts` 下载 **`Workshop-SelfHost-Validated-Preview`**（GitHub 可能要求登录）。这是在 Linux、Windows、macOS 三个平台独立解压安装、真实本地 Worker/D1 测试均通过之后才上传的文件。`Workshop-SelfHost-CI-Input` 是提前生成、供 Windows 自动验收使用的**内部临时附件，用户不要下载它作为安装包**。**常规 `Verify` 检查不上传附件**，避免误传数据库恢复演练文件。请注意：Actions 自动下载的是外层 ZIP，解压后包含 `Workshop-Visitor-Terminal-Self-Host.zip`、其 `.sha256` 校验文件及 `Workshop-SelfHost-Preview-Manifest.json`；再次解压内层 ZIP，即得到独立项目目录 `Workshop-Visitor-Terminal-Self-Host`。**不要解压到已存放真实密钥或 Cloudflare 配置的旧目录。**

该预览附件由 CI 自动生成，包含 Worker 原始代码、D1 迁移、安装/发布/只读检查工具、经核对的 npm 依赖锁定文件和本指南，**不包含编辑器 React 源码、任何账户密钥或真实 D1 数据**。它还会在完全独立的解压目录内运行 `npm ci`、Wrangler 无部署编译、**带临时配置和合成 UUID 的真实安装向导**及真实的本地 D1 计数流程；向导检查会验证重复安装不会再次询问隐私参数、不会覆盖密钥。Linux、Windows、macOS 都会执行这些测试。这不能替代独立云端实机验收。最终验证附件和内部 CI 附件均仅保留 **7 天**，并非正式 GitHub Release。工作流只标记双平台本地测试通过，常规全仓库 `Verify` 仍应单独检查；真实独立 Cloudflare 账户的测试尚未完成。

Windows 可用 `certutil -hashfile Workshop-Visitor-Terminal-Self-Host.zip SHA256` 对比旁边的 `.sha256` 文件内容，确认下载未损坏；macOS/Linux 可以使用 `sha256sum -c Workshop-Visitor-Terminal-Self-Host.zip.sha256`。

**额外核对来源：** 查看同一目录的 `Workshop-SelfHost-Preview-Manifest.json`，确认 `source.headSha` 对应这次成功工作流的 PR 提交、`artifact.sha256` 对应实际 ZIP，以及 `status` 是 `VALIDATED_CI_PREVIEW_NOT_A_RELEASE`。该清单仅证明对应 GitHub CI 的**打包、Linux、Windows 和 macOS 本地测试**已通过；它不是数字签名，也没有验证实际 Cloudflare 账户、线上 D1、计费或 GitHub 图片代理。文件中这些项目会明确显示 `NOT_TESTED`。不要把这个预览清单冒充正式 Release 验收。

在解压后的自托管目录打开 CMD、PowerShell 或终端，安装 Node.js 22.12+（当前锁定的 Wrangler 要求 Node.js 22+，修复后的 Vitest 5 测试工具要求 Node.js 22.12+），然后运行：

**Windows 兼容性：** 自托管 ZIP 已经在 GitHub 的 Windows 运行器上实测解压、`npm ci`、Worker 无部署编译和真实本地 D1；本地测试使用跨平台 Node 入口，不依赖 Windows `.cmd` 子进程。Cloudflare 官方当前只承诺 Wrangler 在 **Windows 11** 上受支持；Windows 10 的本地 Worker/D1 运行没有通过本项目验证，不应将本次 Windows CI 成功推广为 Windows 10 兼容保证。

```sh
npm ci
npx wrangler login
npx wrangler whoami
```

**方法 B：从 GitHub 克隆整个开发仓库**

如果需要修改源代码，请安装 Node.js 22.12+ 和 Git，并执行：

```sh
git clone https://github.com/guitar0788/workshop-Visitor-Terminal.git
cd workshop-Visitor-Terminal
git switch feat/v06-independent-self-hosting
npm ci
npx wrangler login
npx wrangler whoami
```

当前 PR #21 仍为 Draft；合并正式发行之后才能直接从 main 获取上述新功能。无论使用哪种方式，**都必须使用自己的 Cloudflare 账户**。

核对 `whoami` 显示的是**你自己的账户**，然后创建名称全新的 D1 数据库：

```sh
npx wrangler d1 create my-visitor-counter-db
```

### 1.1 推荐：交互式本地安装向导

先确认 `npm ci`、`wrangler login` / `whoami`、以及**自己账户中新建的 D1** 已按上面的步骤完成，然后在解压目录运行：

```sh
node scripts/self-host-wizard.mjs
```

向导依次询问**你自己账户的确认**（输入 `OWN`）、全新 Worker 名称、新 D1 数据库名称、`wrangler d1 create` 返回的真正 D1 UUID，最后仅在输入 `CREATE` 时创建本地配置和两份随机密钥，并立即执行离线就绪检查。复制 D1 UUID 时只需粘贴在**自己的终端**，不要贴进聊天、Issue 或公开仓库。向导不会联网、执行 Wrangler、创建远程数据库、部署 Worker、上传密钥或读取账户私有信息。

向导现在会在**任何账户信息和 UUID 输入之前**检查已有配置。它会严格拒绝覆盖已有的完整或不完整配置，包括指向不存在目标的符号链接。如果已有 `wrangler.selfhost.toml` 或 `.wvt-admin-token` / `.wvt-visit-secret`，**不要删除、重置或重新运行向导以求修复**；改用安全的只读检查：

```sh
node scripts/self-host-wizard.mjs --check
node scripts/self-host-doctor.mjs --steps
```

`--check` 不联网，只核查本地状态。`--steps` 只打印后续操作命令，是否执行云端迁移和部署仍由用户本人决定。离线 PASS **不能证明** Worker 已部署、D1 真正属于哪个 Cloudflare 账户或产生何种账单。

**备选：不使用向导，手动输入参数。** 将下方名称与上一步得到的真实 D1 UUID 替换成自己的值：

```sh
node scripts/self-host-setup.mjs init --worker my-visitor-worker --database my-visitor-counter-db --database-id YOUR_NEW_D1_UUID
node scripts/self-host-setup.mjs check
node scripts/self-host-readiness.mjs check
```

该命令仅在电脑本地生成 `wrangler.selfhost.toml`、`.wvt-admin-token` 和 `.wvt-visit-secret`，**不会访问 Cloudflare、部署 Worker 或修改远程 D1**。会生成两份不同的随机密钥和互不相同的限流命名空间 ID；每个命名空间还应检查不与自己的其他 Worker 冲突。

- 重复运行 `init` 不会覆盖现有文件或密钥。重新安装前请先安全备份它们，否则可能无法管理已有计数器。
- `check` 会核对 Worker/D1 名称、UUID、关闭 OAuth 的标志、限流标志以及两份不同的密钥；不验证 Cloudflare 账户身份，也不会发出网络请求。
- `wrangler.selfhost.toml` 与两份密钥文件均由 `.gitignore` 排除，不可上传到 GitHub。Windows 上还需注意所在文件夹的 NTFS 共享权限。
- **仅首次初始化时使用新建的 D1 数据库**；本工具不是从其他账户迁移或接管已有计数器的工具。

**新增：发行前离线验收报告。** `node scripts/self-host-readiness.mjs check` 会在不调用网络的情况下确认 Node.js 22.12+、私有配置、两个不同的本地密钥、Git 忽略规则、npm 锁定依赖、Worker 原始代码及四份 D1 迁移脚本。如果需要保留一份**不包含 Worker 名称、D1 UUID、管理员密钥或密钥哈希**的 JSON 报告，可以改用：

```sh
node scripts/self-host-readiness.mjs check --report self-host-readiness.json
```

报告文件使用不可覆盖的独占写入：已存在时会停止，不会修改旧文件。报告中的云端账户归属、远程 D1 迁移、部署、实际访问和计费会明确标记为 `NOT_TESTED`，**离线通过不等于获准正式发布**。如果要把报告附在 GitHub Issue 中，应事先自行检查文件内容，只提交报告，不要附带本地配置、秘密文件或 `.dev.vars`。

### 2. 先执行无需 Cloudflare 账户的端到端测试

在执行任何远程部署之前，使用本仓库自带的**一次性本地自托管测试**：

```sh
node worker/self-host-smoke.mjs
```

此脚本会临时创建**另一份测试配置与临时 D1**，用真实本地 Wrangler 启动后端，自动模拟创建计数器、通过本地 CLI 发布、访问计数、去重、修改设计、停止和重新启动，再检查是否保留同一 URL、样式和累计次数。

- 测试全程使用 `--local` 及独立临时数据库目录，**不会使用或迁移你的真实云端 D1**。
- 采用随机、临时的测试密钥；测试完成后删除创建的临时配置、测试密钥及数据库。不影响 `wrangler.selfhost.toml`、`.wvt-admin-token`、`.wvt-visit-secret`。
- 如果项目根目录已有 `.dev.vars` 或 `wrangler.selfhost.smoke.toml`，脚本会拒绝运行，以防覆盖它们。此时请使用干净的项目副本进行测试，不要删除已有用户密钥。
- 测试通过不代表 Cloudflare 账户身份、真实 D1、公开访问和费用控制已经完成实机验收。

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

**新：脱敏的只读远程验收报告。** 想为 Issue #22 保存最小化的核验状态时，可在现有只读验证命令后加入 `--report selfhost-readonly-proof.json`。只有所有请求成功才会新建该文件；同名文件已存在则拒绝覆盖。此类报告默认被 Git 忽略，文件权限尽可能设置为仅自己可读。报告**不包含** Worker 地址、账户子域名、计数器 slug、密钥、D1 UUID、访问量或管理员请求头，只列出已经 PASS 的项目与必须继续 `NOT_TESTED`／`NOT_VERIFIED` 的真实云端验收项目。它不是数字签名，也不能替代账户持有人及维护者分别确认计费隔离。即使上传报告到 Issue，仍需先检查内容。

首次实际创建自己的计数器之后，可以进一步检查它的 SVG 是否已公开可读（同样只发送 HEAD，不增加次数）：

新版本还会在已知计数器的 `HEAD` 响应中严格检查 `Content-Type: image/svg+xml`、公开且有界的缓存 TTL、`nosniff`、CORS/CORP 跨域图片访问，以及禁止 Cookie／附件下载等不安全响应头。缺少这些条件会直接报告失败；**本检查不会发出 SVG GET，不会增加访问记录，也不能证明 GitHub 图片代理实际加载或按 60 秒刷新**。没有提供真实 `--slug` 时仍只验证随机不存在的 SVG 返回 404，不会凭空声称响应头已通过。

```sh
node scripts/self-host-verify.mjs --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --token-file .wvt-admin-token --slug my-counter
```

**安全提醒：** 工具不会自动发现自己的 Cloudflare 地址；请手动核对 `--api` 确实指向自己的 Worker。管理员密钥仅会发送至这个明确指定且通过地址校验的 HTTPS 目标，禁止重定向，也禁止维护者的 staging 地址。已有本地自托管配置时，验收工具也会验证 `workers.dev` 地址的 Worker 名称与本地配置一致；对自定义域名仍无法确认归属。它无法核验 Cloudflare 账号的实际所有权、收费额度、域名 DNS、其他 Worker 的流量、真实跨机房限流或 GitHub 图片缓存行为。它验证的是现有服务端接口的可观察状态，不是完整生产环境安全审计。



### 3.1 离线核对双层 workers.dev 地址（不需要重复测试）

Cloudflare 的完整 Worker 地址由 **Worker 名称**、**账户的 workers.dev 子域名**和固定的 `workers.dev` 后缀构成。D1 数据库的名称**不是**网址的一部分。例如，如果 Worker 名称和账户子域名都叫 `wvt-friend-mac-01`，那么完整地址就是：

```text
https://wvt-friend-mac-01.wvt-friend-mac-01.workers.dev
```

不应擅自删除其中一个名称，也不应把 Cloudflare 控制台显示的账户子域名当作完整的 Worker 地址。新版 ZIP 提供一个**完全离线**工具，根据本地私有 `wrangler.selfhost.toml` 读取 Worker 名称，并结合你在 Cloudflare Dashboard 中**亲自确认**的账户级子域名拼出完整网址：

```sh
node scripts/self-host-url.mjs --account-subdomain YOUR_ACCOUNT_SUBDOMAIN
```

如已确实知道该 D1 中存在的计数器 slug，可用如下命令直接获得精确的 SVG 和 README Markdown：

```sh
node scripts/self-host-url.mjs --account-subdomain YOUR_ACCOUNT_SUBDOMAIN --slug YOUR_EXISTING_COUNTER_SLUG
```

**严格限制：** 这里的 `--account-subdomain` 只能填账户级的一段名称，不能填写完整 URL、D1 名称或 `<Worker>.<账户>.workers.dev`。不会自动从 Cloudflare 获取该值。此工具只读取本地 Worker 配置，**不读取密钥、不联网、不部署、不访问 D1 或 GitHub**；当环境变量 `WVT_API_URL` 与计算结果不一致时拒绝输出，避免把令牌发向旧地址。它无法证明账户所有权或真实 DNS 状态。

**如果出现 `Counter not found`：** 检查是否把指南里的 `my-counter` 示例值误当成真实 slug。已完成实机验收的诊断记录应以 `livecheck-...` 为准；如果记录丢失，新部署可用 `self-host-publish.mjs list` 通过管理员权限**只读**列出真实 slug（注意会产生 D1 查询用量）。旧部署如不支持 `list`，不能为排查而重复 `create`、重新运行带写入的 `live-check` 或擅自迁移数据库。离线工具拼出的图片链接**不代表**该计数器确实存在。

### 3.2 一条命令完成本地自托管检查

如果不想分别执行配置检查、Worker 域名生成、报告恢复和 README 图片核对，可以使用**离线诊断工具**，它会重复利用已经存在的安全检查和原有资源，而不是创建一套新部署流程：

```sh
node scripts/self-host-doctor.mjs
```

上面检查 Node.js 版本、本地 Worker/D1 配置、独立随机密钥、限流、Git 忽略规则、锁定依赖及数据库迁移文件；输出不包含管理员密钥、D1 UUID 或其他私人配置内容。如已在 Cloudflare 控制台亲自确认账户级 workers.dev 子域名：

```sh
node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_SUBDOMAIN
```

如已有确切的计数器 slug，可进一步同时检查**自己的本地 README**：

```sh
node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_SUBDOMAIN --slug YOUR_EXISTING_COUNTER_SLUG --readme README.md
```

如已保留先前完成的独立云端诊断报告，也可省略 slug，改用：

```sh
node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_SUBDOMAIN --report selfhost-live-result.json --readme README.md
```

**让诊断工具给出下一步命令（只打印，不执行）：**

```sh
node scripts/self-host-doctor.mjs --steps
node scripts/self-host-doctor.mjs --account-subdomain YOUR_ACCOUNT_SUBDOMAIN --steps
```

第一条只提供离线配置、一次性本地 D1 测试和账户核对步骤，不会打印云端部署命令。第二条在**本地检查通过**且你确认账户子域名后，额外打印远程迁移、部署、交互式密钥上传、只读验证及计数器名称恢复的手动命令；但**不会自动执行任何命令**。确认自己的 Cloudflare 账户、Worker、全新可丢弃 D1 和费用后，使用者才应决定是否逐条运行涉及 `--remote`、`deploy` 或 `secret put` 的命令。已有数据不应为排查而重建或迁移。

**诊断失败时的安全故障代码：** Doctor 不再把“全部错误”隐藏成一条无法定位的提示，也不会回显原始异常中可能包含的文件路径或密钥。它输出固定的 `WVT-Dxx` 类别与对应建议：`D01` 缺少本地文件、`D02` Node 版本、`D03` 本地密钥、`D04` Wrangler 配置、`D05` npm 锁定文件、`D06` Worker 地址冲突、`D07` 账户子域名或 slug、`D08` 实机报告、`D09` 本地 README；无法安全判定时输出 `D00`。**不要把密钥或私有配置粘贴到 Issue/聊天中**。这里的代码只针对本地检查，不代表真实 Cloudflare 测试或账单验证。

README 检查只报告 `MATCH`、`DIFFERENT_COUNTER_URL` 或 `MISSING_COUNTER_IMAGE`，**绝不自动编辑文件**；报告中的成功标志并不是密码学签名，也不能证明链接目前仍能被访问。诊断工具不会发出网络请求、运行 Wrangler、部署或修改 D1；仅在本地读取并检查密钥内容是否符合要求，不在输出中回显。即使全部通过，**Issue #22 的真实独立云端、GitHub 图片渲染及账单验收仍未完成**。如果没有已知 slug 或报告，工具只会给出使用 `list` 的独立只读命令，不会尝试新建计数器；该 `list` 命令如手动执行，仍会产生自己的 D1 读取用量。

### 在 Mac 终端中一次保存 Worker 地址（无需重复填写）

由真实 Mac 试用反馈创建的 [Issue #23](https://github.com/guitar0788/workshop-Visitor-Terminal/issues/23) 已对应到统一的 `WVT_API_URL` 支持。先从**自己的** Cloudflare 控制台核对完整地址，其格式为 `https://<Worker 名称>.<账户 workers.dev 子域名>.workers.dev`，它与 **D1 数据库名称无关**。两段恰好重名也完全正常。

在 Mac 的「终端」中执行一次（下方必须替换为使用者自己的地址）：

```sh
export WVT_API_URL="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
printf 'Active Worker: %s\n' "$WVT_API_URL"
```

**同一个终端会话**接下来不必再写 `--api`，本版的三个工具自动读取这一变量，并保留之前的 HTTPS、`workers.dev`、私有 Worker 名称核验和管理员权限检查：

```sh
node scripts/self-host-verify.mjs --token-file .wvt-admin-token
node scripts/self-host-publish.mjs inspect --slug YOUR_EXISTING_SLUG --token-file .wvt-admin-token
node scripts/self-host-readme.mjs --report selfhost-live-result.json
```

第三条命令**只从本地已完成的报告中恢复 README 图片地址**，不会连接 Cloudflare，也不会更改任何计数。如果需要发布新设计，可对 `self-host-publish.mjs create` 或 `update` 使用同样的环境变量。实机写入验收也支持省略 `--api`，但**仍必须**提供 `--allow-persistent-test-record` 和 `--confirm-worker`，绝不自动授权或启动测试。

打开新的终端窗口后，可以重新执行上面的 `export`；若用户想长期保存自己的**公开 Worker URL（不是密钥）**，可自行将这一行加入私人 `~/.zshrc`。本项目不会修改 shell 配置，也绝不把管理员密钥写入 `~/.zshrc`。不要保存或复用维护者的 staging 地址，Cloudflare 账号变更后务必重新核对 `WVT_API_URL`。

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

**找回遗失的计数器名称（管理员只读）：** 新版本支持 `list`，可从自托管账户的已有 D1 中列出最多 100 个计数器的 slug、访问次数和准确的公开 SVG Markdown。它**不会创建计数器、更新设计或增加访客记录**，无需先有成功的实机验收报告；但会产生自己的 D1 查询读取量，不是完全离线操作。

```sh
node scripts/self-host-publish.mjs list --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --token-file .wvt-admin-token
```

**兼容与保护：** 新建的独立部署会启用 `SELF_HOST_ADMIN_LIST_ENABLED = "true"`，同时必须保持 `PUBLISHING_ENABLED = "false"`。原有 OAuth 试点和未启用此开关的旧 Worker 均返回 HTTP 405。已有自托管配置即使缺少此新开关，也继续支持原有 `create/update/inspect`；不要为了取回计数器名称而擅自升级他人的 Worker、迁移 D1 或重建计数器，只有部署所有者明确同意后才可手动采用新版配置。

查询次数（不会增加次数）：

```sh
node scripts/self-host-publish.mjs inspect --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug my-counter --token-file .wvt-admin-token
```

成功发布后 CLI 输出对应的 README Markdown，例如 `![Visitor counter](https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/v1/counters/my-counter.svg)`。用户自行决定是否粘贴进**自己的** README；工具不会自动编辑任何 GitHub 仓库。

### 4.1 找回已发布的 Studio 设计（新增只读导出）

如果电脑上的 `visitor-terminal.design.json` 丢失，但自己的独立自托管 Worker/D1 仍存有该计数器，可以用**管理员只读**导出恢复编辑稿：

```sh
node scripts/self-host-publish.mjs export --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --slug YOUR_EXISTING_COUNTER_SLUG --token-file .wvt-admin-token
```

成功后在**当前终端目录**生成 `visitor-terminal-YOUR_EXISTING_COUNTER_SLUG.design.json`。使用 Studio 的「导入 JSON」打开即可继续编辑。命令只发出用于验证服务身份的匿名 GET、一次带管理员令牌的**设计 GET**；不会请求公开 SVG、增加访客次数、改变 D1，或导出访客 IP、去重记录、计数、所有者、Cloudflare ID 或密钥。远程 D1 的管理员只读查询仍可能产生使用量，并非完全离线。

**安全保护：** 导出文件名由已校验的 slug 自动生成；不能指定任意路径。文件以尽可能仅当前用户可读的权限新建，已经存在的文件或符号链接绝不覆盖；已存在时甚至不会联系 Worker。新导出的 JSON 由 `.gitignore` 忽略，以免被意外提交到仓库。此命令仅适用于具有 `SELF_HOST_ADMIN_LIST_ENABLED = "true"` 且 `PUBLISHING_ENABLED = "false"` 的新版独立自托管 Worker：旧 Worker / OAuth 试点会拒绝读取，**不要为了取回文件而擅自重新部署、迁移旧 D1 或创建新计数器**。它也不是完整 D1 数据库备份；如需保护计数记录仍应使用 D1 官方备份/导出流程。

如果首次 `create` 已写入记录但设计上传失败，请使用 `update` 重试，而不是再次创建或清空数据库。管理员令牌只从本地忽略文件或 `WVT_ADMIN_TOKEN` 环境变量读取，不通过命令行参数传入。

**新增：发布前先离线验证设计文件。** `create` 和 `update` 会先以限定大小（20 KB）的读取方式检查本机 JSON 文件，确认确实包含 Studio `schemaVersion: 1` 设计。如果文件不存在、无效或超限，**不会向 Worker 发出请求，也不会读取管理员令牌**。本地文件或密钥读取失败时，只显示固定的检查建议，不回显可能包含用户名、私人目录或密钥的原始操作系统错误。使用 `inspect` / `list` 时不会读取设计文件。

**网络错误保护：** 自托管发布工具的认证请求现在只输出经过筛选的错误，不回显网络异常、远程响应正文或管理员令牌。如果第一次 `create` 请求超时、断开或返回非预期数据，不能确认云端 D1 是否已成功插入；请先使用 `inspect` 检查原始 slug，确认后才考虑 `update`，不要直接更换 slug 或重复写入。此处不会自动重试创建。

**发布前的匿名安全检查：** `create`、`update`、`inspect`、`list` 每次都会先调用自己的 `/health`、`/v1/my/counters` 和匿名 `/v1/admin/usage`，确认目标确实表现为预期的 Workshop Worker、OAuth 公开发布关闭且管理员接口拒绝匿名请求。只有这三项检查通过后，工具才会读取并发送管理员密钥。这能阻止误连到不兼容的服务，**不能证明目标服务器归自己所有**：恶意服务器仍可能伪装上述接口，请务必自行核对 `--api` 和 Cloudflare 控制台中的 Worker 名称。认证请求禁止跳转。若本地已有 `wrangler.selfhost.toml`，工具还会对 `*.workers.dev` 地址检查 Worker 主机名前缀与本地配置一致；配置损坏或名称不一致时拒绝发布。**自定义域名无法通过这个名称检查验证所有权**，请在 Cloudflare 中亲自确认绑定。



### 5. 自愿进行独立 Cloudflare 实机测试（会写入自己的 D1）

前面的 `self-host-verify.mjs` 是**只读检查**，无法证明真实的访问计数、五分钟去重与设计更新已经在自己的 Cloudflare 账户里正确执行。为此，本项目提供**需要明确授权才运行**的实机验收工具。只有已经使用自己的账户新建 D1、完成远程迁移与 Worker/密钥部署，并准备接受一次永久性测试记录的人才应运行：

```sh
node scripts/self-host-live-check.mjs --api https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev --owner YOUR_GITHUB_NAME --confirm-worker YOUR-WORKER --allow-persistent-test-record --token-file .wvt-admin-token --report selfhost-live-result.json
```

运行前请逐项核对：Worker 地址来自**自己的 Cloudflare 控制台**；`--confirm-worker` 完全等于本地 `wrangler.selfhost.toml` 的 Worker 名称；管理员密钥来自自己的 `.wvt-admin-token`。不支持自定义域名、HTTP 公网地址、维护者 staging Worker 或隐藏的自动部署模式。

独立试用者请按照 [Issue #22 实机验收清单](https://github.com/guitar0788/workshop-Visitor-Terminal/issues/22) 记录测试步骤及脱敏证据。重新部署之后的计数保留和 Cloudflare 账单归属必须由测试账户持有人单独确认。只有全新、独立、可丢弃的测试 Worker 才适合重复部署测试。

此测试先用匿名请求验证后端身份、OAuth 关闭和管理接口权限，再读取当日 D1 预算并要求至少 3 条剩余额度。确认后在**自己的 D1 中永久创建一个随机 `livecheck-...` 计数器**，进行一次不计数的 `HEAD`、首次公开 SVG `GET` 加一、同来源第二次 `GET` 去重、更新设计，以及确认次数不被清零。它仅执行所述写入和少量请求；**不会自动删除诊断计数器、修改其他计数器、部署 Worker、迁移数据库或管理 Cloudflare 账户**。

- 这不是零成本检查；会消耗少量 Worker 请求和 D1 读写额度。不要在已有大量流量、限额耗尽或其他用户共享的数据库上运行。
- 网络中断可能发生在远端已经写入之后，遇到错误时应根据输出的诊断 `slug` 检查情况，**不要反复运行**以免留下多个永久测试计数器。
- 工具不能从外部证明 D1 与 Cloudflare 账户属于谁，也不能测试真实账单、套餐、GitHub 代理缓存、跨机房限流、定时清理或长期运行可靠性。这些仍需要账户所有者在 Cloudflare 控制台里人工确认。
- `--report` 是可选的本地 JSON 文件，只写新文件、不会覆盖已有报告，也不会记录管理密钥、D1 UUID 或 Worker URL；报告将账户所有权和计费隔离明确保留为 `NOT_VERIFIED`。如果需要分享，请先自行检查报告内容。
- 项目 CI **绝不运行公网实机模式**；它只在一次性本地 Worker/D1 中调用同一套验收逻辑，验证流程而不产生云端用量。

### 5.1 README 图片出现 `Counter not found`：无需重新部署的恢复方法

**Mac 真实试用反馈已记录为 [Issue #24](https://github.com/guitar0788/workshop-Visitor-Terminal/issues/24)。** `/health` 返回成功，仅代表 Worker 服务已启动；当 README 引用的 SVG 路径中某个计数器名称在 D1 不存在时，服务会返回 HTTP 404 `Counter not found`。这通常是把文档示例 `my-counter` 当成真实计数器，而实机验收工具实际创建的是**随机 `livecheck-...` 计数器**。不能把某个不存在的名称自动转换成真实计数器，更不应该为了修复 README 反复部署 Worker 或重新创建 D1。

从本版开始，**成功执行实机测试之后**，终端会自动输出原始 HTTPS 图片 URL 和可以直接复制的完整 Markdown：`![Visitor counter](https://.../v1/counters/livecheck-....svg)`。只复制该真实路径，不要复制 `my-counter` 模板。

如果测试已经结束，而本地还保留了当时生成的 `selfhost-live-result.json`，新版测试包提供**完全本地、只读、不需要管理员令牌、不访问 Cloudflare**的恢复命令。在 macOS 终端，先进入解压后的独立自托管包目录，执行：

```sh
export WVT_API_URL="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
node scripts/self-host-readme.mjs --report selfhost-live-result.json
```

其中 `WVT_API_URL` 必须使用 Cloudflare Dashboard 上自己的 **Worker 名称 + 账户子域名**完整地址（允许两部分重名）。不能从 D1 数据库名推断域名。若当时保存的是 `live-check.json`，将 `--report` 后的文件名替换即可。该命令会确认已有报告记录 `REMOTE_SELF_HOST`、`PASS`、诊断计数器名称合规、六项计数/去重/更新测试均通过，并输出准确 Markdown。原报告仍只保留本地、不会被修改；恢复过程中**不会发起 HTTP 请求，更不会改变云端数据或 GitHub README**。

要检查当前 SVG 是否仍然存在，可自行在浏览器打开输出的 HTTPS URL，或执行 `curl -I "完整的SVG地址"`。HTTP 200 且 `Content-Type: image/svg+xml` 表示图片接口当前可用，HTTP 404 表示这个 slug 在当前 Worker 的 D1 不存在；不应直接归咎于 Safari/GitHub 图片缓存。HTTP HEAD 不增加计数。如果 Safari 直接打开真实 SVG 正常，而 GitHub 页面仍显示失败，再检查 README 中是否逐字粘贴正确 URL 和 GitHub 图片代理缓存。此时仍不需要重新部署 D1。

如果此前没有生成成功的实机验收 JSON 报告，恢复工具会拒绝凭空猜测一个计数器名称。**不要为绕过这个限制在其他人的账户中制造新的计数器。**

### 5.1.1 三款批准卡片的 SVG 图片加载模式

像素猫、绿色终端和蓝金 RPG 三款使用批准的原始画面（内嵌 `image/avif`），与另外六款矢量插画实现不同。**Chrome 单独打开 SVG 正常，不代表 GitHub README 图片代理能显示它。**

项目新增离线浏览器验收：`node scripts/card-image-context-audit.mjs build` 生成 9 张 HTML `<img>` 引用 SVG 的预览（三款 × 12,847／12,848／999,999,999,999），并由专用 Actions 在真实 Chrome 中执行 `img.decode()`、检查原始尺寸、验证画面确有可见颜色与细节。该测试不连接 Cloudflare/GitHub，不增加访问量或使用数据库。构建产物包含 `WVT-Three-Approved-External-Image-Mode.png` 和离线 HTML。

**这个检查不能替代 GitHub README 的实机图片验收。** GitHub 图片代理、SVG 内嵌 AVIF、安全过滤、缓存及实际 Worker 响应头都可能影响远程展示。三款未通过真实 README 展示前不能宣称 GitHub 兼容已验证，更不能解除 Issue #22 的发布门禁。不要为了视觉诊断重新创建计数器或部署新 Worker。

### 5.2 纯离线核对本地 README 中的计数器 SVG

如果已经保存了**真实远程验收成功报告**，且电脑上有待提交的 README.md，可在上传 GitHub 前对照检查：

```bash
export WVT_API_URL="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
node scripts/self-host-readme.mjs --report selfhost-live-result.json --readme README.md
```

该检查只读取本地 Markdown 和现有验收报告，绝不连接 Cloudflare 或 GitHub，不读取管理员令牌、不增加访客计数、不修改 README。返回 `MATCH` 表示图片链接与成功验收报告的确切 SVG URL 一致；`DIFFERENT_COUNTER_URL` 表示检测到其他计数器图片，但没有匹配真实验收报告的链接；`MISSING_COUNTER_IMAGE` 表示未发现符合格式的计数器 Markdown 图片。工具始终输出正确的 README Markdown 以供自行复制。

这不是远程 D1、浏览器渲染、GitHub 图片代理或 Cloudflare 计费隔离验收；也不能在没有成功实机验收报告时猜测 slug。朋友已经完成的测试不需要重跑，也不需要创建新的诊断计数器。

### 6. 费用、安全与云端账户隔离

**最重要的隔离规则：** 每位自托管者使用自己的 Cloudflare 账户、新建 Worker 和 D1，以及自己生成的管理员密钥。不要将维护者的 Worker URL、D1 UUID、Cloudflare API Token、GitHub OAuth 密钥复制给其他用户。发布包不会自动连到维护者账号，也不会替用户选择套餐。

**用量不能被项目中的 20,000 上限完全控制：**

- `visit_day_budget` 每 UTC 日最多接受 20,000 条新的去重计数记录，它并非 D1 读行数、D1 写行数、Worker 请求数或云端账单的统一限制。未增加次数的 SVG `HEAD` /重复 `GET` 也可能消耗 Worker 请求及部分 D1 读取。
- Worker 的 60 次/分钟每计数器、120 次/分钟每机房两级限流为**近似且各地独立**，不会把全球流量严格限制在 120 次/分钟。大量访问 `/health` 或其他非 SVG 路由也不属于这两个 SVG 限流器。
- Cloudflare D1 免费计划当前公开的日额度为 500 万行读取、10 万行写入。自 2026-09-01 起，免费账户超出日额度后 D1 查询会失败（通常直到 UTC 午夜重置）；这不是本项目提供的“防止任何费用”保证。
- 如需监控，请在自己的 Cloudflare Dashboard 中检查 **Workers 请求数、D1 Metrics → Row Metrics、存储量、账户套餐与 Billing**。若达到预算阈值，应由账户所有者主动停用自己的 Worker、调整访问规则或移除公开 SVG 引用；本工具不会在后台替用户暂停云服务。

相关文档：[Cloudflare D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers 费率和限额](https://developers.cloudflare.com/workers/platform/pricing/)、[Workers Rate Limiting（机房级近似限流）](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)、[D1 免费额度执行公告](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/)。



- 自托管用户负责自己的 Cloudflare 额度、费用报警、备份、秘密轮换和 Worker/D1 生命周期；本项目不会承担这些用量。
- 模板设置了每机房近似的两级 SVG 限流。数据库还有全局 UTC 日最多接纳 20,000 条新去重访问记录的机制。**它们不能彻底限制所有 Worker 请求或全部 D1 读取量**。
- 管理 API 由 `ADMIN_TOKEN` 保护，令牌不可暴露在公开网页中。CLI 禁止把密钥发送到本项目维护者的 staging Worker，并禁止跟随可能泄漏令牌的 HTTP 重定向。
- Worker 定时清理陈旧的去重窗口；不会清零累计访问次数。公共 SVG 支持不计数的 `HEAD` 访问。
- 这不是多人 SaaS、不是公开 OAuth 注册，也不提供旧计数器的自动迁移。

## English summary

Get the CI-tested source-only preview ZIP from the latest successful PR #21 Build Self-Host Preview run (GitHub Actions Artifacts). Unzip the Actions artifact and then its inner `Workshop-Visitor-Terminal-Self-Host.zip` into a NEW folder. Check the included SHA256, run `npm ci`, then create a new D1 in your own Cloudflare account. This is not an official GitHub Release and the PR artifact is retained for seven days.\n\nUse **your own** Cloudflare account and create a new D1 database. **Recommended first-run path:** run `node scripts/self-host-wizard.mjs` in an interactive terminal after you have created a fresh disposable D1 in your own account. Type `OWN`, enter your new Worker name, database name and genuine D1 UUID locally, then type `CREATE` to generate the private config and distinct secrets; no Cloudflare calls, deployment or uploads are performed by the wizard. Run `node scripts/self-host-wizard.mjs --check` for a noninteractive local-only readiness check. If configuration or credential files already exist, the wizard now rejects them **before asking for any Worker, account or D1 UUID details** (including dangling symlinks). Do NOT reset them or rerun initialization; use `node scripts/self-host-doctor.mjs --steps` to print, not execute, the remaining manual commands. **Manual alternative:** run `node scripts/self-host-setup.mjs init --worker ... --database ... --database-id ...` and then `node scripts/self-host-setup.mjs check` to generate and validate a private local Wrangler config and two secrets without network access. The self-host template disables GitHub OAuth and reuses the existing counter backend. For safer create/update operations, the CLI validates a bounded (20 KB) local Studio design JSON **before** making any Worker request or opening the admin token file. Missing/invalid local designs therefore incur no Worker/D1 requests; local file failures are reported without exposing private filesystem paths. Read-only remote verification checks all three anonymous Worker identity/lockdown endpoints before opening its local admin token file. Run the disposable local end-to-end test `node worker/self-host-smoke.mjs` first, then use `node scripts/self-host-readiness.mjs check` to create a network-free local readiness gate before running migrations and explicitly opting into remote D1 migrations and deployment. The optional `--report` JSON excludes credentials and marks all remote checks NOT_TESTED. After deployment, run the read-only `node scripts/self-host-verify.mjs --api YOUR_WORKER_URL --token-file .wvt-admin-token` check (optionally `--slug` for an existing published counter). It verifies the Worker's identity, closed OAuth, private admin access, D1 budget and SVG HEAD without writing counts. Export a Studio `schemaVersion: 1` design JSON, and run `node scripts/self-host-publish.mjs create|update|inspect` against **your own HTTPS Worker** with a private `--token-file`. Success prints the dynamic SVG Markdown; it does not update a GitHub profile automatically.

**New read-only design recovery:** With the independently hosted Worker updated to this branch (explicit `SELF_HOST_ADMIN_LIST_ENABLED="true"`, OAuth publishing disabled), run `node scripts/self-host-publish.mjs export --api YOUR_WORKER_URL --slug EXISTING_SLUG --token-file .wvt-admin-token` to save `visitor-terminal-EXISTING_SLUG.design.json` in the current directory. This uses authenticated GET only, never invokes the public counting SVG, never updates D1 and never replaces an existing local file or symlink. Backups are gitignored, limited to a whitelisted Studio design and contain no counter total, visitor receipts or account secrets. It makes remote D1 read requests and is **not** a whole-database backup; older Workers reject the route until deliberately updated by their owner. Never redeploy a tester's finished Worker merely to recover a local file.

A completed live-check now prints the exact counter SVG URL and full README Markdown; do not copy the placeholder `my-counter` when a real `livecheck-...` diagnostic slug was used. If the test has already finished, use `WVT_API_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev node scripts/self-host-readme.mjs --report selfhost-live-result.json` to recover the correct Markdown **entirely offline**, without any remote requests, tokens, redeployment, writes, or guessing a slug.\n\nOptional remote write acceptance: after manually deploying YOUR OWN Worker/D1, run `node scripts/self-host-live-check.mjs --api YOUR_WORKER_URL --owner YOUR_GITHUB_NAME --confirm-worker YOUR-WORKER --allow-persistent-test-record --token-file .wvt-admin-token`. This explicitly creates a **permanent** diagnostic counter and tests real SVG counting, deduplication and design updates. CI only simulates this on disposable local D1; a passing local simulation does not prove an independent Cloudflare account deployment.\n\nWindows and macOS CI now install and test the extracted ZIP using Node.js 22 on a Windows GitHub runner. Use Node.js 22.12+ for the locked patched Vitest 5 tooling; Cloudflare officially supports Wrangler on Windows 11, not Windows 10. Release preview ZIPs are gated on a full `npm audit --audit-level=moderate` and real Windows and macOS Worker/D1 smoke, but this remains a technical preview.\n\nFor a macOS terminal, set `export WVT_API_URL="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"` once. The self-host publisher, read-only verifier and consented live-check can then omit repeated `--api`. Explicit CLI origins remain supported for local smoke tests; the implicit origin must be a strict HTTPS workers.dev root, and existing private config/credential protections remain in force. Only add this **public URL**, never any private token, to a personal `~/.zshrc` if the user wants it to persist.

**Release gate remains open:** independent real-account Cloudflare operations and billing isolation are tracked in [Issue #22](https://github.com/guitar0788/workshop-Visitor-Terminal/issues/22). No live-account acceptance has been performed in project CI. 

For download, choose only `Workshop-SelfHost-Validated-Preview` from a successful **Build Self-Host Preview** workflow. `Workshop-SelfHost-CI-Input` is a pre-cross-platform internal testing artifact. The validated preview includes the ZIP, `.sha256`, and a source-head manifest that explicitly states remote Cloudflare ownership, deployment, D1 usage and billing are `NOT_TESTED`. Also inspect `Verify` separately.\n\nThis is a technical preview, not a hosted service or promise of free Cloudflare capacity. Image cache effects mean counts represent qualifying upstream requests, not unique people.

Official Cloudflare references: [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/) and [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
