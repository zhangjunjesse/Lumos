# DeepSearch Phase 1 实现拆解设计文档

## 0. 文档定位

本文回答的问题是：

- `08 DeepSearch` 的 Phase 1 到底先实现什么
- 这些能力应该按什么顺序落地
- 什么时候才算真正进入“可通过 UI 验收”的状态

本文不是需求文档，也不是总体架构文档，而是 `08` 的第一阶段实现收口文档。

相关主文档：

- `08-deepsearch-requirements-design.md`
- `08-deepsearch-architecture-design.md`
- `08-deepsearch-bb-browser-integration-design.md`
- `08-deepsearch-deployment-and-local-usage-design.md`

---

## 1. Phase 1 的严格目标

Phase 1 的目标不是：

- 证明某个 adapter 能跑
- 证明某段浏览器脚本能拿到内容
- 证明聊天里能临时调起一次抓取

Phase 1 的严格目标是：

- 用户能在正式 `DeepSearch` 页面完成登录态检查
- 用户能发起 DeepSearch 任务
- 遇到登录阻塞时能恢复
- 用户能查看历史记录、详细内容和证据
- 聊天与 Workflow 能复用同一个 service，而不是另起一套实现

因此：

- **Phase 1 的完成标准是“独立模块可用”，不是“单条抓取链路跑通”**

---

## 2. Phase 1 范围

## 2.1 必做范围

- DeepSearch 正式入口页
- Site Session Manager 最小主链
- DeepSearch run 状态机
- Run / Artifact 持久化
- Browser Adapter Layer 最小原语
- `接管当前活动页 / 新建受管页` 正式页面模式
- `strict / best_effort` 正式执行语义
- 1 到 2 个高价值站点的内置 adapter
- Chat Tool Facade

## 2.2 暂不进入 Phase 1 的范围

- 通用外部 adapter 导入发布平台
- 通用社区 adapter 自动同步
- 完整 network capture UI
- 完整 DeepSearch CDP Observer 产品化
- Workflow Capability Facade
- MCP / CLI 正式对外形态
- Tier 3 站点支持

---

## 3. Phase 1 完成标准

只有同时满足以下条件，才可认为 `08 Phase 1` 达到“主链可验收”：

1. 正式 UI 可见：
   - 左侧 `扩展 -> DeepSearch`
2. 登录态主链可用：
   - 站点状态检查
   - 一键去登录
   - 登录后恢复
3. 运行主链可用：
   - 创建 run
   - 执行中 / 等待登录 / 已完成 / 部分完成 / 失败 / 已取消
4. 结果主链可用：
   - 历史记录
   - 详细内容
   - artifact / evidence 查看
5. 复用主链可用：
   - 聊天可通过高层 facade 调用同一 service

如果只完成：

- service API
- adapter runtime
- 或内部脚本验证

都不能算完成。

---

## 4. Phase 1 模块交付清单

## 4.1 数据与持久化

Phase 1 建议至少补齐以下持久化实体：

- `deepsearch_runs`
- `deepsearch_run_pages`
- `deepsearch_run_checkpoints`
- `deepsearch_artifacts`
- `deepsearch_site_states`
- `deepsearch_site_adapters`

建议职责：

- `deepsearch_runs`
  - 记录任务级状态
- `deepsearch_run_pages`
  - 记录每个页面级访问与抽取结果
- `deepsearch_run_checkpoints`
  - 记录等待登录、暂停、部分完成时的恢复位置和剩余站点
- `deepsearch_artifacts`
  - 记录正文、截图、结构化 JSON、证据摘录
- `deepsearch_site_states`
  - 记录站点登录态检查结果和最近验证时间
- `deepsearch_site_adapters`
  - 记录站点 adapter 元数据与版本

## 4.2 Run 状态机

建议至少支持以下状态：

- `pending`
- `running`
- `waiting_login`
- `paused`
- `completed`
- `partial`
- `failed`
- `cancelled`

同时支持：

- `pause`
- `resume`
- `retry`
- `cancel`

## 4.3 Site Session Manager

Phase 1 必做：

- `checkLoginState(siteId)`
- `openLoginPage(siteId)`
- `recheckLoginState(siteId)`
- `resumeBlockedRun(runId)`

站点登录态状态建议统一为：

- `未连接`
- `已连接`
- `疑似过期`
- `已失效`
- `检查失败`

## 4.4 Browser Adapter Layer

Phase 1 必做最小原语：

- `prepareRunPage(siteId, runId, pageMode)`
- `attachActivePage(runId)`
- `bindRunPage(runId, pageId, bindingType)`
- `fetchWithSession(pageId, request)`
- `captureCompactSnapshot(pageId)`
- `runAdapterFunction(pageId, adapterSource, args, runtimePolicy)`
- `saveArtifact(runId, artifact)`

这里要强调三条约束：

- 每次执行必须显式绑定 `runId + pageId`
- 允许正式接管当前活动页，但接管后必须落库为 `run page binding`
- 不允许正式主链按域名隐式选 tab

## 4.5 Site Adapter Runtime

Phase 1 建议只支持：

- `native adapter`
- 受控的 `compatible adapter`

站点范围建议优先：

- `知乎`
- `B 站`

适配范围建议先收敛：

- `知乎`
  - 搜索结果
  - 问题详情 / 回答正文
- `B 站`
  - 搜索结果
  - 视频详情页正文信息

不建议一开始就做：

- 评论全量抓取
- 登录态极不稳定的高风险内部接口
- Tier 3 内部模块注入类能力

## 4.6 Artifact-backed Result

Phase 1 必须建立一个明确边界：

- 小型状态、摘要、结构化元数据可以 inline 返回
- 长正文、截图、HTML、原始响应、证据摘录必须保存为 artifact

