# 能力模块审计报告 — 微信助手 / 闲鱼助手 / X 平台

> 范围：`src/lib/wechat-assistant/` + `src/lib/im/providers/wechat/` + WeChat API/UI；`src/lib/goofish/` + `src/lib/app/goofish-*` + Goofish API/UI；`src/lib/x-platform/` + X API/UI；及对应 MCP 服务器。
>
> 方法：3 个 Explore subagent 并行扫描，按 P0（功能/安全严重）→ P1（影响一致性）→ P2（性能/可用性）→ P3（代码质量）分级。
>
> **同时出现在 3 个模块中的共性问题**单列「跨模块隐患」一节，先看那一节再看分模块清单。

---

## 1. 跨模块隐患（同一类问题在多个模块复现，性价比最高）

| # | 主题 | 涉及模块 | 表现 | 一次性修方案 |
|---|------|----------|------|--------------|
| C1 | **Cookies / 凭证明文存储** | Goofish (`src/lib/goofish/accounts.ts:123-124`) / X (`src/lib/x-platform/cookies-store.ts:60`) | macOS/Linux 用 `mode: 0o600` 保护，Windows 上 mode 参数被忽略，文件继承父目录权限，同机其他用户可读 | 抽公用 `secureFileWrite()` helper：Linux/macOS 0o600；Windows 走 keytar/DPAPI；统一被这 2 个模块复用 |
| C2 | **同账号并发竞态** | WeChat sync-engine + Goofish auto-reply + X scraper | 同一资源（同步进度 / 自动回复频控 / scraper 单例）多请求并发时，第二个请求看不到第一个未完成的状态 → 可能漏写、双发或失效缓存复用 | 引入 `asyncLockByKey(key, fn)` helper（基于 Map<key, Promise>），3 个模块 hot-path 加锁 |
| C3 | **轮询 API 过于频繁、无去重** | WeChat overview (POST 每次重算) / X auth-status (8s/次走 X GraphQL 远程验证) | 每次 GET 都重算或访问外部，不缓存；UI 即使状态没变也 setState 导致重渲 | 加 in-memory TTL cache（5 分钟）+ 客户端 `JSON.stringify(prev) === next` 去重 |
| C4 | **错误传播不分类** | WeChat sync 错误 / Goofish bulk sync auth 失败 / X timeline 异步生成器 | "auth 过期" 和 "网络错误" 走同一条返回路径，前端无法区分应该让用户重新登录还是稍后再试 | 服务端统一用 error code（`auth_expired` / `network` / `provider_5xx`），前端按 code 分支 |

修这 4 类共性问题，可以一次性消除每个模块单算的 4-6 个独立 P1。

---

## 2. WeChat 助手（10 项）

### P0 — 真实 bug

1. **`getLatestAIAnalysis()` 空引用** — `src/lib/wechat-assistant/ai-runner.ts:132-136`：`getLatestRun()` 返回 `null` 时直接调用 `listEventsByRun(run.id, ...)`，run 为 null 还访问 `.id` → 抛 TypeError。**修**：先 `if (!run) return null`。
2. **Sync 进行中状态竞态** — `src/lib/wechat-assistant/sync-engine.ts:72-80`：多个 POST /sync 同时到达时，第二个请求拿到的是第一个未完成 Promise，但 abort signal 可能已是另一个请求的，进度流串了。**修**：返回前检查 abort signal、为每次调用单独 SSE channel。
3. **AutomationScheduleState 映射失败后数据不一致** — `src/lib/wechat-assistant/automations.ts:132-144`：`getScheduledWorkflow()` 返回 null 时只设 `scheduleError` 不清 `scheduleId`，后续 `triggerWeChatAutomation()` 仍尝试用不存在的 scheduleId。**修**：同时清 `scheduleId` 或 trigger 前再校验。
4. **Settings deepMerge 数组直接赋值污染默认值** — `src/lib/wechat-assistant/settings-merge.ts:152-183`：UI 改 `includedPersonIds` 后污染原始 `DEFAULTS` 引用。**修**：数组字段显式 `[...arr]` 浅拷。
5. **Daily Summary 写文件无 fallback** — `src/lib/wechat-assistant/workflow-handlers.ts:88-89`：`ctx.outputDir` 不存在或无权限时静默失败。**修**：先 mkdir + 捕获 writeFile 错误返回 `failed` status。

