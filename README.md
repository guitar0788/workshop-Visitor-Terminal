# Workshop Visitor Terminal / 工坊访客终端

**English | [简体中文](#简体中文)**

A free, open-source visual studio for creating SVG visitor counters for GitHub profile READMEs. Build your own design without writing SVG or CSS.

**[Open Workshop Studio / 打开在线编辑器](https://guitar0788.github.io/workshop-Visitor-Terminal/)**

> **Alpha · v0.5 — GitHub OAuth publishing code is under security review and OFF by default.** The public Studio still exports static SVG and shows demonstration counts. The isolated Cloudflare staging Worker + D1 passed real deployment and persistence tests; this is not a public hosting launch.

## English

### Features

- **Simplified Chinese / English interface**, auto-detected from the browser with a manual language switch.
- Remembers the selected language in the current browser (when storage is available).
- Language switching changes **UI labels only**, never the content or arrangement of an existing design.
- Three starter designs: Pixel Terminal, Cyber HUD and Minimal. New templates use stock text in the selected language.
- Move, resize, hide, reorder, add and delete text, counter, light and panel layers.
- Real-time SVG preview, undo/redo, keyboard navigation and a clean preview mode.
- Dedicated mobile layout: compact top bar, full-width preview, four-tab bottom navigation and slide-up layer/property/export panels.
- On touch screens, tap to select a layer, then explicitly enable **Move layers** before dragging; precision buttons are available on demand.
- Download a static SVG or save/load designs locally as JSON.

### Getting started

**On mobile:** select **Layers** to add/select elements, **Properties** for adjustments, and **Export** to download. Tap **Clean preview** to hide selection guides. Touch dragging is off until **Move layers** is enabled, preventing accidental movement while scrolling.


1. Open the [online editor](https://guitar0788.github.io/workshop-Visitor-Terminal/).
2. Select **English** or **简体中文** in the header.
3. Pick a template and customize your layers.
4. Download the SVG. Upload it into your GitHub repository and reference the file in the profile README.

The downloaded SVG is **static**; it does not update visitor counts yet.

### Cloudflare staging / 云端隔离测试

The owner's dedicated Cloudflare staging Worker and D1 database **were deployed and verified** in [Actions run #41219117268](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/runs/41219117268), including deduplication, SVG rendering, and persistence after redeployment. This is **not a production/public-user launch**. Read the [staging guide](worker/STAGING.md).

独立的 Cloudflare staging 已在上述 GitHub Actions 记录中通过云端验收，包括计数、去重与重新部署后数据保留。**这不等于正式开放公众托管**，现有 GitHub Pages 工作台仍然显示演示数字。

### Backend prototype (v0.4)

A separate Cloudflare Worker + D1 service is available in [worker/](worker/README.md), including a real persistent counting data model, image endpoint, restricted admin API, request deduplication and a guarded one-time legacy baseline. **Deployed to an isolated staging environment only; GitHub Pages still displays demo values.** No Cloudflare account or secret is included in this repository.

Security limits: the endpoint counts **qualified upstream image requests, not unique visitors**. GitHub's proxy cache can suppress origin requests. v0.5 adds GitHub user authorization and ownership enforcement behind a default-off feature flag; the public onboarding and abuse controls still require review.

### Owner-only GitHub OAuth pilot / 仅所有者 OAuth 试运行

A dedicated **manual-only, staging-only** GitHub OAuth workflow is prepared. It requires explicit confirmation and validates the GitHub account ID before creating any session. See the [bilingual pilot guide](worker/OAUTH_PILOT.md). This workflow **has not been executed as part of the code merge**; ordinary Pages builds remain preview-only.

已准备 [GitHub OAuth 受限试运行操作说明](worker/OAUTH_PILOT.md)，七项机密由仓库所有者独立配置。只有经 GitHub 验证的测试账户能发布，普通网页部署仍默认关闭登录。**合并代码不等于已经启动云端 OAuth 试运行。**

### Verified-main automatic staging deployment / CI 通过后自动部署

The owner-only OAuth pilot now has an **automatic deployment workflow**: a successful `Verify` run triggered by a trusted `main` push can deploy approved runtime changes to the existing Cloudflare staging Worker and GitHub Pages pilot. The workflow independently checks the exact latest `main` commit, the `pilot` release channel, approved GitHub account and Cloudflare D1 identity, and all staging/OAuth security checks before any remote writes. Docs-only and failed/PR builds do not deploy. The original manual pilot and explicit preview rollback remain available.

现在可在代码合并到 `main` 且 **Verify 检查成功后自动部署 Cloudflare staging 与受限内测网页**，不必每次手工填写确认词。自动流程会严格核对最新提交、`pilot` 发布通道、D1 身份与原有 OAuth 保护；仅改文档、CI 失败或未授权分支不会自动部署。详细规则与暂停步骤见 [OAuth Pilot 文档](worker/OAUTH_PILOT.md)。

### v0.6 — local D1 disaster-recovery drill and multi-account isolation

[Recovery and tenant safety plan / D1 恢复与账户隔离方案](worker/V06_RECOVERY_AND_TENANTS.md) adds a CI-verified, **local-only** D1 SQL export → clean isolated import → integrity and ownership comparison → source-preservation test. Actual Cloudflare D1 restore remains manual and explicitly disallowed in automatic deployment; **no real staging data is exported**. Verified numeric GitHub ID cross-owner tests cover data listings, edits, deletion, independent quotas, and old-session invalidation without opening the owner-only public signup gate.

新增 **本地 D1 恢复演练和双账户隔离回归测试**。CI 只处理临时的假数据库，不导出真实 Cloudflare 数据，不自动执行可能覆盖现有计数器的 Time Travel 恢复。正式多账户注册仍未开放。

### v0.6 — guarded SVG traffic and D1 daily write budget

The staging pilot now adds [a two-layer abuse and cost guard](worker/V06_ABUSE_LIMITS.md): approximate per-location Cloudflare rate limits before D1 access, plus a database-enforced UTC-day cap of 20,000 new visit receipts shared by all published counters. SVG images remain readable when the daily write budget is reached; the counters pause until the next UTC day. This does **not** guarantee zero Cloudflare charges or enable public multiuser registration.

v0.6 新增 [SVG 防刷访问与 D1 每日写入保护](worker/V06_ABUSE_LIMITS.md)，通过 Cloudflare 机房速率限制减少请求洪泛，通过数据库原子额度限制全球每日新访客收据。超过写入上限后图片仍能显示，只暂停新增访问次数。正式公开用户注册仍未启用。

### v0.6 — owner-controlled deletion (pilot gated)

The authenticated Studio adds [typed-confirmation deletion for owned published counters](worker/V06_DATA_LIFECYCLE.md). The Worker requires a valid GitHub session, exact Studio Origin, matching typed counter slug, and immutable verified owner ID. Removing one counter permanently invalidates its published SVG URL after caches expire and frees one of three publication slots. Existing counters are **never deleted automatically**. This does not yet enable public account registration or Cloudflare production deployment.

v0.6 新增 [已发布计数器的安全删除与名额释放](worker/V06_DATA_LIFECYCLE.md)：需先登录 GitHub，输入完整计数器 ID 二次确认。删除后旧 SVG 地址失效，操作不可恢复；不会自动清空现有计数器或历史记录。此阶段仍限制为 staging 内测，不代表面向所有用户正式开放。

### v0.5 user-owned publishing (gated beta)

[GitHub OAuth sign-in, verified ownership, D1-backed publishing, design updates, and README Markdown generation](worker/PUBLISHING.md) have been implemented behind an explicit server/browser launch gate. The export panel explains its current preview-only status. An isolated OAuth app and separate authorization are required before enabling sign-in; **never store GitHub OAuth secrets in Vite frontend variables**.

### Local development

Node.js 20 or newer:

~~~sh
npm install
npm run dev
npm test
npm run build
~~~

The app builds to the GitHub Pages project path. Pages deployment runs automatically on merges into `main`.

## 简体中文

**Workshop Visitor Terminal（工坊访客终端）** 是面向 GitHub 个人主页的免费开源 SVG 访客计数器可视化编辑器。不需要了解 HTML、CSS 或 SVG，就能自由制作计数器外观。

**[立即打开在线编辑器](https://guitar0788.github.io/workshop-Visitor-Terminal/)**

> **当前为 v0.5 开发测试版。** GitHub OAuth 安全登录、用户归属校验、在线发布与 README 嵌入代码正在验收，**公开发布开关仍然关闭**。独立的 Cloudflare Worker + D1 staging 已通过真实云端测试，但在线编辑器仍使用演示数字，不代表真实访问统计。

### 已实现的功能

- **简体中文与英文切换**：初次打开时按浏览器首选语言显示，也可在页面右上角随时手动切换。
- **记住语言选择**：浏览器允许本地存储时，下次打开沿用上一次选择。
- **保护设计内容**：切换界面语言不会翻译、移动、覆盖或清空已有图层。
- **三个初始模板**：像素终端、赛博仪表盘、极简风格；新建模板使用当前界面的默认语言。
- **可视化图层编辑**：支持拖动位置、调整尺寸、更改文字及颜色、控制可见性和顺序。
- **手机端独立工作台**：紧凑顶部栏、画布优先、底部「预览 / 图层 / 属性 / 导出」四个导航入口。
- **按需打开编辑面板**：图层、属性和导出内容从底部弹出，无需反复滚动寻找。
- **防止误操作**：手机点按图层仅选择，开启「移动图层」后才允许拖动；可按需展开精确方向按钮。
- **纯净预览与撤销/重做**：隐藏选中轮廓，查看导出效果；编辑操作支持撤销与重做。
- **本地设计导入与导出**：支持 SVG 图片下载和 JSON 设计文件备份。

### 如何使用

**手机端操作：** 点击底部「图层」添加或选择组件，「属性」修改参数，「导出」下载文件。「纯净预览」可隐藏编辑框；需要手指拖动时，先明确开启「移动图层」，避免上下滑动页面时误移图层。


1. 打开[在线编辑器](https://guitar0788.github.io/workshop-Visitor-Terminal/)。
2. 在页面顶部选择「简体中文」或「English」。
3. 选择一个模板，编辑自己想要的访客终端。
4. 下载 SVG 图片，上传到 GitHub 仓库后，在个人主页的 README 中引用该文件。

**注意：** 目前导出的 SVG 仅用于静态展示，**不会自动增加访问次数**。不要把示例数字当作真实访客数据。

### v0.4 计数服务原型

已新增 [Cloudflare Worker + D1 计数后端](worker/README.md)：包含持久化数据库表、动态 SVG 图片接口、管理员验证、短时间重复请求限制及一次性的历史计数迁移保护。

**后端已经在独立 Cloudflare staging 环境部署并通过云端测试；GitHub Pages 编辑器仍然显示演示次数。** 此阶段不会修改你的 GitHub 个人主页，不会读取或覆盖旧计数服务的历史数据，也不会在 GitHub 仓库中保存 Cloudflare 密钥。

请注意：GitHub 会通过图片代理和缓存加载 README 图片，因此后端只能统计实际到达服务的有效图片请求，不能保证每次打开主页都增加一次，更不能宣称是独立访客人数。公共用户注册与托管功能需要单独完成身份验证、防滥用与用量审查。

### v0.5 用户在线发布（默认关闭）

已新增 [GitHub OAuth 身份验证、用户权限隔离、在线发布及 README Markdown 生成](worker/PUBLISHING.md)。用户登录和在线发布功能尚未向公众开放，页面会明确显示预览状态，不会把 staging 测试数字冒充真实统计。启用前需要新建独立 GitHub OAuth 应用并完成权限、跨账号和防滥用验收。

### 本地开发

需要 Node.js 20 或更新版本：

~~~sh
npm install
npm run dev
npm test
npm run build
~~~

## Roadmap / 开发计划

| Stage / 阶段 | Goal / 目标 | Status / 状态 |
| --- | --- | --- |
| 1 | SVG preview and templates / SVG 预览与模板 | Complete / 已完成 |
| 2 | Visual layer editing / 图层可视化编辑 | Complete / 已完成 |
| 3 | GitHub Pages editor / 在线编辑器 | Complete / 已上线 |
| 3.1 | English + Simplified Chinese / 中英双语界面 | Complete / 已完成 |
| 3.2 | Mobile Studio with undo/redo / 手机工作台、撤销与重做 | v0.3 |
| 4 | Cloudflare Worker + D1 counter prototype / 计数后端原型 | Complete / 已完成 |
| 4.1 | Cloudflare staging D1 deployment and persistence / 云端隔离测试与持久化 | Verified / 已验收 |
| 5 | OAuth login, verified ownership, hosted designs / OAuth 登录、用户归属与在线设计 | Code ready; launch gated / 代码已开发，暂未开放 |
| 6 | README embed workflow and verified legacy migration / README 嵌入与可信历史迁移 | Embed code implemented; migration remains restricted / 已开发嵌入代码，旧数据迁移仍受限 |

**Counting disclaimer / 统计说明：** GitHub caches and proxies images in READMEs. A future counting endpoint will count requests that reach the service, not guaranteed unique human visitors or every profile view. GitHub 会缓存及代理 README 图片，因此未来的统计服务只能计算真正到达后端的请求，不能保证每次打开页面都会被统计，也不能将其视为精确的独立访客数量。

## License / 许可证

[MIT](LICENSE).
