# DeepSearch 数据与 API 设计文档

## 0. 文档定位

本文补充回答三个实现前必须定死的问题：

- DeepSearch 需要哪些持久化实体和关键字段
- DeepSearch Service 应该暴露什么内部接口
- 聊天 / Workflow / UI / LLM tool 应该如何消费同一套服务合同

本文不替代以下文档：

- `08-deepsearch-architecture-design.md`
- `08-deepsearch-phase-1-implementation-design.md`
- `08-deepsearch-ui-and-interaction-design.md`

它的目标是把 `08 DeepSearch` 的数据边界和服务合同推进到可直接指导后端与前端实现的层级。

---

## 1. 设计原则

DeepSearch 的数据与 API 设计建议遵守以下原则：

1. `run` 是统一主实体
2. 页面绑定必须独立建模，不能只靠临时内存状态
3. 大结果必须 artifact 化，不能默认走同步 JSON
4. `waiting_login / paused / partial` 都是正式状态，不是错误字符串
5. LLM tool、正式 UI、Workflow facade 都必须消费同一套 service 结果

---

## 2. 持久化实体

## 2.1 `deepsearch_runs`

用途：

- 记录一次 DeepSearch 任务的主状态和主参数

建议字段：

- `id`
- `session_id`
- `source_type`
  - `ui`
  - `chat`
  - `workflow`
- `source_ref_id`
- `query`
- `goal`
- `sites_json`
- `page_mode`
- `strictness`
- `max_pages`
- `max_depth`
- `keep_evidence`
- `keep_screenshots`
- `status`
- `summary`
- `error_message`
- `blocked_site_ids_json`
- `checkpoint_id`
- `page_count`
- `evidence_count`
- `created_at`
- `updated_at`
- `completed_at`

约束：

- `status` 只能取：
  - `pending`
  - `running`
  - `waiting_login`
  - `paused`
  - `completed`
  - `partial`
  - `failed`
  - `cancelled`

## 2.2 `deepsearch_run_pages`

用途：

- 记录某次 run 绑定过哪些浏览器页面

建议字段：

- `id`
- `run_id`
- `page_id`
- `site_id`
- `binding_type`
  - `taken_over_active_page`
  - `managed_page`
- `role`
  - `seed`
  - `search`
  - `detail`
  - `login`
- `initial_url`
- `last_known_url`
- `attached_at`
- `released_at`

约束：

- 每个 run 至少要有一个 `run page`
- 所有页面级结果和证据都必须能反查到 `run_page_id`

## 2.3 `deepsearch_run_checkpoints`

用途：

- 记录等待登录、暂停和恢复所需的执行位置

建议字段：

- `id`
- `run_id`
- `stage`
  - `planning`
  - `login_gate`
  - `site_execution`
  - `content_extraction`
  - `finalizing`
- `next_site_ids_json`
- `completed_site_ids_json`
- `skipped_site_ids_json`
- `blocked_site_ids_json`
- `resume_token`
- `snapshot_json`
- `updated_at`

说明：

- `resume` 不需要单独状态表，但必须有 checkpoint
- 没有 checkpoint，就无法严格支持“恢复原任务”

## 2.4 `deepsearch_records`

用途：

- 记录页面级抓取结果

建议字段：

- `id`
- `run_id`
- `run_page_id`
- `site_id`
- `url`
- `title`
- `content_state`
  - `list_only`
  - `partial`
  - `full`
  - `failed`
- `snippet`
- `evidence_count`
- `failure_stage`
  - `login`
  - `navigation`
  - `extraction`
  - `normalization`
- `login_related`
- `content_artifact_id`
- `screenshot_artifact_id`
- `fetched_at`
- `error_message`

## 2.5 `deepsearch_artifacts`

用途：

- 保存正文、截图、结构化结果和其他大对象

建议字段：

- `id`
- `run_id`
- `record_id`
- `kind`
  - `content`
  - `screenshot`
  - `structured_json`
  - `evidence_snippet`
  - `network_trace`
  - `html_snapshot`
- `storage_path`
- `mime_type`
- `size_bytes`
- `metadata_json`
- `created_at`

## 2.6 `deepsearch_site_states`

用途：

- 保存站点级登录态检查结果

建议字段：

- `site_id`
- `display_name`
- `login_state`
  - `missing`
  - `connected`
  - `suspected_expired`
  - `expired`
  - `error`
- `last_checked_at`
- `last_login_at`
- `blocking_reason`
- `last_error`

## 2.7 `deepsearch_site_adapters`

用途：

