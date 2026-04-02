# DeepSearch 工程落地拆解设计文档

## 0. 文档定位

本文回答的问题是：

- `08 DeepSearch` 在当前仓库里应该落到哪些真实目录和文件
- Phase 1 应该先改哪些模块，避免“设计一套、代码又落另一套”
- 现有浏览器、扩展页、数据库、API 和 Workflow 代码应如何被复用

本文不是需求文档，也不是 UI 文档，而是 `08` 面向真实仓库结构的工程落地拆解文档。

相关文档：

- `08-deepsearch-requirements-design.md`
- `08-deepsearch-architecture-design.md`
- `08-deepsearch-ui-and-interaction-design.md`
- `08-deepsearch-data-and-api-design.md`
- `08-deepsearch-phase-1-implementation-design.md`

---

## 1. 工程结论

结合当前仓库结构，`08 DeepSearch` 的 Phase 1 建议按以下工程边界落地：

1. 产品入口不新开一级导航
   - 继续复用现有 [src/app/extensions/page.tsx](/Users/zhangjun/私藏/lumos/src/app/extensions/page.tsx)
   - 在 `扩展` 页里新增 `deepsearch` tab
2. 正式 UI 不塞回 Browser 页
   - Browser 仍是用户手动浏览空间
   - DeepSearch 是 `扩展` 页中的独立业务面板
3. 浏览器执行不新造第二条主链
   - 继续复用现有 browser bridge
   - 继续复用 [electron/browser/browser-manager.ts](/Users/zhangjun/私藏/lumos/electron/browser/browser-manager.ts) 和 [electron/browser/bridge-server.ts](/Users/zhangjun/私藏/lumos/electron/browser/bridge-server.ts)
4. 服务层不直接写在 Workflow 命名空间下
   - 新建 `src/lib/deepsearch/*`
   - Workflow 只在 Phase 2 复用该服务
5. 数据表不应散落
   - 表结构迁移统一进入 [src/lib/db/migrations-lumos.ts](/Users/zhangjun/私藏/lumos/src/lib/db/migrations-lumos.ts)
   - 仓储操作集中在新增的 `src/lib/db/deepsearch.ts`

一句话收敛：

- **Phase 1 应以“扩展页 tab + 深搜服务目录 + DeepSearch 专属 DB 表 + 复用 browser bridge”这四个真实落点推进，而不是单独起一个新应用壳。**

---

## 2. 当前仓库里的可复用基础

## 2.1 产品入口与导航

当前已存在：

- 左侧导航到 [src/components/layout/sidebar.tsx](/Users/zhangjun/私藏/lumos/src/components/layout/sidebar.tsx)
- `扩展` 页路由 [src/app/extensions/page.tsx](/Users/zhangjun/私藏/lumos/src/app/extensions/page.tsx)

这意味着：

- DeepSearch 的正式入口应直接复用 `扩展` 页 tab 体系
- Phase 1 不建议新增 `/deepsearch` 顶级 route

## 2.2 浏览器运行时

当前已存在：

- 浏览器主控 [electron/browser/browser-manager.ts](/Users/zhangjun/私藏/lumos/electron/browser/browser-manager.ts)
- CDP 管理 [electron/browser/cdp-manager.ts](/Users/zhangjun/私藏/lumos/electron/browser/cdp-manager.ts)
- bridge 服务 [electron/browser/bridge-server.ts](/Users/zhangjun/私藏/lumos/electron/browser/bridge-server.ts)
- Electron IPC [electron/ipc/browser-handlers.ts](/Users/zhangjun/私藏/lumos/electron/ipc/browser-handlers.ts)
- 浏览器类型 [src/types/browser.ts](/Users/zhangjun/私藏/lumos/src/types/browser.ts)
- 正式 Browser 页 [src/app/browser/page.tsx](/Users/zhangjun/私藏/lumos/src/app/browser/page.tsx)
- Browser 组件 [src/components/browser/Browser.tsx](/Users/zhangjun/私藏/lumos/src/components/browser/Browser.tsx)

尤其是 bridge 已经有：

- `GET /v1/pages`
- `POST /v1/pages/new`
- `POST /v1/pages/select`
- `POST /v1/pages/navigate`
- `POST /v1/pages/snapshot`
- `POST /v1/pages/click`
- `POST /v1/pages/fill`
- `POST /v1/pages/evaluate`
- `POST /v1/pages/screenshot`

这意味着：

- DeepSearch 不需要再重新定义“列出页面、获取活动页、创建页、导航、截图”这类基础原语
- Phase 1 只需要在现有 bridge 上补 DeepSearch 专属端点

## 2.3 服务侧桥接能力

当前已存在：

- [src/lib/workflow/browser-bridge-client.ts](/Users/zhangjun/私藏/lumos/src/lib/workflow/browser-bridge-client.ts)

