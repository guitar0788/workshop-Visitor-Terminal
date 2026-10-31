# Workshop Visitor Terminal / 工坊访客终端

**English | [简体中文](#简体中文)**

A free, open-source visual studio for creating SVG visitor counters for GitHub profile READMEs. Build your own design without writing SVG or CSS.

**[Open Workshop Studio / 打开在线编辑器](https://guitar0788.github.io/workshop-Visitor-Terminal/)**

> **Alpha · v0.2 — This is a static visual editor, not a live visit-counting service.** All numbers shown are examples; hosted counting, persistent storage and dynamic README embed links are future milestones.

## English

### Features

- **Simplified Chinese / English interface**, auto-detected from the browser with a manual language switch.
- Remembers the selected language in the current browser (when storage is available).
- Language switching changes **UI labels only**, never the content or arrangement of an existing design.
- Three starter designs: Pixel Terminal, Cyber HUD and Minimal. New templates use stock text in the selected language.
- Move, resize, hide, reorder, add and delete text, counter, light and panel layers.
- Real-time SVG preview, mobile-friendly nudge controls and keyboard navigation.
- Download a static SVG or save/load designs locally as JSON.

### Getting started

1. Open the [online editor](https://guitar0788.github.io/workshop-Visitor-Terminal/).
2. Select **English** or **简体中文** in the header.
3. Pick a template and customize your layers.
4. Download the SVG. Upload it into your GitHub repository and reference the file in the profile README.

The downloaded SVG is **static**; it does not update visitor counts yet.

### Local development

Node.js 20 or newer:

~~~sh
npm install
npm run dev
npm test
npm run build
~~~

The app builds to the GitHub Pages project path. Pages deployment runs automatically on merges into \`main\`.

## 简体中文

**Workshop Visitor Terminal（工坊访客终端）** 是面向 GitHub 个人主页的免费开源 SVG 访客计数器可视化编辑器。不需要了解 HTML、CSS 或 SVG，就能自由制作计数器外观。

**[立即打开在线编辑器](https://guitar0788.github.io/workshop-Visitor-Terminal/)**

> **当前为 v0.2 测试版。** 网站已支持设计与导出，但显示的访问数字属于演示数据。真实计数服务、用户设计的在线托管以及动态 README 图片链接仍在规划中。

### 已实现的功能

- **简体中文与英文切换**：初次打开时按浏览器首选语言显示，也可在页面右上角随时手动切换。
- **记住语言选择**：浏览器允许本地存储时，下次打开沿用上一次选择。
- **保护设计内容**：切换界面语言不会翻译、移动、覆盖或清空已有图层。
- **三个初始模板**：像素终端、赛博仪表盘、极简风格；新建模板使用当前界面的默认语言。
- **可视化图层编辑**：支持拖动位置、调整尺寸、更改文字及颜色、控制可见性和顺序。
- **适配手机操作**：提供触屏方向按钮与键盘精确移动。
- **本地设计导入与导出**：支持 SVG 图片下载和 JSON 设计文件备份。

### 如何使用

1. 打开[在线编辑器](https://guitar0788.github.io/workshop-Visitor-Terminal/)。
2. 在页面顶部选择「简体中文」或「English」。
3. 选择一个模板，编辑自己想要的访客终端。
4. 下载 SVG 图片，上传到 GitHub 仓库后，在个人主页的 README 中引用该文件。

**注意：** 目前导出的 SVG 仅用于静态展示，**不会自动增加访问次数**。不要把示例数字当作真实访客数据。

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
| 3.1 | English + Simplified Chinese / 中英双语界面 | v0.2 |
| 4 | Secure server-side designs / 安全的服务端设计托管 | Planned / 规划中 |
| 5 | Cloudflare Workers + D1 counting / 真实访问统计 | Planned / 规划中 |
| 6 | README embed links + legacy migration / 嵌入链接与旧计数迁移 | Planned / 规划中 |

**Counting disclaimer / 统计说明：** GitHub caches and proxies images in READMEs. A future counting endpoint will count requests that reach the service, not guaranteed unique human visitors or every profile view. GitHub 会缓存及代理 README 图片，因此未来的统计服务只能计算真正到达后端的请求，不能保证每次打开页面都会被统计，也不能将其视为精确的独立访客数量。

## License / 许可证

[MIT](LICENSE).