- 保存站点适配器注册信息

建议字段：

- `site_id`
- `adapter_id`
- `display_name`
- `adapter_source_type`
  - `native`
  - `compatible`
- `adapter_tier`
  - `tier1`
  - `tier2`
  - `tier3`
- `review_status`
  - `draft`
  - `reviewed`
  - `published`
  - `disabled`
- `requires_login`
- `preferred_page_mode`
- `supported_goals_json`
- `version`
- `runtime_policy_json`
- `updated_at`

---

## 3. 读模型与计数器

为了支撑正式 UI，建议在 service 侧稳定输出以下投影字段：

- `run.pageCount`
- `run.evidenceCount`
- `run.blockedSiteIds`
- `run.partialReasonSummary`
- `run.completedSiteCount`
- `run.failedSiteCount`
- `run.loginBlockedSiteCount`

原因：

- 历史列表和详情页都需要这些值
- 不应要求前端自己从所有 records/artifacts 里二次推导

---

## 4. DeepSearch Service 接口

## 4.1 Service 目标

`DeepSearch Service` 是唯一正式业务入口。

UI、聊天和 Workflow 都不应直接拼底层浏览器调用。

## 4.2 建议接口

```ts
interface DeepSearchService {
  startRun(input: StartDeepSearchRunInput): Promise<DeepSearchRunHandle>;
  getRun(runId: string): Promise<DeepSearchRunView | null>;
  getRunDetail(runId: string): Promise<DeepSearchRunDetailView | null>;
  listRuns(input: ListDeepSearchRunsInput): Promise<ListDeepSearchRunsResult>;
  pauseRun(runId: string): Promise<DeepSearchRunHandle>;
  resumeRun(runId: string): Promise<DeepSearchRunHandle>;
  cancelRun(runId: string): Promise<DeepSearchRunHandle>;
  retryRun(runId: string): Promise<DeepSearchRunHandle>;
  openLoginPage(input: OpenDeepSearchLoginInput): Promise<OpenLoginPageResult>;
  recheckSiteState(siteId: string): Promise<SiteConnectionView>;
}
```

## 4.3 `startRun` 输入

```ts
interface StartDeepSearchRunInput {
  query: string;
  goal: 'browse' | 'evidence' | 'full-content' | 'research-report';
  sites: string[];
  pageMode: 'takeover_active_page' | 'managed_page';
  strictness: 'strict' | 'best_effort';
  maxPages: number;
  maxDepth: number;
  keepEvidence: boolean;
  keepScreenshots: boolean;
  sourceType: 'ui' | 'chat' | 'workflow';
  sourceRefId?: string;
}
```

约束建议：

- `chat` 默认 `pageMode` 应为 `managed_page`
- 只有用户明确表达“从当前页继续”时，聊天才允许传 `takeover_active_page`
- UI 可以自由选择两种页面模式

## 4.4 `DeepSearchRunHandle`

```ts
interface DeepSearchRunHandle {
  runId: string;
  status:
    | 'pending'
    | 'running'
    | 'waiting_login'
    | 'paused'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled';
  nextActions: Array<'pause' | 'resume' | 'cancel' | 'open_login' | 'retry'>;
  summary?: string;
  blockedSiteIds?: string[];
}
```

## 4.5 `DeepSearchRunView`

这是给历史列表和轻量状态展示用的读模型。

```ts
interface DeepSearchRunView {
  runId: string;
  query: string;
  sites: string[];
  pageMode: 'takeover_active_page' | 'managed_page';
  strictness: 'strict' | 'best_effort';
  status:
    | 'pending'
    | 'running'
    | 'waiting_login'
    | 'paused'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled';
  pageCount: number;
  evidenceCount: number;
  partialReasonSummary?: string;
  createdAt: string;
  completedAt?: string;
}
```

## 4.6 `DeepSearchRunDetailView`

这是给正式详情页、聊天详情链接和 Workflow 深链打开使用的读模型。

```ts
interface DeepSearchRunDetailView extends DeepSearchRunView {
  summary?: string;
  blockedSiteIds: string[];
  checkpoint?: DeepSearchCheckpointView;
  pages: DeepSearchRunPageView[];
  records: DeepSearchRecordView[];
  artifacts: DeepSearchArtifactView[];
  failures: DeepSearchFailureView[];
}
```

---

## 5. 状态迁移规则

建议固定以下规则：

- `startRun`
  - 创建时写入 `pending`
- `pending -> running`
  - 调度正式开始时进入
- `running -> waiting_login`
  - `strict` 模式下关键站点登录不满足
