# DeepSearch → 知识库自动归档设计

**状态**: 设计定稿 v5（三轮 review 修复后）
**日期**: 2026-03-30
**背景**: DeepSearch 采集的内容目前只在对话上下文里临时使用，run 结束后数据虽保存在 DB 但无法被知识库检索系统利用，造成浪费。本文设计将 DeepSearch 结果归入知识库并完整索引的方案。

---

## 一、核心设计决策

### 1.1 归档粒度：Record 级（每条网页一个 kb_item）

| 选项 | 优点 | 缺点 |
|------|------|------|
| Run 级（一次搜索 = 一条记录） | 简单 | 内容混杂，无法按单篇检索 |
| **Record 级（每条 URL = 一条记录）** | 精确去重、精确检索、标签准确 | 需要处理多条并发写入 |
| Artifact 级（最细粒度） | 最完整 | 过细，知识库碎片化 |

**结论：Record 级。** 每个 `DeepSearchRecord` 对应一个 `kb_items` 条目。

### 1.2 触发行为：由系统设置控制

新增系统设置项 `deepsearch.archive_mode`，三档可选：

| 模式 | 行为 | 默认 |
|------|------|------|
| `auto` | 搜索完成后自动归档，无需用户操作 | |
| `confirm` | 搜索完成后在 DeepSearchSourcesCard 弹出确认提示，用户点"保存"才归档 | ✅ 默认 |
| `disabled` | 从不主动提示，仅保留手动按钮 | |

**触发时机**：无论哪个模式，都在 `getDeepSearchToolResult()` 检测到 `completed / partial` 状态时响应。

- `auto`：直接后台异步归档，不阻塞响应
- `confirm`：在工具结果里附加 `archivePrompt: true` 标记，由 `DeepSearchSourcesCard` 展示确认 UI
- `disabled`：不触发，UI 仅显示手动"保存到资料库"按钮

**三个模式都保留手动按钮**。`confirm` 模式下用户点"跳过"只关闭主动提示，不隐藏手动入口，用户随时可以手动保存。

幂等保证：通过 `source_key` (`deepsearch:${url}`) 去重，重复触发只跳过已存在条目。另外在 run 级别通过 `archived_at` 列短路，`auto` 模式下避免反复遍历已归档的 run。

### 1.3 集合（Collection）设计

**使用固定的"联网搜索资料"集合**，首次归档时自动创建（如不存在）。

```
集合名称:  联网搜索资料
集合描述:  由 DeepSearch 自动归档的网页内容，来自知乎、微信公众号、小红书、掘金等
```

查找方式：`listCollections().find(c => c.name === '联网搜索资料')`，找不到则 `createCollection()`。

### 1.4 内容策略

优先级：

```
record.contentArtifact（run 加载时已预填充，无需额外查询）
  → 通过 fs.readFile(record.contentArtifact.storagePath, 'utf-8') 读取全文
  → 读取失败（文件已删除）→ fallback 到 snippet + title
  → snippet 也为空 → 跳过该 record
```

只归档 `contentState` 为 `partial` 或 `full` 的 record，跳过 `list_only` 和 `failed`。

**导入模式**：
- 有 artifact 全文（通常 > 500 字）→ `mode: 'full'`（完整 pipeline：chunk → BM25 → embed → summarize）
- 仅有 snippet（通常 < 300 字）→ `mode: 'reference'`（轻量 pipeline：仅 BM25 索引，跳过 embed/summarize，节省 API 调用）

### 1.5 去重粒度

**同集合内去重**（与 `findItemBySourceKey` 的实际行为一致）。

`findItemBySourceKey(collectionId, sourceKey)` 的查询条件是 `WHERE collection_id=? AND source_key=?`，仅在目标集合"联网搜索资料"内去重。如果用户在其他集合手动导入了相同 URL，不会被拦截——这是预期行为，因为用户主动导入说明有独立的管理意图。

**URL 归一化**：本期不做（不处理 `www` 前缀、尾部 `/`、`http` vs `https` 差异），接受少量重复。如果后续发现重复率高，可加 `normalizeUrl()` 统一处理。

---

## 二、设置项设计

### 新增设置字段

**位置**：设置页 → 扩展 → DeepSearch（或"知识库"tab 下）

**字段**：`deepsearch.archive_mode`（snake_case，与现有设置 key 风格一致）

| 选项值 | 显示文字 |
|--------|---------|
| `auto` | 自动保存（搜索完成后静默归档） |
| `confirm` | 提示后保存（搜索完成后询问是否保存）← 默认 |
| `disabled` | 不提示（仅保留手动按钮） |

**存储**：使用现有的 `settings` 表，key = `deepsearch.archive_mode`。

**读取**：`getSetting('deepsearch.archive_mode') ?? 'confirm'`。

---

