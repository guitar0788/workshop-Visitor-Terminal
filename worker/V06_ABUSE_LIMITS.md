# v0.6 SVG Abuse & Cloudflare Cost Guards / SVG 防刷与额度保护

**Release status:** single-owner OAuth staging pilot only. Public-account rollout remains **NO-GO**.

## 中文

### 现有机制与新保护

原版 v0.5 以 **HMAC(密钥, 计数器 ID + 来源 IP)** 为匿名指纹，五分钟内同一来源只增加一次访问记录。此功能**不是请求速率限制**：重复打开相同图片仍可能访问 Worker/D1。

v0.6 增加两级独立保护：

1. **Cloudflare Worker 原生速率限制**（仅明确启用的 staging OAuth Pilot）：同一 Cloudflare 机房内每个 SVG 计数器约 **60 次请求/分钟**，该机房下所有 SVG 合计约 **120 次请求/分钟**。GET 和 HEAD 均计入；超过时返回 HTTP `429`，`Retry-After: 60`，不再执行图片的 D1 查询。这项限制不是严格精确的全球限制，不同机房分别计算，短时可能超出阈值。
2. **D1 全球 UTC 日新增记录上限**：数据库迁移 `0004_visit_budget.sql` 为所有计数器**合计**设置 **20,000 条新去重访问记录/UTC 日** 的原子写入上限；任何 Cloudflare 机房都不能通过并发写请求越过同一 SQLite 触发器的上限。达到上限后，公开 SVG **仍返回 200 正常显示**，但当天不再新增计数；第二个 UTC 日自动有新的上限。已有访问历史不会清零、回滚或覆盖。原始 IP 不会被存储。
   
为了减少对免费 D1 行写入额度的占用，每条成功新增的访问收据同时更新总访问量、每日预算记录，约对应三行写入。以每天 20,000 条新收据为限，约占 60,000 行写入额度，留出余量给其他操作。具体计费依据 Cloudflare 的实际统计。**它不能保证 Cloudflare 账户费用绝对不会增长**：Worker 请求和 D1 读取仍会计量，其他同账户应用的消费也不受此功能限制。

### 安全的监控入口

`GET /v1/admin/usage` 只接受原有 `ADMIN_TOKEN`（以 `Authorization: Bearer` 传入），返回当天 UTC 日期、已接纳的收据数量、20,000 上限以及剩余额度；不返回具体访客信息、原始 IP 或账户令牌。

GitHub Actions 的自动和手动 OAuth Pilot 在完成远端迁移、部署与 OAuth 安全检查后，通过**只读**请求验证此管理接口。日志只输出预算整数，不打印 ADMIN_TOKEN。

### 已知限制与下一阶段

- 速率限制按 Cloudflare 机房近似生效，可能误拦截高流量 README 的正常请求，短时间内用户可见 429。此为**仅单账户内测使用的保守配置**，正式多用户开放前必须根据真实流量、Cloudflare 控制台的 Worker 请求量与 D1 行指标评估阈值。
- 全球预算只硬限制 `request_windows` 新记录的数量，而不是 Worker 调用数、所有 D1 读取数或 Cloudflare 账户账单。
- GitHub 图片代理和缓存会降低实际到达 Worker 的请求数；访问统计不等于独立人类访客或 GitHub 个人主页真实浏览人数。
- 如果速率限制绑定丢失但开关为 `true`，公开 SVG 返回 503 而不会继续无限制访问 D1。普通本地或旧版部署默认不启用该绑定。
- 仍需要 Cloudflare Dashboard / WAF 规则、用量报警、额度监控和应急停机策略，才能考虑多用户公开运营。**不要移除 PHPilot 单账户 ID 限制。**

### 验收

- PR 必须先通过完整 `Verify`；本地 Wrangler D1 测试覆盖预算耗尽仍正常显示、隔日预算恢复、重启后历史计数持久化；模拟速率绑定测试覆盖 429、不读 D1、请求方法限制与未配置绑定失败关闭。
- 只有已验证 `main` 代码合并后，`OAuth Pilot Auto` 才能自动部署到原来的 staging Worker 与 Pages。
- D1 只新增表和触发器；迁移会以现有 `request_windows` 数据初始化当日预算，**不会删除任何现有计数器**，也不需要新的 Cloudflare 机密。
- 部署完成后应读取自动工作流的 `Verify staging global visit budget` 步骤，核实只读预算状态；不要用刷真实 SVG 的方式人为触发额度耗尽。
- 不得修改 GitHub 个人主页 README 或旧 Komarev 计数器。

## English

Two independent guards protect the **owner-only staging pilot**. Cloudflare's native Worker rate limiting caps each SVG at approximately **60 requests/minute per Cloudflare location** and the whole staging Worker at approximately **120 SVG requests/minute per location**. Over-limit requests return `429` and `Retry-After: 60` **before D1 access**. These are approximate per-location limits, not global guarantees.

An additive D1 migration enforces an **atomic worldwide 20,000 new qualified visit receipts per UTC day** across all counters. Additional receipts are ignored while SVG remains readable; existing totals survive and the budget refreshes when the UTC day changes. The budget includes existing receipts present when the migration runs, preventing deployment resets. A read-only `GET /v1/admin/usage` endpoint requires the administrator bearer token; CI checks its policy after a successful staging deploy.

This hard cap bounds accepted visit *writes*, **not** all Worker invocations, D1 reads, WAF traffic, unrelated account workloads or Cloudflare billing. Follow Cloudflare's rate-limit and D1 pricing documentation and set account-level alerts before any public signup. Do not confuse upstream requests with accurate GitHub profile views.

Official sources:
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/d1/platform/pricing/