- `running -> paused`
  - 用户主动暂停
- `running -> partial`
  - `best_effort` 模式下有目标站点未完成
- `running -> completed`
  - 目标全部完成
- `running -> failed`
  - `strict` 模式关键站点失败，或运行发生不可恢复错误
- `running|waiting_login|paused -> cancelled`
  - 用户主动取消
- `waiting_login|paused -> pending`
  - 用户触发 `resume`

这意味着：

- `resume` 是动作，不是状态
- `partial` 只能由最终收口产生，不建议中途临时进入

---

## 6. UI 调用合同

正式页建议只使用高层 service，不直接碰底层 browser bridge。

推荐调用：

- 页面初始化
  - `listRuns`
  - `listSiteStates`
- 站点区
  - `recheckSiteState`
  - `openLoginPage`
- 发起区
  - `startRun`
- 活动 run 控制
  - `pauseRun`
  - `resumeRun`
  - `cancelRun`
- 详情区
  - `getRunDetail`
- 历史重跑
  - `retryRun`

---

## 7. LLM Tool Facade 合同

## 7.1 目标

LLM 看到的是 DeepSearch 的高层语义，而不是浏览器动作脚本。

## 7.2 建议 tool 集

- `deepsearch.start`
- `deepsearch.get_result`
- `deepsearch.pause`
- `deepsearch.resume`
- `deepsearch.cancel`

## 7.3 `deepsearch.start` 输入

```ts
interface DeepSearchStartToolInput {
  query: string;
  sites?: string[];
  goal?: 'browse' | 'evidence' | 'full-content' | 'research-report';
  pageMode?: 'takeover_active_page' | 'managed_page';
  strictness?: 'strict' | 'best_effort';
  maxPages?: number;
  maxDepth?: number;
  keepEvidence?: boolean;
  keepScreenshots?: boolean;
}
```

建议默认值：

- `pageMode`
  - 聊天默认 `managed_page`
- `strictness`
  - 聊天默认 `best_effort`
- `maxPages`
  - 默认给中等预算

## 7.4 `deepsearch.start` 输出

```ts
interface DeepSearchStartToolOutput {
  runId: string;
  status:
    | 'pending'
    | 'running'
    | 'waiting_login'
    | 'paused'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled';
  summary?: string;
  blockedSiteIds?: string[];
  nextActions: Array<'pause' | 'resume' | 'cancel' | 'open_login' | 'retry'>;
  detailEntry?: {
    kind: 'deepsearch_run';
    runId: string;
  };
}
```

## 7.5 Tool 使用约束

- `deepsearch.start`
  - 不返回大正文
- `deepsearch.get_result`
  - 返回状态、摘要、简短证据概览和详情入口
- `deepsearch.pause`
  - 只做状态控制
- `deepsearch.resume`
  - 只在 `waiting_login` 或 `paused` 下可用
- `deepsearch.cancel`
  - 取消后不再允许 `resume`

---

## 8. Workflow Capability Facade 合同

Workflow 侧建议只暴露一个高层 capability：

- `deepsearch`

建议输入：

```ts
interface DeepSearchCapabilityInput {
  query: string;
  sites?: string[];
  goal?: 'browse' | 'evidence' | 'full-content' | 'research-report';
  strictness?: 'strict' | 'best_effort';
  maxPages?: number;
  maxDepth?: number;
}
```

建议输出：

```ts
interface DeepSearchCapabilityOutput {
  runId: string;
  status:
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled'
    | 'waiting_login';
  summary?: string;
  artifactRefs: DeepSearchArtifactRef[];
  detailRef: {
    kind: 'deepsearch_run';
    runId: string;
  };
}
```

注意：

- Workflow 不应直接拿到 `takeover_active_page`
- Workflow 默认只走 `managed_page`
- `takeover_active_page` 主要是 UI 和特定聊天场景能力

---

## 9. 并发、幂等与治理要求

建议提前定义三条运行时规则：

- 同一 run 上的 `pause / resume / cancel` 必须串行化
- `resumeRun` 应幂等
  - 已恢复中的 run 再点一次不能重复起第二条执行链
- `takeover_active_page` 必须记录最近一次绑定信息
  - 避免后续 evidence 归属混乱

---

## 10. 当前结论

一句话总结：

- **DeepSearch 必须把 `run / run page / checkpoint / record / artifact / site state` 这些实体正式化，并让 UI、LLM tool、Workflow 都消费同一个 `DeepSearch Service` 合同；否则“接管当前页、等待登录恢复、partial 收口”都会停留在概念层。**