### P1 — 重大问题

6. **N+1 查询：Automations 列表加载** — `automations.ts:26-30`：每条都执行 2 次 DB 查询，5 条自动化 = 10 次 query。**修**：批量加载 + 应用层映射。
7. **Snapshot 过滤后 selectedReadableMessages 不更新** — `ai-runner.ts:90-111`：AI 分析时拿到的 messages 数与 UI 报的"已读取 X 条"不一致。**修**：过滤后 `selectedReadableMessages = messages.length`。
8. **Topic 摘要卡死无超时** — `mirror-store.ts:677-696`：`hasTopicDailySummary()` 'running' 状态永不清理，UI 卡在"生成中"。**修**：4h 后强制转 `'skipped'`。
9. **`getMessageContext` radius 无上界** — `mirror-store.ts:899-952`：用户传 999 会一次拉数千消息阻塞。**修**：`Math.min(Math.max(radius, 1), 30)`。
10. **Settings 校验错误信息泄敏感** — `src/app/api/apps/builtin/wechat/settings/route.ts:30-34`：`SettingsValidationError.issues` 直接回客户端，可能含 prompt 路径。**修**：返回通用错误码，详情仅日志。

### P2 / P3 简表
- Overview 计算未缓存 → ETag 或 5min 内存缓存
- Topic 提取大消息 `JSON.stringify` 阻塞主线程 → 分批保存
- Search LIKE 转义不完整（虽已用 `?` 参数化，仍要严格 escape）
- Sync 缓冲无限增长（500 条阈值后失败重试无上限）
- Sync 路由 abort 时事件监听器闭包泄漏

---

## 3. 闲鱼助手（14 项）

### P0 — 严重缺陷

1. **自动回复频控同账号并发欺骗** — `src/lib/app/goofish-auto-reply-matcher.ts:196-218`：`checkThrottle()` 只查最近 64 条且未 orderBy，并发请求看不到对方刚写入的记录 → 绕过 `PER_ACCOUNT_LIMIT = 10`。**修**：加 `orderBy: { field: 'updated_at', direction: 'desc' }` 或全窗口计数。
2. **提醒规则重复触发** — `src/lib/app/goofish-reminder-engine.ts:78-86`：`isInCooldown` 返回 false 不代表本轮没触发；同 tick 内并发扫描会重发同一条提醒。**修**：触发后原子写 `last_triggered_at` 或乐观锁。
3. **QR 登录账号切换误判** — `src/lib/goofish/auth-qr.ts:143`：用户主动切到新账号时，`ignoredUnbs` 检查无法区分"还是旧"和"切到新"，UX 误导。**修**：监听 unb 变化即返回成功。

### P1 — 重要缺陷

4. **并发同步 FTS 索引重复写** — `src/lib/goofish/db.ts:110-126` + `sync.ts:149-159`：依赖 `.changes > 0` 判 isNew，并发时计数串了。**修**：改用 `INSERT OR IGNORE` 或显式 SELECT 查重。
5. **多账号同步 auth 过期不及时返回 401** — `src/app/api/goofish/sync/route.ts:40-65`：单账号路径会返回 401，全账号路径有部分账号过期时只返 207，前端无法统一拦截"重新登录"。**修**：任何账号 auth 过期立即返 401。
6. **同步窗口过滤错字段** — `src/lib/goofish/scheduler.ts:80`：用会话 `ts` 而非消息 `created_at` 过滤，老会话里的新消息会漏推。**修**：改为消息 created_at 过滤。

### P2 — 中等

7. **白名单正则错误静默 swallow** — `auto-reply-matcher.ts:184-189`：用户输错正则规则永不触发也不报。**修**：UI 加载时预校验 + 失败统计。
8. **提醒扫描超时丢部分结果状态** — `reminder-engine.ts:55-97`：超时时已 trigger 的事件 + failure_reason 都返，前端无法区分部分成功。**修**：加 `partial_timeout` 状态。
9. **消息富化并发无上限** — `src/lib/goofish/messages.ts:63-70`：`skeletons.length` 未 clamp，200 个 session 时 200 个并发任务排队。**修**：上限 20 + 动态调整。
10. **Cookie Windows 文件权限弱**（同 C1）— `src/lib/goofish/accounts.ts:123-124`。

