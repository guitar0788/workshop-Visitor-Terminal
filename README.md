# Workshop Visitor Terminal / 工坊访客终端

**English | [简体中文](#简体中文)**

A free, open-source visual studio for creating SVG visitor counters for GitHub profile READMEs. Build your own design without writing SVG or CSS.

**[Open Workshop Studio / 打开在线编辑器](https://guitar0788.github.io/workshop-Visitor-Terminal/)**

> **Alpha · v0.4 — The online studio still exports static SVG. A separate Cloudflare Worker + D1 backend has been added for local/isolated testing; it has NOT been deployed to production.** All numbers shown are examples; hosted counting, persistent storage and dynamic README embed links are future milestones.

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

A **manual-only, staging-only deployment workflow** is ready for Cloudflare account setup. See the [English and Chinese staging guide](worker/STAGING.md). The remote Worker and D1 database have **not** been created by this repository or deployed. Live counting in the GitHub Pages editor is **not enabled**.

已准备 Cloudflare 测试专用部署与远程验收工作流。请查看[中英文完整设置说明](worker/STAGING.md)。目前**尚未连接或部署云端 Worker/D1**，GitHub Pages 在线编辑器仍显示演示访问量。

### Backend prototype (v0.4)

A separate Cloudflare Worker + D1 service is available in [worker/](worker/README.md), including a real persistent counting data model, image endpoint, restricted admin API, request deduplication and a guarded one-time legacy baseline. **Not publicly deployed; this GitHub Pages site does not count real visits yet.** No Cloudflare account or secret is included in this repository.

Security limits: the endpoint counts **qualified upstream image requests, not unique visitors**. GitHub's proxy cache can suppress origin requests. Public enrollment and user-owned counters are deferred until stronger abuse protection and account authorization are implemented.

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

> **当前为 v0.4 测试版。** 在线编辑器仍然只能导出静态 SVG；独立的 Cloudflare Worker + D1 计数后端已进入离线及隔离测试阶段，尚未部署生产环境。 网站已支持设计与导出，但显示的访问数字属于演示数据。真实计数服务、用户设计的在线托管以及动态 README 图片链接仍在规划中。

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

**后端尚未部署，线上 GitHub Pages 编辑器仍然显示演示访问次数。** 此阶段不会修改你的 GitHub 个人主页，不会读取或覆盖旧计数服务的历史数据，也不会在 GitHub 仓库中保存 Cloudflare 密钥。

请注意：GitHub 会通过图片代理和缓存加载 README 图片，因此后端只能统计实际到达服务的有效图片请求，不能保证每次打开主页都增加一次，更不能宣称是独立访客人数。公共用户注册与托管功能需要单独完成身份验证、防滥用与用量审查。

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
| 4 | Cloudflare Worker + D1 counter prototype / 计数后端原型 | In technical review / 技术审查中 |\n| 4.1 | Isolated deployment, abuse mitigation, and security checks / 隔离部署与安全验收 | Not authorized / 未授权 |
| 5 | Hosted design publishing and public counter management / 在线设计发布及多用户管理 | Planned / 规划中 |
| 6 | README dynamic image embed + verified legacy migration / 动态链接与可验证迁移 | Planned / 规划中 |

**Counting disclaimer / 统计说明：** GitHub caches and proxies images in READMEs. A future counting endpoint will count requests that reach the service, not guaranteed unique human visitors or every profile view. GitHub 会缓存及代理 README 图片，因此未来的统计服务只能计算真正到达后端的请求，不能保证每次打开页面都会被统计，也不能将其视为精确的独立访客数量。

## License / 许可证

[MIT](LICENSE).
