# Offline Studio / 本地离线版

**Official repository:** https://github.com/guitar0788/workshop-Visitor-Terminal

**This is a standalone design editor, not a remotely hosted visitor-count service.** It runs entirely in the user's own browser after download and never needs the maintainer's Cloudflare Worker, D1, GitHub OAuth app, API tokens, or an internet connection.

## 简体中文 — 推荐给普通试用者

### 无需安装，双击即可使用

1. 打开 [Workshop Studio（GitHub Pages）](https://guitar0788.github.io/workshop-Visitor-Terminal/)。
2. 在「导出」区域点击 **下载离线 HTML**，获得 `Workshop-Studio-Offline.html`。
3. 把文件保存到电脑上的任意目录，**双击 HTML 文件**，用 Chrome、Edge 或 Firefox 打开即可。
4. 即使断网，也可以选择模板、编辑图层、移动与调整尺寸、实时预览、保存 SVG、保存/加载 JSON 设计，以及切换中英文。
5. 测试完成后将问题反馈到 [GitHub Issues](https://github.com/guitar0788/workshop-Visitor-Terminal/issues)，可提供无敏感信息的截图或问题步骤，不需要上传私人的账户数据、访问令牌或浏览器文件。

文件是一个完整 HTML，内含编辑器程序与样式；**不要求安装 Node.js、启动服务或配置 Cloudflare**。打开后浏览器内容安全策略限制所有网络连接（`connect-src 'none'`），并且编译时已明确禁用云端登录与发布按钮。

**重要区别：** 在离线版中填写或调整的访问次数是预览演示数字。下载的 SVG 是静态图片，**不会自动增加访问次数，也不能假装拥有真实 GitHub 主页访问统计**。如果希望 README 中的访问次数随实际请求增加，必须部署可公开访问的计数后端；可以由用户自己选择托管，不必使用维护者的 Cloudflare 账户。

### 下载入口暂时无法使用？

本地源码也可以运行，但需要 Node.js 20+：

```sh
git clone https://github.com/guitar0788/workshop-Visitor-Terminal.git
cd workshop-Visitor-Terminal
npm install
npm run build
npm run build:offline
```

生成的单文件在 `dist/Workshop-Studio-Offline.html`。双击打开即可。运行时无需后端，也不会读取维护者的 Cloudflare 机密。

如果只是想参与开发，可直接 `npm run dev`，通常在 `http://localhost:5173/workshop-Visitor-Terminal/` 浏览；请勿在本地环境文件中设置云端发布凭据。开发服务器启动后才能访问，不属于无需安装的单文件版。

### 维护者的成本边界

| 行为 | 试用者的请求去向 | 维护者 Cloudflare 成本 |
| --- | --- | --- |
| 下载离线 HTML | GitHub Pages 的静态文件 | 不占用 Cloudflare Worker/D1 |
| 双击 HTML 并编辑、保存 SVG/JSON | 浏览器本地 | 无 |
| 通过本地文件更改演示次数 | 浏览器本地 | 无 |
| 在 README 嵌入静态 SVG（上传到自己的 GitHub 仓库） | GitHub 静态图片 | 不占用维护者 Worker/D1 |
| 打开维护者托管的动态 SVG 地址 | Cloudflare Worker/D1，可能经 GitHub 图片代理缓存 | 会消耗维护者配额 |
| 申请或测试维护者的在线发布服务 | Cloudflare Worker/D1 | 会消耗维护者配额 |

**已发布的旧动态 SVG 不会因为用户下载了离线编辑器而停止调用 Cloudflare。** 想进一步减少费用，可以停止公开测试新动态链接、减少自己账户的真实托管计数器使用，或在单独获得明确批准后关闭云端服务。不要未经确认就让旧 README 图片失效。

### 安全与隐私

- 单文件版是由 **关闭 OAuth 与发布功能** 的专用 Vite 编译生成，不是从线上内测版本直接复制的脚本。
- 文件中没有 GitHub OAuth Client Secret、Cloudflare API Token、D1 数据库凭据或用户会话。
- 安全策略禁止浏览器对任何网络地址发起连接，并且没有外部 CSS/JS/字体依赖。
- 静态 HTML 中的语言偏好、文件导入/导出由本机浏览器处理；是否记住语言取决于浏览器对 `file://` 的存储政策。
- 在自己的电脑打开可信来源的 HTML。仓库中的 MIT 许可证允许查看、修改、分发和自行托管代码。

## English — No installation needed

Download `Workshop-Studio-Offline.html` from the **Download offline HTML** button in [Workshop Studio](https://guitar0788.github.io/workshop-Visitor-Terminal/), then double-click the file in your file browser. Open it in an up-to-date Chrome, Edge, or Firefox browser. After the initial download, no network connection or account is needed.

You can visually edit and reorder layers, preview your SVG, change an **example** visitor count, export a static SVG, and import/export JSON design files. GitHub OAuth and Cloudflare hosting are intentionally disabled. The generated document contains embedded JS/CSS and a strict no-connect Content Security Policy.

This edition **does not record real visits**. For live counters, testers must use an independently hosted backend or an explicitly authorized cloud provider. The project owner does not need to pay for other users' offline editing.

Contributors with Node.js 20+ can run `npm install`, `npm run build`, and `npm run build:offline` to generate the same standalone HTML locally. The source code is published under the MIT license.

## Acceptance checklist / 验收要点

- Offline HTML works after disconnecting Wi-Fi.
- Templates, layer positioning, SVG preview, Chinese/English labels and JSON import/export function normally.
- DevTools Network panel shows no requests to Cloudflare, GitHub, CDNs or other origins while editing.
- GitHub OAuth login and remote publishing are visibly disabled.
- No external JavaScript or stylesheet URLs remain in the generated file.
- The normal online staging pilot is unchanged and existing dynamic SVG URLs still work.