### P3 — 优化

11. N+1 inbox 查询（每会话 1 次 SQL） → CTE 聚合
12. 关键词匹配大小写策略不一致（keyword vs regex 行为不同）
13. 同账号并发 login 覆盖（无文件锁）
14. `parseTime` 可能丢毫秒导致冷却边界偏 1 秒

---

## 4. X (Twitter) 平台（14 项）

### P0 — 严重缺陷

1. **DeepSearch 同步非幂等** — `src/lib/x-platform/auth.ts:183-217`：`getAuthStatus` 8s/次轮询，每次都 `void reconcileDeepSearchIfNeeded(...)`，同 cookie 可能被并发同步多次。**修**：Promise 缓存或显式 API 触发。
2. **scraper 单例错误路径无重置** — `src/lib/x-platform/scraper.ts:44-57`：检测到 cookie 失效抛 `XAuthExpiredError` 时已修改全局 `scraper / scraperCookieFingerprint`，重新登录后旧失效实例可能被复用。**修**：throw 前 try-finally 重置。
3. **删除文件残留引用** — `src/lib/deepsearch/source-metadata.ts:170` 注释指向已删的 `graphql-queries.ts`。**修**：删注释或指向新 scraper。

### P1 — 功能风险

4. **登录无容错挂起** — `auth.ts:59-83`：bridge 不可用时 finally 关页面失败也吞，maxDuration 600s 客户端死等。**修**：bridge 不健康立即抛、关闭异常显式 catch+log。
5. **Cookie 过期感知不及时** — `auth.ts:219-253`：只检查 `hasRequiredCookies`，不看 `savedAt`；用户 90 天没用、X 撤销 token 时，调 search/timeline 才报 auth_expired。**修**：年龄超 90 天主动返 loggedIn=false。
6. **Timeline/Search 异步生成器异常未走 isXAuthExpiredError** — `search.ts:21` + `timeline.ts:19`：CSRF 失效抛 500 而非 401。**修**：catch 内统一过滤。

### P2 — 安全 / UX

7. **Cookie 明文 + Windows 权限弱**（同 C1）— `cookies-store.ts:60`。
8. **Logout 不重置 `deepSearchReconciled`** — `auth.ts:255-271`：换账号登录后旧账号的 cookie 可能仍记在 DeepSearch 里。**修**：logout 中加 `deepSearchReconciled = false`。
9. **scraper 并发初始化无锁**（同 C2）— `scraper.ts:44-57`。

### P3 — 性能 / 质量

10. 登录超时硬编码（POLL_MS=8000、timeoutSecs=300、固定 2s sleep）→ 配置化
11. `getAuthStatus({ refreshFromGraphQL: true })` 每 8s 走 X GraphQL → 30s 缓存
12. MCP `fetchJson` 吞 fetch 异常，UI 只看到 HTTP 500 没原因
13. `XSearchSection` 直接渲 50 项 → 虚拟列表
14. `useXAuth` 轮询无去重，每次 setState 触发重渲

---

## 5. 推荐修复顺序

1. **第一周**：解决跨模块 C1（凭证存储抽公用 helper）+ C2（asyncLock）— 一次修掉 6-8 项独立缺陷
2. **第二周**：每模块各自的 P0（WeChat 5 / Goofish 3 / X 3 = 11 项）
3. **第三周**：每模块的 P1（WeChat 5 / Goofish 3 / X 3 = 11 项）+ C3 缓存 + C4 错误码统一
4. **后续节奏**：P2/P3 按业务优先级排，能合并到日常迭代

---

## 6. 没在这次审计范围内但值得跟进

- **WeChat MCP**（resources/mcp-servers/wechat-export/macos/server.py）— 未深入扫，建议下一轮针对 Python MCP 做安全审计（subprocess shell 注入 / 路径遍历 / 解密密钥泄漏）
- **Goofish MCP**（goofish + goofish-search 两个 stdio 进程）— 同上
- **X MCP**（x_mcp.mjs）— 上面 P3 #12 涉及 fetchJson；其他工具调用边界未深入
- **测试覆盖率**：3 个模块的单测多围绕 helper / matcher，业务流程（sync 全链路 / 提醒 / 自动回复全链路）的端到端测试缺口大
