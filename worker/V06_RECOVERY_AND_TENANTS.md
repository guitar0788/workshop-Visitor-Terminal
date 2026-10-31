# v0.6 — D1 recovery readiness and multi-account isolation / 恢复与账户隔离

**Status:** local recovery drill implemented; owner-only staging pilot remains active. **No live database restore, remote export, new Cloudflare credentials, or public multi-account registration has been performed.**

## 中文 — 恢复策略

### 已实现的隔离恢复演练

`Verify` CI 在原有 `worker/local-smoke.mjs` 创建了仅用于测试的完整 D1 数据库后运行 `node worker/backup-restore-drill.mjs`：

1. 先核对 `wrangler.toml` 必须使用原版 CI 的 `workshop-visitor-terminal` 数据库名称及 `00000000-0000-0000-0000-000000000000` 假 UUID；如遇 staging 名称、真实 UUID 或开启发布的配置则拒绝执行。
2. 使用 `wrangler d1 export --local` 将**临时本地**数据库导出至操作系统临时目录，不接受 `--remote`。
3. 使用 `wrangler d1 execute --local --persist-to` 导入至**另一个隔离的本地持久化目录**，不会更改原库。
4. 检查所有计数器、访问次数、用户数字 ID、SVG 设计 JSON、访客去重窗口、每日写入预算、OAuth 状态/票据/会话表及 SQLite 结构与触发器。对比完整内容哈希，并执行 SQLite `PRAGMA integrity_check`。
5. 仅修改恢复出来的测试副本，确认原始测试库数据没有变化；最后删除所有临时 SQL 导出和恢复库。

CI 不上传任何 SQL 备份到 GitHub Artifact、Issue、PR、公开仓库或外部服务，日志不输出数据库行和令牌。此演练证明**本地导出与隔离导入在当前 schema 下可工作**，并不等于已经完成真实 Cloudflare staging 数据的恢复验收。

### 真实 staging 的可用恢复能力

Cloudflare D1 提供内建 **Time Travel** 时间点恢复。官方限制：Workers 免费套餐一般最多回溯 **7 天**，付费套餐最多 **30 天**；实际能力取决于数据库存储后端，需先用 `wrangler d1 info` 检查 `version: production`。请勿根据仓库的公开状态推断 Cloudflare 账户套餐。

**重要：`wrangler d1 time-travel restore` 会原地覆盖数据库！** 在任何真实恢复前必须取得仓库所有者的明确、针对性批准；包含指定时间点、备份及核验结果、停机方案，以及恢复后 OAuth 会话与发布链接的影响。不允许在普通 PR、自动部署或健康检查中调用该命令。恢复操作需要专用、人工批准的独立流程，不纳入普通 CI。

Cloudflare 官方命令及文档：
- <https://developers.cloudflare.com/d1/reference/time-travel/>
- <https://developers.cloudflare.com/d1/platform/limits/>
- <https://developers.cloudflare.com/d1/wrangler-commands/>
- <https://developers.cloudflare.com/d1/best-practices/import-export-data/>

### 为什么不把完整数据库自动上传 GitHub Actions

- D1 包含 `publish_sessions`、`publish_login_tickets`、`publish_oauth_states` 等短期安全敏感记录。虽然服务端只保存哈希，但完整 SQL 仍属于私有数据库资产。
- 已删除计数器的历史、访问指纹和其他表都可能出现在旧快照中。保留期限、加密密钥、访问审批和删除政策尚未确定。
- Wrangler 的远程 D1 Export 可能阻塞其他查询。将远端完整导出放入每次发布流程会影响在线计数；且不能把 SQL 作为公开 Artifact 或 PR 附件。
- 后续可独立实现**加密离线备份或受保护的 R2 备份**，但必须先验证 Cloudflare 账户用量、备份访问权限、加密管理、到期自动删除与恢复演练。当前阶段不增加新 Cloudflare 服务或付费资源。

### 真实故障时的安全次序（现仅作为操作规范）

1. 停止新的写入与自动发布，记录事故开始时间；禁止使用普通重部署冒充数据恢复。
2. 核对目标 D1 的名称、UUID、存储后端版本及恢复窗口；确定故障发生前的具体 UTC 时间点。
3. 保存安全的事前只读清单和当前状态，确认历史访问量、用户 ID、SVG 地址与受影响计数器数量。
4. 将候选恢复镜像导入**完全独立的临时数据库**并验证 schema、所有权、计数及 SVG；若所选 D1 Time Travel 功能不能克隆数据库，则必须采用不同的经批准验证方法，不能假装已有克隆。
5. 只有经所有者明确授权，才执行可能覆盖真实数据库的恢复；完成后复核并记录影响，更新部署状态和审计报告。

## 账户隔离 — 不开放其他用户

新增的自动化模拟两个**由 GitHub 身份接口分别认证**的数字用户 ID，即使它们使用同样的 GitHub 登录名，也必须相互隔离：

- A 不能查询、编辑、删除 B 的私人计数器，B 亦不能访问 A 的私人计数器管理接口。
- 每个账户的最多三个计数器配额独立统计，不能通过相同昵称或切换客户端登录名共享配额。
- 切换服务器端允许的数字 ID 时，先前账户仍未过期的旧会话必须立即失去权限。
- 所有权根据 `owner_user_id`（可信数字 ID）而不是 `owner` 字符串；原有管理员历史计数器仍为 `NULL`，不会被自动认领。
- 公开 SVG 仍是**公开只读资源**，不是私人信息；不应把公开 SVG 可访问误判为跨账户泄露。

这只是**隔离架构的回归测试**。正式公共服务仍必须解决用户身份加入/退出、额度和费用、公平限速、数据删除与隐私、云端备份和恢复、滥用举报及双用户真实浏览器验收。当前 Worker 的 `PILOT_GITHUB_USER_ID` 单账户门禁继续保留。

## English summary

The new local recovery drill validates a strictly disposable D1 SQL export/import round trip under Wrangler, hashes and compares counters, numeric ownership, visit receipts, daily budgets, OAuth tables and schema/triggers, runs SQLite integrity checks, mutates only the isolated copy, and securely removes local temporary SQL afterwards. It never exports or restores live D1.

Cloudflare D1 Time Travel is a separate, potentially **destructive in-place** recovery operation (7 days Free / 30 days Paid on supported storage). It is **not authorized** in CI. Secure encrypted retention and a real, isolated cloud recovery drill remain public-launch blockers.

Multi-tenant tests model two separately GitHub-verified numeric accounts using an allowlist switch; they test list/create/update/delete/quota isolation without enabling other accounts in the live staging Worker.