## 三、DB 变更

### 新增列

`deepsearch_runs` 表新增 `archived_at` 列，记录归档时间：

```sql
ALTER TABLE deepsearch_runs ADD COLUMN archived_at TEXT DEFAULT NULL;
```

在 `migrations-lumos.ts` 中添加。`archived_at` 非空表示已归档，`archiveDeepSearchRun` 成功后写入 `datetime('now')`。

对应类型变更：`DeepSearchRunRecord` 新增 `archivedAt: string | null`。

---

## 四、标签策略

标签分四层，依次生成，最终合并去重：

### 层 1：固定标签（必有）

| 标签 | 含义 |
|------|------|
| `deepsearch` | 机器可读来源标记 |
| `联网搜索` | 中文来源标记 |

### 层 2：站点标签（来自 siteKey）

| siteKey | 标签 |
|---------|------|
| `zhihu` | `知乎` |
| `wechat` | `微信公众号` |
| `xiaohongshu` | `小红书` |
| `juejin` | `掘金` |
| `x` | `Twitter` |
| 其他 | 直接用 siteKey 值 |

### 层 3：查询词标签（来自 run.queryText）

对 queryText 按空格/标点分割，去掉停用词，取前 3 个非空词作标签：

```typescript
// 示例：queryText = "知乎 2024年 AI大模型 应用趋势"
// 去停用词后 → ["AI大模型", "应用趋势", "2024年"]
// 标签: ["AI大模型", "应用趋势", "2024年"]

const STOP_WORDS = new Set([
  "的","是","在","了","和","与","或","等","来自","关于",
  "怎么","什么","如何","哪些","一些","这些","那些",
  "知乎","微信","小红书","掘金","twitter",
]);
```

### 层 4：AI 自动标签

`processImport` pipeline 里已有 `autoTagCategorizedStrict(content, existingTags)` 会基于内容补充分类标签（`技术`、`商业`、`AI`等）。直接复用，无需额外实现。仅 `mode: 'full'` 时触发。

### 最终标签示例

```
queryText = "知乎 AI大模型应用趋势分析"   siteKey = "zhihu"

最终标签: ["deepsearch", "联网搜索", "知乎", "AI大模型", "应用趋势", + AI补充标签]
```

---

## 五、数据映射

```
DeepSearchRecord / Run          →   kb_items 字段
──────────────────────────────────────────────────────
record.title                    →   title
record.url                      →   source_path
"deepsearch:" + record.url      →   source_key（同集合内去重）
"webpage"                       →   source_type
fs.readFile(contentArtifact.storagePath) || snippet+title  →  fullContent
[层1+2+3 标签]                  →   tags 初始值（AI 再追加层4）
record.fetchedAt?.slice(0, 10)  →   doc_date
```

注：`processImport` 的 `ImportData` 接口没有 `doc_date` 字段。在 `processImport` 返回 `{ item }` 后，用 `item.id` 执行 `UPDATE kb_items SET doc_date=? WHERE id=?`。

---

## 六、模块设计

### 6.1 新增文件

```
src/lib/knowledge/deepsearch-importer.ts          ← 核心归档逻辑
src/app/api/deepsearch/runs/[id]/save-to-library/route.ts  ← 手动/确认 触发 API
```

### 6.2 修改文件

```
src/lib/db/migrations-lumos.ts                    ← ALTER TABLE deepsearch_runs ADD COLUMN archived_at
src/lib/db/deepsearch.ts                          ← mapRunRow 补充 archivedAt 映射
src/lib/deepsearch/tool-facade.ts                 ← 检测 archive mode，触发归档或标记 confirm
src/components/chat/DeepSearchSourcesCard.tsx     ← 确认 UI + 手动按钮 + 归档状态显示
src/components/settings/...                       ← 新增设置项 UI（三档单选）
src/types/index.ts 或 deepsearch.ts               ← DeepSearchRunRecord 新增 archivedAt
```

### 6.3 `deepsearch-importer.ts` 主要接口