当前问题：

- 这个 client 现在挂在 `workflow` 命名空间下
- DeepSearch 再直接复用会造成命名和模块边界都很别扭

建议收敛：

- 把它抽成通用 browser runtime client
- 新位置建议：
  - `src/lib/browser-runtime/bridge-client.ts`

然后让：

- Workflow
- DeepSearch

共用这套 client。

## 2.4 数据与迁移基础

当前已存在：

- DB 初始化 [src/lib/db/schema.ts](/Users/zhangjun/私藏/lumos/src/lib/db/schema.ts)
- Lumos 扩展迁移 [src/lib/db/migrations-lumos.ts](/Users/zhangjun/私藏/lumos/src/lib/db/migrations-lumos.ts)
- 任务库操作 [src/lib/db/tasks.ts](/Users/zhangjun/私藏/lumos/src/lib/db/tasks.ts)

这意味着：

- DeepSearch 表应进入 `migrations-lumos.ts`
- DeepSearch 仓储风格应比照 `tasks.ts` 独立成库，而不是把深搜 SQL 混进 tasks/workflow 文件

## 2.5 API 路由风格

当前已存在：

- [src/app/api/task-management/tasks/route.ts](/Users/zhangjun/私藏/lumos/src/app/api/task-management/tasks/route.ts)
- [src/app/api/workflow/agents/route.ts](/Users/zhangjun/私藏/lumos/src/app/api/workflow/agents/route.ts)

当前风格是：

- `app/api/.../route.ts`
- 轻 Next route + `src/lib/*` 业务实现

DeepSearch 应遵守同样模式。

---

## 3. 推荐目录落点

## 3.1 Renderer / UI

建议新增：

- `src/components/deepsearch/deepsearch-panel.tsx`
- `src/components/deepsearch/deepsearch-run-composer.tsx`
- `src/components/deepsearch/deepsearch-site-connection-list.tsx`
- `src/components/deepsearch/deepsearch-run-history-list.tsx`
- `src/components/deepsearch/deepsearch-run-detail-panel.tsx`
- `src/components/deepsearch/deepsearch-page-binding-preview.tsx`
- `src/components/deepsearch/deepsearch-artifact-viewer.tsx`

建议改动：

- [src/app/extensions/page.tsx](/Users/zhangjun/私藏/lumos/src/app/extensions/page.tsx)
  - `ExtTab` 增加 `deepsearch`
  - tabs 增加 `DeepSearch`
  - 内容区挂载 `DeepSearchPanel`
- [src/i18n/zh.ts](/Users/zhangjun/私藏/lumos/src/i18n/zh.ts)
- [src/i18n/en.ts](/Users/zhangjun/私藏/lumos/src/i18n/en.ts)
  - 增加 DeepSearch tab、按钮、状态、详情区相关文案

这里建议不要把 DeepSearch 组件塞进：

- `src/components/extensions/*`

原因：

- `extensions` 更适合聚合页壳
- DeepSearch 自己已经是独立业务域
- 后续聊天详情深链、Workflow 深链也会复用它的组件

## 3.2 类型定义

建议新增：

- `src/types/deepsearch.ts`

职责：

- 统一 `RunStatus / SiteLoginState / PageMode / Strictness`
- 统一 `DeepSearchRunView / DetailView / ArtifactRef`
- 避免 UI、API、service 各自重新声明一套 shape

## 3.3 DeepSearch 服务目录

建议新增：

- `src/lib/deepsearch/service.ts`
- `src/lib/deepsearch/repository.ts`
- `src/lib/deepsearch/types.ts`
- `src/lib/deepsearch/site-session-manager.ts`
- `src/lib/deepsearch/browser-runtime-adapter.ts`
- `src/lib/deepsearch/adapter-registry.ts`
- `src/lib/deepsearch/site-adapter-runtime.ts`
- `src/lib/deepsearch/content-pipeline.ts`
- `src/lib/deepsearch/evidence-builder.ts`
- `src/lib/deepsearch/result-view.ts`

建议边界：

- `service.ts`
  - 唯一正式业务入口
- `repository.ts`
  - 聚合 DB 读写
- `site-session-manager.ts`
  - 站点登录态检查、登录页打开、复检
- `browser-runtime-adapter.ts`
  - 通过 browser bridge 调页面、截图、evaluate、session fetch
- `adapter-registry.ts`
  - 站点 adapter 元数据
- `site-adapter-runtime.ts`
  - 执行 adapter
- `content-pipeline.ts`
  - 归一正文与页面结果
- `evidence-builder.ts`
  - 生成 artifact / evidence
- `result-view.ts`
  - 组装给 UI 和 tool 的读模型

## 3.4 Browser runtime client

建议新增或重构：

- `src/lib/browser-runtime/bridge-client.ts`

初始来源：

