# GitHub OAuth 试运行 / Owner-only GitHub OAuth Pilot

## 简体中文

当前七项 GitHub 环境机密已由仓库所有者配置。

GitHub 环境机密中的 OAuth 名称必须使用 **`CLIENT_ID`** 和 **`CLIENT_SECRET`**（GitHub 不允许创建 `GITHUB_` 前缀的自定义机密）。部署工作流会把这两项映射到 Worker 内部变量 `GITHUB_CLIENT_ID` 与 `GITHUB_CLIENT_SECRET`，无需重新创建密钥。此试运行专用于 Cloudflare staging；**已通过 CI 验收的 main 代码变更可自动部署**。不会修改 GitHub 个人主页或旧访问量。

### 请先确认 GitHub OAuth 应用设置

- 个人设置 → 开发者设置 → OAuth 应用 → Workshop Visitor Terminal Staging
- 主页 URL：https://guitar0788.github.io/workshop-Visitor-Terminal/
- 授权回调 URL：https://workshop-visitor-terminal-staging.fangcui2007.workers.dev/v1/auth/github/callback

### 自动部署（v0.6 起）

1. 开发人员提交 PR；GitHub Actions 的 **Verify** 必须全部通过才能合并。
2. 合并到 `main` 后，新的 [OAuth Pilot Auto (verified main only)](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/workflows/oauth-pilot-auto.yml) 等待该提交的 **Verify** 成功。**不需要填写确认词或手动点击运行。**
3. 自动安全关卡要求：来源为本仓库 `main` 推送、验证状态成功、已验证提交仍为最新 `main`、`.github/pages-deploy-channel.txt` 仍为 `pilot`，而且提交包含 Worker、网页代码或相关构建文件修改。只有全满足才会读取 `cloudflare-staging` 的机密并启动部署。
4. 自动部署沿用原有的 D1 身份保护、增量迁移、Cloudflare Worker 健康检查、OAuth 拒绝未授权来源等验证；只有 Worker 成功，才发布 GitHub Pages 内测界面。
5. 仅修改文档、测试文件或 PR 评论不会启动 Cloudflare 部署。`Verify` 失败、来自 PR 或 fork、旧版提交、非内测发布通道都会拒绝自动部署。

**可暂停自动部署：** 在审查过的 PR 中将 `.github/pages-deploy-channel.txt` 改为 `preview`。这样下一次 `main` 验收后，内测自动部署将停用，普通 Pages 预览自动发布恢复。切换通道不会自动关闭已部署的 Worker；若需完整回退，再依照本文「退出试运行」步骤操作。

### 手动运行（仅用于主动重试或恢复）

1. 打开 [OAuth Pilot (manual — owner only)](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/workflows/oauth-pilot.yml)。
2. 点击「运行工作流」，分支选择 main。
3. confirm_scope 填写 OAUTH-PILOT-ONLY。
4. staging_origin 填写 https://workshop-visitor-terminal-staging.fangcui2007.workers.dev （不要末尾斜杠）。
5. 点击运行。检查 Worker 与 Pages 两项任务都成功。

工作流依次验证七项环境机密、D1 测试数据库名称及 UUID、数据库迁移、Cloudflare OAuth 安全预检，然后才会发布带登录入口的 GitHub Pages 编辑器。

**只有 GitHub 验证的数字用户 ID 124379632 才能获得试运行的发布权限。** 这项限制由 Worker 校验，不能只靠前端界面，也不能根据用户名猜测身份。

### 完成后在浏览器中测试

1. 打开 [Workshop Studio](https://guitar0788.github.io/workshop-Visitor-Terminal/)，进入「导出」→「发布到 GitHub」。
2. 检查显示「受限内测」，点击「使用 GitHub 登录」，在 GitHub 确认 OAuth 应用名称和授权。
3. 返回 Studio 后，先用测试模板发布一个测试计数器，复制 README Markdown，确认 SVG 图片可打开。
4. 载入自己的计数器，调整设计并保存。随后尝试无痕访问，确认未登录无法编辑。
5. 再在手机端测试登录、导出、复制。不要把测试图片覆盖到现有个人主页计数器。

### 内测期间的 GitHub Pages 发布保护

仓库当前使用版本控制文件 `.github/pages-deploy-channel.txt`，内容为 `pilot`。因此，在 `main` 分支合并 PR、触发普通的 **Publish Workshop Studio** 自动工作流时，它会运行安全检查，但**不会覆盖已经成功发布的 OAuth 内测网页**。符合条件的代码改动改由专门的 **OAuth Pilot Auto** 工作流部署内测版本。

需要主动回到普通预览版时，依旧可以手动运行 **Publish Workshop Studio**（选择 `main`）。这属于明确的退出内测操作。之后如需重新启用内测，再手动运行 OAuth Pilot。不要通过清空 Cloudflare 数据库来处理网页版本。

正式结束内测后，可在经过审查的单独 PR 中将 `.github/pages-deploy-channel.txt` 的内容改为 `preview`，恢复常规的 `main` 推送自动发布。

### 随时退出试运行

1. 在 [Publish Workshop Studio](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/workflows/publish-pages.yml) 手动运行 main 的默认发布，关闭网页登录入口。
2. 在 [Cloudflare Staging (manual)](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/workflows/cloudflare-staging.yml) 使用 STAGING-ONLY、相同的 staging_origin 重新部署，关闭 Worker OAuth 发布开关。
3. 这不会清空已有 D1 测试数据。不要为回退而删除数据库或公开密钥。

## English

This is an owner-only GitHub OAuth staging pilot. Beginning with v0.6, successful **Verify** runs from current `main` runtime changes automatically deploy through `oauth-pilot-auto.yml`; the manual OAuth workflow remains available for explicit retries. It never changes the GitHub profile README or existing visitor counter.

Verify GitHub OAuth App homepage and callback URL above, then run [OAuth Pilot workflow](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/workflows/oauth-pilot.yml) on main with confirm_scope = OAUTH-PILOT-ONLY and the exact staging_origin above.

Only GitHub-verified numeric user ID 124379632 can receive a session. The workflow tests security gates before deploying the Worker and enabling the Pages beta interface. Other accounts are not authorized to publish.

The tracked `.github/pages-deploy-channel.txt` is currently `pilot`: ordinary `main` pushes **skip the default-preview Pages deployment** and, after successful `Verify`, the separate verified-main OAuth automation publishes the updated pilot instead of hiding login. A manual Publish Workshop Studio run still deliberately deploys the preview as a rollback. Switch the tracked channel to `preview` in a reviewed PR after the pilot ends to restore automatic preview deployments.

To roll back, manually run the default [GitHub Pages workflow](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/workflows/publish-pages.yml) and then the default [Cloudflare staging workflow](https://github.com/guitar0788/workshop-Visitor-Terminal/actions/workflows/cloudflare-staging.yml). Both normally disable the OAuth pilot, retaining D1 data.

Never share OAuth client secrets, Cloudflare API tokens, or Worker admin keys in chat or issues. The pilot is not an audited general-public hosting service.