```typescript
import fs from 'node:fs/promises';
import * as store from './store';
import { processImport } from './importer';
import { getDeepSearchRun } from '@/lib/db';

/**
 * 将一次 DeepSearch run 的已完成 record 归档到知识库。
 * 幂等：已存在的 URL 会跳过（同集合内 source_key 去重）。
 * run.archivedAt 非空时直接返回（run 级短路）。
 */
export async function archiveDeepSearchRun(runId: string): Promise<ArchiveResult>

interface ArchiveResult {
  runId: string;
  total: number;        // record 总数（含 list_only）
  eligible: number;     // 满足条件（partial/full + 有内容）的 record 数
  saved: number;        // 本次新增 kb_item 数
  duplicate: number;    // 已存在、跳过
  failed: number;       // 单条导入失败（不影响其他）
  skipped: number;      // 不满足条件的 record 数（list_only / failed / 无内容）
  collectionId: string;
  collectionName: string;
}
// 约束：total = eligible + skipped，eligible = saved + duplicate + failed

/** 获取或创建"联网搜索资料"集合 */
function ensureArchiveCollection(): string   // returns collectionId
// 实现: listCollections().find(c => c.name === COLLECTION_NAME) ?? createCollection(...)

/** 从 queryText 提取关键词标签（最多 3 个，去停用词） */
function extractQueryTags(queryText: string): string[]

/** source_key: "deepsearch:" + url */
function buildSourceKey(url: string): string

/**
 * 读取 artifact 全文内容。
 * record.contentArtifact 已由 getDeepSearchRun 预填充，
 * 通过 fs.readFile(artifact.storagePath, 'utf-8') 读取。
 * 文件不存在或读取失败返回 null。
 */
async function readArtifactContent(
  artifact: DeepSearchArtifactRecord | null,
): Promise<string | null>
```

### 6.4 `tool-facade.ts` 中的触发逻辑

```typescript
export async function getDeepSearchToolResult(runId: string) {
  const [sites, run] = await Promise.all([listDeepSearchSitesView(), getRunOrThrow(runId)]);
  const view = buildRunView(run, sites);

  // 归档逻辑（仅终止状态 + 未归档时触发）
  if (
    (view.status === 'completed' || view.status === 'partial')
    && !run.archivedAt
  ) {
    const archiveMode = getSetting('deepsearch.archive_mode') ?? 'confirm';

    if (archiveMode === 'auto') {
      // 静默后台归档，不等待
      archiveDeepSearchRun(runId).catch((e) =>
        console.error('[deepsearch] auto-archive failed:', e.message)
      );
    } else if (archiveMode === 'confirm') {
      // 扩展返回值，注入标记（保留 action 字段）
      return { action: 'get_result' as const, ...view, archivePrompt: true };
    }
    // 'disabled' → 什么都不做
  }

  return { action: 'get_result' as const, ...view };
}
```

注意：
- `view` 是 `buildRunView` 的返回值（推断类型），不能直接赋值 `view.archivePrompt`。使用 `{ ...view, archivePrompt: true }` 扩展返回值。
- 所有返回路径都必须包含 `action: 'get_result'`，与现有代码一致，避免破坏下游消费者。

### 6.5 `extractDeepSearchSources` 扩展

当前 `extractDeepSearchSources` 只返回 `{ sources, query }`。需要扩展为同时提取 `runId` 和 `archivePrompt`，供 `DeepSearchSourcesCard` 使用：

```typescript
// DeepSearchSourcesCard.tsx
export function extractDeepSearchSources(
  pairedTools: Array<{ name: string; result?: string; isError?: boolean }>,
): {
  sources: DeepSearchSource[];
  query: string;
  runId?: string;
  archivePrompt?: boolean;
} | null {
  // ... 现有逻辑（使用 unwrapToolResult）...
  // 额外提取:
  //   runId = typeof data?.runId === 'string' ? data.runId : undefined
  //   archivePrompt = data?.archivePrompt === true
}

// DeepSearchSourcesCard props 相应新增:
interface DeepSearchSourcesCardProps {
  sources: DeepSearchSource[];
  query?: string;
  runId?: string;           // 用于调用 save-to-library API
  archivePrompt?: boolean;  // confirm 模式下是否显示提示
}
```

### 6.6 API 端点

```
POST /api/deepsearch/runs/:id/save-to-library
Body: {}
Response 200: { saved, duplicate, eligible, skipped, failed, collectionId, collectionName }
Response 404: { error: "run not found" }
```

---

## 七、UI 设计

### DeepSearchSourcesCard 底部归档区域

所有模式都显示底部区域，差异在于内容：

**状态 A：confirm 模式 + archivePrompt=true + 尚未保存/跳过**
```
┌──────────────────────────────────────────────────────┐
│  [站点图标]  8 个来源 · AI大模型趋势           ▼    │
│  [来源卡片列表...]                                   │
│  ──────────────────────────────────────────────────  │
│  📚 搜索已完成，是否保存到「联网搜索资料」？         │
│     [保存]  [跳过]                                   │
└──────────────────────────────────────────────────────┘
```

**状态 B：保存中 / 已保存**
```
│  ✓ 已保存 6 条到「联网搜索资料」   [查看]  [重新保存] │
```
注意：状态 B 中的数字来自归档 API 返回的 `ArchiveResult.saved`，而非 `sampleRecords.length`。`buildRunView` 的 `sampleRecords` 最多返回 20 条，但 `archiveDeepSearchRun` 处理全量 records，两者数量可能不同。UI 应以 API 返回值为准。