- 从 [src/lib/workflow/browser-bridge-client.ts](/Users/zhangjun/私藏/lumos/src/lib/workflow/browser-bridge-client.ts) 抽出

这样做的原因：

- Workflow 和 DeepSearch 都要调 browser bridge
- 不能让 DeepSearch 依赖 `workflow/` 命名空间里的 runtime client

## 3.5 DB 层

建议新增：

- `src/lib/db/deepsearch.ts`

建议改动：

- [src/lib/db/migrations-lumos.ts](/Users/zhangjun/私藏/lumos/src/lib/db/migrations-lumos.ts)
  - 新增 `deepsearch_runs`
  - 新增 `deepsearch_run_pages`
  - 新增 `deepsearch_run_checkpoints`
  - 新增 `deepsearch_records`
  - 新增 `deepsearch_artifacts`
  - 新增 `deepsearch_site_states`
  - 新增 `deepsearch_site_adapters`

建议不要：

- 把 DeepSearch SQL 混进 [src/lib/db/tasks.ts](/Users/zhangjun/私藏/lumos/src/lib/db/tasks.ts)
- 把深搜 schema 直接拍进 [src/lib/db/schema.ts](/Users/zhangjun/私藏/lumos/src/lib/db/schema.ts) 的主初始化块里

更合理的做法是：

- fresh install 仍由 `schema.ts -> migrateLumosTables()` 统一进表
- 具体 DeepSearch 表结构和列补丁都收口到 `migrations-lumos.ts`

## 3.6 API routes

建议新增：

- `src/app/api/deepsearch/sites/route.ts`
- `src/app/api/deepsearch/sites/[siteId]/recheck/route.ts`
- `src/app/api/deepsearch/sites/[siteId]/login/route.ts`
- `src/app/api/deepsearch/runs/route.ts`
- `src/app/api/deepsearch/runs/[id]/route.ts`
- `src/app/api/deepsearch/runs/[id]/pause/route.ts`
- `src/app/api/deepsearch/runs/[id]/resume/route.ts`
- `src/app/api/deepsearch/runs/[id]/cancel/route.ts`
- `src/app/api/deepsearch/runs/[id]/retry/route.ts`

推荐职责：

- `sites`
  - 列表、重检、打开登录页
- `runs`
  - 列表、创建、详情、状态控制

## 3.7 Electron / browser bridge

建议新增：

- `electron/browser/deepsearch-observer.ts`
- `electron/browser/deepsearch-runtime.ts`

建议改动：

- [electron/browser/bridge-server.ts](/Users/zhangjun/私藏/lumos/electron/browser/bridge-server.ts)

建议新增 bridge 端点：

- `POST /v1/deepsearch/pages/attach-active`
  - 显式返回当前活动页并确认绑定
- `POST /v1/deepsearch/session-fetch`
  - 在指定页面上下文中发请求
- `POST /v1/deepsearch/compact-snapshot`
  - 返回更适合 DeepSearch 的页面快照
- `POST /v1/deepsearch/login-probe`
  - 跑站点级登录探针
- `POST /v1/deepsearch/run-adapter`
  - 在指定页面执行受控 adapter

注意：

- Phase 1 不建议新搞一套 Electron IPC 主链给 service 用
- 服务侧更适合通过 browser bridge 调 Electron 浏览器 runtime
- Renderer 侧如果只是要预览“当前活动页是谁”，可以继续直接用现有 `electronAPI.browser.getTabs()`

---

## 4. 关键模块如何衔接

## 4.1 当前活动页接管

建议分成两段：

### A. Renderer 预览

由 UI 直接调用现有浏览器 API：

- [src/types/browser.ts](/Users/zhangjun/私藏/lumos/src/types/browser.ts)
- [electron/ipc/browser-handlers.ts](/Users/zhangjun/私藏/lumos/electron/ipc/browser-handlers.ts)

目的：

- 在发起前给用户展示当前 active tab 的标题、URL、域名

### B. Service 正式绑定

由 DeepSearch service 通过 browser bridge 再做一次正式绑定确认。

目的：

- 避免 UI 预览看到的是 A 页，真正执行时静默落到 B 页

这一步必须写入：

- `deepsearch_run_pages`

## 4.2 登录检查

建议流程：

1. `adapter-registry` 提供站点登录探针配置
2. `site-session-manager` 通过 browser bridge 的 DeepSearch 登录探针端点执行
3. 结果写入 `deepsearch_site_states`
4. 详情投影由 `result-view.ts` 统一输出

不要做的事情：

- 让 UI 自己拼 login probe
- 让聊天 tool 自己猜登录态

## 4.3 运行主链

建议固定为：