这意味着 `DeepSearch Service` 返回给 UI / LLM 的应当是：

- 摘要
- 状态
- artifact 引用

而不是把大结果直接塞进同步响应。

## 4.7 DeepSearch UI

Phase 1 正式页面至少需要三块：

- 顶部：任务发起与运行状态
- 左栏：站点连接与登录态
- 中栏：历史抓取记录
- 右栏：详细内容与证据

其中必须可直接验收：

- 哪个站点未登录
- 哪次任务被登录阻塞
- 哪次任务抓到了什么正文
- 失败原因是什么

## 4.8 Chat Tool Facade

聊天侧最小能力建议：

- `deepsearch.start`
- `deepsearch.get_result`
- `deepsearch.pause`
- `deepsearch.resume`
- `deepsearch.cancel`

聊天侧 Phase 1 不应直接暴露：

- 底层 browser click/fill/eval
- 原始 network capture
- 任意 adapter JS

## 4.9 Workflow Capability Facade

Workflow 侧不建议进入 Phase 1 严格必做范围。

它在当前设计中的定位是：

- 进入 Phase 2
- 在独立模块已稳定后再复用同一个 `DeepSearch Service`

届时建议只暴露一个高层 capability：

- `deepsearch`

它的输入是任务语义与约束，输出是：

- `runId`
- 状态
- 摘要
- artifact 引用

而不是把 DeepSearch 拆成多个底层 workflow step。

---

## 5. 推荐实现顺序

## 5.1 Milestone 1：Run / Artifact 基础骨架

先做：

- 数据表
- `runId` 生成
- 状态机
- checkpoint
- artifact 存储
- history / detail 基础读取

目标：

- 先把“运行和结果”骨架建立起来

如果这一层不先做，后面所有抓取都只能停留在临时结果。

## 5.2 Milestone 2：Site Session Manager

再做：

- 站点登录探针
- 登录页打开
- 登录后重检
- `waiting_login -> pending -> resume`

目标：

- 把登录态主链真正打通

## 5.3 Milestone 3：Browser Adapter 最小原语

再做：

- `pageId` 显式绑定
- `接管当前活动页`
- `fetchWithSession`
- 受控 adapter 执行
- compact snapshot 最小版本

目标：

- 让内置 adapter 可以在统一运行时里执行

## 5.4 Milestone 4：首批站点 adapter

建议先落两个站点：

- `知乎`
- `B 站`

目标：

- 用真实高价值站点验证设计，而不是只用低风险演示站点

## 5.5 Milestone 5：DeepSearch UI

在骨架和站点主链已有基础后，接正式 UI：

- 发起任务
- 选择页面模式
- 选择严格度
- 查看登录态
- 查看 history
- 查看 detail

目标：

- 进入真实 UI 可验收状态

## 5.6 Milestone 6：聊天复用与 Workflow 预留

最后接：

- Chat Tool Facade
- Workflow Capability Facade 的接口预留

目标：

- 先让聊天复用同一个 DeepSearch service
- 同时不给后续 Workflow 复用制造断层

---

## 6. 首批站点建议

## 6.1 知乎

Phase 1 建议重点做：

- 登录态探针
- 搜索结果页策略
- 问题详情页正文抽取
- 站点级失败分类

原因：

- 用户价值高
- 反爬特征明显
- 能验证共享登录态 + Tier 2 adapter 的真实价值

## 6.2 B 站

Phase 1 建议重点做：

- 登录态探针
- 搜索结果页策略
- 视频详情信息与正文性内容抽取
- 页面级证据保存

原因：

- 场景常见
- 与知乎类型不同
- 有助于验证 DeepSearch 不是只适用于问答站点

---

## 7. Phase 1 明确不做的内容

为了防止范围失控，以下内容建议明确排除：

- 通用社区 adapter 自动导入 / 更新
- 完整 network capture 正式 UI
- 通用抓包原文展示
- 请求拦截 / mock / traffic rewrite
- Tier 3 站点 runtime hack
- 独立 CLI / MCP 主入口

---

## 8. 风险与依赖

## 8.1 关键依赖

- Lumos 内置浏览器共享 session 可稳定复用
- BrowserManager / bridge 能满足受控 adapter 执行
- 数据库与 artifact 存储可承载 run 结果

## 8.2 关键风险

- 站点登录态判定不稳
- 结果 inline 返回过大导致主链脆弱
- 同域多页面导致 page 绑定混乱
- 活动页接管后与用户手动操作发生冲突
- 站点 adapter 维护成本超出预期

## 8.3 风险控制

- `runId + pageId` 显式绑定
- 活动页接管必须可见且可回溯
- artifact-backed result
- 只做少量高价值站点
- Phase 1 不碰 Tier 3

---

## 9. UI 验收清单

用户通过正式 UI 至少能完成：

1. 打开 `扩展 -> DeepSearch`
2. 看到各站点登录态
3. 点击去登录并完成登录
4. 发起一个真实 DeepSearch run
5. 选择“接管当前活动页”或“新建受管页”
6. 选择 `strict` 或 `best_effort`
7. 在记录列表看到该 run
8. 在详情里看到正文、证据或失败原因
9. 如果登录失效，看到 `等待登录`
10. 非严格任务如果部分站点失败，看到 `部分完成`
11. 登录后恢复原任务

如果这些还做不到，就不能说 Phase 1 可验收。

---

## 10. 最终结论

一句话总结：

- **DeepSearch Phase 1 应先完成“登录态主链 + run/artifact 骨架 + 正式 UI + 首批站点 adapter + 聊天复用”，再进入 Workflow 复用、通用 adapter 生态和外部调用形态。**