**状态 C：disabled 模式 / confirm 点了跳过之后 / auto 已自动保存前的兜底**
```
│  [保存到资料库]                                      │
```

### 状态持久化

`archivePrompt: true` 一旦写入消息历史就是冻结的，页面刷新后组件重新渲染仍会读到该标记。需要避免反复弹出 confirm 提示。

**方案**：使用 `localStorage` 按 runId 记录用户操作：
- 用户点"保存"且成功 → `localStorage.setItem('ds:saved:' + runId, '1')` → 渲染状态 B
- 用户点"跳过" → `localStorage.setItem('ds:dismissed:' + runId, '1')` → 渲染状态 C
- 渲染时先检查 localStorage，命中则跳过 confirm 提示

此外，`run.archivedAt` 非空时 `getDeepSearchToolResult` 不再注入 `archivePrompt`（6.4 的 `!run.archivedAt` 条件），已归档的 run 在后续消息中天然不带 prompt。

其他按钮行为：
- "查看" → 跳转到知识库并按 `deepsearch` 标签过滤（本期不实现，按钮灰显）
- "重新保存" → 重新调用 API，幂等跳过已存在的

---

## 八、性能考量

### 批量导入策略

每条 record 走 `processImport`，其中 `mode: 'full'` 包含 LLM API 调用（auto-tag + summarize）。

| 策略 | 说明 |
|------|------|
| **串行执行** | 简单可靠，20 条约 2-5 分钟（取决于 LLM 响应速度） |
| 并发限制 | `Promise` 池 concurrency=3，加快但增加复杂度 |

**本期采用串行执行**，理由：
- 归档是后台异步操作，不阻塞用户交互
- `auto` 模式下用户无感知，`confirm` 模式下用户点"保存"后 UI 显示 spinner
- SQLite 本身是串行写入，并发收益有限

### Run 级短路

`archiveDeepSearchRun` 在归档成功后，执行 `UPDATE deepsearch_runs SET archived_at = datetime('now') WHERE id = ?`。后续的 `auto` 模式触发时，`getDeepSearchToolResult` 检测到 `run.archivedAt` 非空直接跳过，避免反复遍历 record 和 source_key 查询。

---

## 九、边界情况处理

| 场景 | 处理方式 |
|------|---------|
| run 仍在 running | 不触发归档，等 get_result 检测到终止状态 |
| record contentState 为 list_only 或 failed | 跳过，不计入 eligible，计入 skipped |
| record 有 contentArtifact 但文件已删除 | `fs.readFile` 失败 → fallback 到 snippet；snippet 也无则跳过 |
| record 仅有 snippet（< 300 字） | 使用 `mode: 'reference'` 导入，仅做 BM25 索引 |
| URL 在目标集合内已存在 | source_key 去重，跳过，计入 duplicate |
| URL 在其他集合内已存在 | 正常导入（不同集合独立管理，预期行为） |
| 知识库集合不存在 | `ensureArchiveCollection()` 自动创建 |
| pipeline 中 AI 不可用（无 provider） | BM25 基础索引仍完成；embedding/summary 标记 failed，可后续 reindex 补全 |
| confirm 模式下用户点"跳过" | localStorage 记录，下次渲染直接切换到手动按钮（状态 C） |
| auto 模式下归档失败 | 静默日志，不写 archived_at，下次 get_result 重试（幂等） |
| 同一 run 被多次 get_result 调用 | run.archivedAt 短路 + record 级 source_key 去重 |

---

## 十、不在本期实现的内容

- 用户在设置中自定义目标 collection（本期固定"联网搜索资料"）
- 知识库 UI 内按 `deepsearch` 标签过滤 + "查看"跳转
- 按 run 查看归档详情（需 run ↔ kb_item 关联表）
- 历史 runs 的批量补录脚本
- 归档进度实时推送（WebSocket / SSE）
- 并发导入优化
- URL 归一化去重（www 前缀、trailing slash、协议差异）

---

## 十一、实现顺序

1. **DB 迁移**：`migrations-lumos.ts` 新增 `archived_at` 列 + `deepsearch.ts` 映射 + 类型更新
2. **`deepsearch-importer.ts`**：核心归档逻辑，包含 `ensureArchiveCollection`、`readArtifactContent`、`extractQueryTags`、`archiveDeepSearchRun`
3. **API 端点** `save-to-library/route.ts`：调用 `archiveDeepSearchRun`，返回结果
4. **`tool-facade.ts`**：读取 `deepsearch.archive_mode`，触发 auto / 扩展返回值注入 `archivePrompt`
5. **`extractDeepSearchSources` 扩展**：额外提取 `runId` + `archivePrompt`
6. **`DeepSearchSourcesCard.tsx`**：确认 UI + 手动按钮 + 归档状态显示 + localStorage 持久化
7. **设置页 UI**：三档单选项