1. API route 收到创建请求
2. `DeepSearchService.startRun`
3. `repository` 先落 `deepsearch_runs(status=pending)`
4. `browser-runtime-adapter` 绑定页面
5. `site-session-manager` 检查登录态
6. `site-adapter-runtime` 执行站点抓取
7. `content-pipeline` 归一内容
8. `evidence-builder` 落 artifact
9. `repository` 回写 run / record / checkpoint
10. `result-view` 返回给 UI / tool

## 4.4 聊天与 Workflow 复用

Phase 1：

- 聊天侧只接 `tool facade`
- Workflow 不正式接入

Phase 2：

- Workflow 通过 capability facade 调用同一 `DeepSearchService`

建议新增：

- `src/lib/deepsearch/tool-facade.ts`
- `src/lib/deepsearch/workflow-capability.ts`

---

## 5. 推荐开发顺序

## 5.1 Milestone 1：类型与 DB

改动建议：

- `src/types/deepsearch.ts`
- `src/lib/db/migrations-lumos.ts`
- `src/lib/db/deepsearch.ts`
- `src/lib/deepsearch/repository.ts`

完成标志：

- `run / run page / checkpoint / record / artifact / site state` 能稳定存取

## 5.2 Milestone 2：扩展页 UI 壳

改动建议：

- `src/app/extensions/page.tsx`
- `src/components/deepsearch/*`
- `src/i18n/zh.ts`
- `src/i18n/en.ts`

完成标志：

- 用户能在 `扩展` 页里看到 `DeepSearch` tab
- 能看到站点区、发起区、历史区、详情区空壳

## 5.3 Milestone 3：browser runtime client 抽取

改动建议：

- 抽出 `src/lib/browser-runtime/bridge-client.ts`
- 更新 Workflow 对旧 client 的引用
- DeepSearch service 也接这套 client

完成标志：

- Workflow 和 DeepSearch 共用同一 bridge client

## 5.4 Milestone 4：活动页接管与站点登录态

改动建议：

- `electron/browser/bridge-server.ts`
- `src/lib/deepsearch/site-session-manager.ts`
- `src/components/deepsearch/deepsearch-page-binding-preview.tsx`

完成标志：

- UI 能看到当前活动页预览
- Service 能正式绑定活动页
- 站点登录态可检查、可重检、可打开登录页

## 5.5 Milestone 5：run 生命周期与详情

改动建议：

- `src/lib/deepsearch/service.ts`
- `src/app/api/deepsearch/runs/*`
- `src/components/deepsearch/deepsearch-run-history-list.tsx`
- `src/components/deepsearch/deepsearch-run-detail-panel.tsx`

完成标志：

- 能创建 run
- 能看到 `waiting_login / paused / partial`
- 能看详情、正文、截图和失败原因

## 5.6 Milestone 6：首批站点 adapter

改动建议：

- `src/lib/deepsearch/adapter-registry.ts`
- `src/lib/deepsearch/site-adapter-runtime.ts`
- `src/lib/deepsearch/adapters/zhihu/*`
- `src/lib/deepsearch/adapters/bilibili/*`

完成标志：

- 至少 1 到 2 个高价值站点可走正式主链

## 5.7 Milestone 7：聊天 tool facade

改动建议：

- `src/lib/deepsearch/tool-facade.ts`
- 聊天 tool 注册入口

完成标志：

- 聊天能调用同一 service
- 登录阻塞和 partial 结果语义一致

---

## 6. 明确不建议的工程做法

- 不新开 `/deepsearch` 一级页面替代现有 `扩展` 页
- 不把 DeepSearch service 写进 `src/lib/workflow/*`
- 不让 UI 直接操作 browser bridge 细节完成正式执行
- 不让 service 直接调用 Renderer IPC
- 不把 DeepSearch SQL 混进 tasks/workflow 表操作文件
- 不在 Phase 1 先做 Workflow 正式接入

---

## 7. Phase 1 严格完成标准

只有同时满足以下条件，才算工程拆解对应的主链已落地：

1. `扩展` 页已出现 `DeepSearch` tab
2. DeepSearch UI 已使用真实 `src/lib/deepsearch/*` service
3. DeepSearch 表已由 `migrations-lumos.ts` 正式创建
4. 浏览器执行已通过通用 browser bridge client 访问 Electron runtime
5. 当前活动页接管已能正式绑定到 `runId + pageId`
6. `waiting_login / paused / partial` 能真实落库并在 UI 可见
7. 聊天已调用同一 service

如果缺其中任一项，就不能说 `08` 已经进入正式工程可验收状态。

---

## 8. 当前结论

一句话总结：

- **`08 DeepSearch` 在当前仓库里的正确工程落点，是“复用 `/extensions` 页承接正式 UI、在 `src/lib/deepsearch` 建独立服务域、在 `migrations-lumos.ts` 建独立数据表、通过通用 browser bridge client 复用 Electron 浏览器 runtime”，而不是单独再开一套壳。**
