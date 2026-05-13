# 内置应用：抖音采集器（Douyin Collector）

**状态**：核心闭环 + 全套 UI 反复打磨（单词关键词走 hashtag SSR；多词关键词搜索仍需 X-Bogus 签名）
**类型**：内置级应用（Lumos native app）
**目录**：`src/components/apps/builtin/douyin-collector` + `src/app/api/apps/builtin/douyin-collector` + `resources/mcp-servers/douyin-collector` + `src/lib/douyin-collector`

---

## 产品定位

**一句话**：把抖音从"刷视频"工具变成"知识素材源"。围绕**博主 / 关键词 / 链接**三种入口采集视频，自动抓字幕（必要时转写），整理成可回看、可搜索、可入知识库的资料卡片。

**与微信助手 / 闲鱼助手的并列差异**

| 维度 | 微信助手 | 闲鱼助手 | 抖音采集器 |
|---|---|---|---|
| 主资源 | 本机微信消息 | 闲鱼商品/会话 | 抖音视频（公开） |
| 核心动作 | 提炼今日重点 | AI 草稿 / 自动回复 | 采集 → 转写 → 入库 |
| 资料对象 | 人 / 会话 | 商品 / 订单 | 创作者 / 视频 / 字幕 |
| 写操作 | 几乎只读 | 有外发，须草稿确认 | **纯只读**，仅写本地资料库 |
| 风险面 | 个人聊天合规 | 外发风控 | Cookie 风控 + 字幕版权 |

---

## 核心场景

1. **博主巡更**：固定关注 5–20 位博主，每日抓增量；新视频自动转写、入库、打标签。
2. **关键词调研**：临时主题（如"Claude API 实战"），按热度/时间窗采集 50–100 条；摘要后人工筛选保留哪些。
3. **单条精读**：粘贴抖音链接，立即抓字幕、做要点摘要、AI 问答。
4. **长视频学习**：30 分钟教程/直播切片 → 分段转写 → 章节切分 → 按章节入库。

---

## 信息架构（主页 Tab）

```
[ Hero 区：当前 Cookie 状态 / 待整理数 / 今日新增 ]
[ SetupBanner：未配置时显示登录入口 ]

Tabs（顶部）：
  ├─ 概况          KPI 卡 + 最近采集 + 资料库映射
  ├─ 采集任务       博主 / 关键词 / 链接三列；每列内是 job 卡片
  ├─ 资料库        视频卡片网格；筛选：标签/创作者/状态/时长/语言
  ├─ 整理（详情）   单卡片：播放器 + 字幕 + AI 摘要 + 标签编辑 + 入库按钮
  ├─ 自动化        定时巡更博主 / 关键词跑批
  ├─ 通知/命令     IM 告警渠道 + /app douyin-collector ... 命令
  └─ 设置          Cookie / 转写策略 / AI 提示词 / 入库目标 collection / 风险边界

底部 BottomChatPanel：与 AI 对话（基于已采集语料 + 当前选中视频）
```

---

## 状态契约（status.states）

```
not_configured  ── 没配置 Cookie，也没配置入库 collection
needs_auth      ── Cookie 存在但已失效 / 命中风控
ready           ── 可采集，无活跃 job
syncing         ── 正在跑采集 / 转写 / 入库 job
failed          ── 最近一次跑失败，详见 run_history.failure_reason
```

UI 必须把 `needs_auth` / `failed` 在 Hero / SetupBanner 上明确暴露，不能用 mock 假装 ready。

---

## 风险边界（必须在「设置 → 风险边界」页可见）

**默认行为**
- 仅读公开视频元数据 / 字幕 / 封面；**不下载视频文件用作分发**。
- 字幕优先级：抖音原生字幕 → 抖音 ASR → Lumos speech-to-text 兜底；ASR 用临时音频缓存，转写后立即清理。
- 入库默认 **草稿态**，必须用户确认；批量入库前要二次确认。
- 触发风控时立即停止后续 job，状态设为 `needs_auth` 并显示具体原因。

**out-of-scope（不实现）**
- 发评论 / 点赞 / 私信 / 关注（写社交动作一律拒绝）。
- 批量下载视频原文件 / 离线发行。
- 绕过抖音风控（验证码自动破解、IP 池、模拟点击量等）。
- 商业用途的字幕/内容再分发；用户对自己抓取的内容用途负责。

---

## 数据模型（data-schema.json 关键集合）

通用集合（所有内置级应用必须有）：
`app_settings` / `app_automations` / `run_history` / `assistant_messages` / `app_notifications` / `app_command_runs` / `acceptance_checks`

业务集合：

| 集合 | 说明 | 关键字段 |
|---|---|---|
| `creators` | 关注的博主 | `secUid`, `uid`, `nickname`, `avatar`, `followCount`, `lastCheckedAt`, `cadence` |
| `keywords` | 关键词订阅 | `query`, `timeWindow`, `dedupeWindow`, `lastCheckedAt`, `cadence` |
| `collect_jobs` | 采集任务实例 | `kind`(creator/keyword/link), `targetRef`, `status`, `startedAt`, `endedAt`, `failureReason`, `discoveredCount` |
| `videos` | 已采集视频卡片 | `awemeId`, `creatorRef`, `title`, `cover`, `duration`, `durationBucket`, `language`, `subtitleSource`, `transcriptStatus`, `summary`, `tags[]`, `chapters[]`, `library_status`, `library_collection_id`, `notes` |
| `transcripts` | 字幕 / 转写 | `videoRef`, `lang`, `source`(native/asr-douyin/asr-local), `segments[]`, `confidence`, `wordCount` |
| `library_links` | 视频 → knowledge | `videoRef`, `collectionId`, `chunkId`, `pushedAt`, `version` |

`videos.library_status` 取值：`unprocessed` / `draft` / `published` / `discarded`。

---

## 长视频字幕 / 转写管线

```
get_subtitle(video):
  1. 试 native:    抖音返回的 webvtt URL （免费、即时）
       ✅ 有 → 落 transcripts(source='native')，结束
  2. 试 asr-douyin: 抖音内部 ASR API（如可达）
       ✅ 有 → 落 transcripts(source='asr-douyin')
  3. 兜底 asr-local: 拉音频 → 分段（10min/段，最多 4 路并发）→ speech-to-text MCP
       ✅ 转写成功 → 拼接 → confidence 校验 → 落 transcripts(source='asr-local')
       ❌ 失败 → run_history.failure_reason = "ASR failed: <reason>"，video 状态保持 unprocessed
```

30 分钟视频默认上限：分 3 段，并发 3，每段 10 分钟。失败可单段重试，不必整段重跑。

---

## 与现有 Lumos 模块的连接

| 依赖 | 用法 |
|---|---|
| `BrowserManager` (Electron) | Cookie 抓取（**仅** Cookie 粘贴 + 后台校验，不打扰用户当前 tab） |
| `mcp-servers/speech-to-text` | ASR 兜底转写 |
| `lib/knowledge` | 入库目标 collection；新增条目走标准 chunking |
| `lib/scheduler` | 自动化巡更（cron 触发 collect_job） |
| `lib/im` | IM 通知 / `/app douyin-collector` 命令 |
| `lib/app/native-*` | 自检 / spec / 安装门禁通用栈 |

---

## 实现状态

每个能力在数据库 / API / UI 三层都落地，TS 0 错、jest 守约、`validate:native-app` 0 错。
仍 stub 的部分明确暴露 `not_connected` + 具体原因，不冒充完成。

### 已实现 ✅

| 能力 | 关键文件 |
|---|---|
| 单条 / 短链 / aweme_id 采集 | `lib/douyin-collector/scraper.ts` · `parse-input.ts` |
| 博主主页采集（cadence-aware 巡更） | `scraper.ts:fetchCreatorVideos` · `patrol.ts` |
| 关键词手动 ingest（绕开签名）| `keyword-ingest.ts` |
| 字幕：原生 VTT/JSON | `transcript-fetcher.ts` |
| 字幕：Lumos 语音 ASR 兜底 | `transcribe.ts:fallbackToLocalAsr` → `/api/speech/transcribe` |
| AI 摘要 / 章节 / 标签 | `ai-summary.ts`（Zod schema 走 `generateObjectFromProvider`）|
| 知识库幂等入库 | `publish.ts`（aweme_id → `kb_items.source_key`）|
| 自动化 cron 真触发 | `native-automation-runner.ts` 加 douyin 分支 → `patrol.ts` |
| 全自动级联 | `transcribe.ts:maybeAutoPublish`（autoSummarize → publish） |
| 资料库搜索 / 排序 / 标签筛选 | `videos/route.ts` · `LibraryTab.tsx` |
| 4 个批量操作（抓字幕 / 重跑失败 / AI 摘要 / 入库） | `videos/bulk-*` endpoints |
| Markdown + JSON 导出 | `export.ts:exportLibraryAsMarkdown / exportLibraryAsJson` |
| 每博主 / 每关键词 stats | `storage.ts:statsByCreator / statsByKeyword` |
| 资料库主题分布（Hot 标签云）| `storage.ts:topTags` · `HotTagsPanel.tsx` |
| 相关视频聚合（共享标签）| `storage.ts:findRelatedVideos` · `RelatedVideos.tsx` |
| AI 讨论（视频字幕作为 system prompt）| `videos/[id]/discuss/route.ts` |
| 「继续讨论」记忆 | videos schema: `last_discuss_session_id` |
| Cookie 健康探测 | `auth/test-cookie/route.ts` |
| 起步清单 | `SetupChecklist.tsx` |
| 失败信号融合（collect_jobs ∪ run_history） | `storage.ts:countQueue` |
| 封面懒加载 + onError 兜底 | `VideoCover.tsx` |
| 标题 / 封面 → 在抖音打开原视频 | VideoCard / OrganizeTab 直接锚链 |
| 巡更致命错误短路（cookie/风控/HTTP 4xx 命中后跳过剩余） | `patrol.ts:isFatalReason` |
| 自动管线：采集 → 字幕 → 摘要 → 入库 全链开关（autoTranscribe） | `auto-pipeline.ts` · `LibrarySection.tsx` |
| 重采保留用户数据：transcript / summary / tags / notes / starred 不会被巡更覆盖 | `jobs.ts:upsertVideoFromScrape` |
| 资料库 backlog chips 6 维度（待抓字幕 / 抓字幕失败 / 待 AI 摘要 / 可入库 / 本周新增 / 已加星） | `BacklogChips.tsx` · `storage.ts:countLibraryBacklog` |
| 概况页待办网格（点击即跳转） + 动态速报 + 继续讨论入口 | `BacklogActionGrid.tsx` · `PatrolDigest.tsx` · `RecentDiscussionsPanel.tsx` |
| 字幕全文搜索 + 命中片段高亮 | `storage.ts:findTranscriptSnippets` · `VideoCard.tsx` |
| 字幕面板内嵌搜索（30m 长视频内查找） | `TranscriptPanel.tsx` |
| 用户加星 + 备注（脱离 AI 视角的私域字段） | videos schema + `OrganizeTab.tsx` |
| 失败原因 inline 上墙（玫瑰红块） + 失败 backlog chip | `VideoCard.tsx` · `BacklogChips.tsx` |
| 标签自动建议（点击追加，去重，全角分隔符） | `tag-helpers.ts:appendTag` · OrganizeTab 推荐 strip |
| 丢弃可逆 + 批量丢弃 / 恢复（AlertDialog 二次确认） | `videos/bulk-status` · `LibraryTab.tsx` |
| 博主 / 关键词筛选 chip + clear-all 一键重置 | `LibraryTab.tsx` · `library-filter-helpers.ts` |
| 跨 tab 导航（CreatorSection → Library 直筛） | `DouyinCollectorApp.tsx:requestLibraryCreator` |
| 博主 / 关键词质量分级 pill（emerald/amber/rose 三色） | `creator-quality.ts` · `QualityPill.tsx` |
| Hero 健康信号：Cookie 寿命（>36h amber）+ 巡更陈旧（>36h amber）| `DouyinHero.tsx:relativeAge` |
| Cookie 自动探测（patrol 触发 1h 冷却） | `cookie-probe.ts:runScheduledCookieProbe` |
| 整理完整度 4/4 徽章（字幕/摘要/标签/备注） | `curation.ts` · `OrganizeTab.tsx:CurationBadge` |
| 单词关键词 hashtag SSR 抓取（Round 116） | `scraper.ts:fetchHashtagVideos` · `jobs.ts:runKeywordJob` |
| 「立即巡更」按钮 + 8s 自动消失反馈 | `library/run-patrol/route.ts` · `OverviewTab.tsx` |
| 5 种排序（newest/oldest/longest/starred/curated） | `sort-helpers.ts` |
| Library 视图 localStorage 持久化 + 「已恢复上次筛选」提示 | `library-view-storage.ts` |
| ⌘K 聚焦搜索 / Esc 清空 + 键帽提示 | `LibraryTab.tsx` keyboard shortcut effect |
| Anki TSV / CSV 导出格式 + 下拉合并菜单 | `export.ts:exportLibraryAsAnki/Csv` · `LibraryTab.tsx:ExportMenu` |
| 标签合并 / 重命名工具 + 跨 tab 自动刷新 | `tag-rename.ts` · `events.ts:DOUYIN_TAGS_CHANGED` |
| Hero 健康面板（Cookie 寿命 + 巡更陈旧 + 上次入库） | `DouyinHero.tsx:relativeAge` |

### 仍 stub ⏳

| 能力 | 阻塞原因 |
|---|---|
| 多词关键词搜索（task #7 第二阶段） | 抖音 search API 需要 X-Bogus 签名；单词关键词已走 hashtag SSR（Round 116），多词仍 stub |
| 翻页 / 全量历史 | hashtag SSR 只返第一屏；翻页需要签名调 search 接口 |

### 设计但未实装（远期）

- 长视频 ASR 分段并发（当前一次整段 ASR，可用但未按 `transcribeConcurrency` 切片）
- 跨平台对照（bilibili / 小红书 / etc.）
- 学习模式：spaced repetition / 知识卡片复习

---

## 文件总览

```
src/lib/douyin-collector/
  ├─ constants.ts          # collection 名 + 枚举常量
  ├─ types.ts              # CreatorRecord / KeywordRecord / JobRecord 等
  ├─ parsers.ts            # parseVideoTags / parseVideoChapters / parseTranscriptText
  ├─ parse-input.ts        # 解析 sec_uid / 短链 / 视频 URL
  ├─ scraper.ts            # 抓 share 页 + RENDER_DATA 解析（视频 + 博主）
  ├─ transcript-fetcher.ts # VTT / JSON / plain 字幕解析
  ├─ transcribe.ts         # native + ASR 兜底 + autoSummarize 级联
  ├─ ai-summary.ts         # Zod schema + 调 LLM
  ├─ publish.ts            # 写 kb_items + library_links（幂等）
  ├─ keyword-ingest.ts     # 手动 ingest URL 列表
  ├─ jobs.ts               # createJob / runJob (creator/keyword/link) + 触发 auto-pipeline
  ├─ patrol.ts             # cadence-aware 自动巡更 + fatal-reason 短路 + cookie 预探测
  ├─ auto-pipeline.ts      # 采集成功后链式跑 transcribe（autoTranscribe 设置）
  ├─ cookie-probe.ts       # probeCookie + runScheduledCookieProbe (1h 冷却)
  ├─ storage.ts            # 集中查询 + backlog + digest + recent discussions + transcript snippets + stats
  ├─ creator-quality.ts    # 入库率 → 高/中/低 三档分级（≥5 样本门槛）
  ├─ curation.ts           # 整理完整度 4 维度评分（字幕/摘要/标签/备注）
  ├─ library-filter-helpers.ts # countActiveFilters（驱动「重置全部 (N)」按钮）
  ├─ tag-helpers.ts        # appendTag（去重追加、全角兼容）
  ├─ settings.ts           # 全局设置（cookie / 转写策略 / 提示词 / auto* 三档开关）
  └─ export.ts             # MD / JSON 导出

src/app/api/apps/builtin/douyin-collector/
  ├─ status              · creators[/[id], /stats]
  ├─ keywords[/[id], /stats, /[id]/ingest]
  ├─ jobs[/[id]]
  ├─ videos[/[id], /[id]/{transcribe,publish,summarize,discuss,transcript,related}]
  ├─ videos/{export,bulk-transcribe,bulk-summarize,bulk-publish,bulk-status,discuss-multi}
  ├─ library/{top-tags,backlog,digest,recent-discussions}
  ├─ settings
  ├─ auth/test-cookie
  └─ mcp/{search-creator,search-keyword,video-detail,subtitle}

src/components/apps/builtin/douyin-collector/
  ├─ DouyinCollectorApp.tsx        # 跨 tab 跳转 lifting state（tag / backlog / creator）
  ├─ DouyinHero.tsx                # phase + 订阅数 + 资料数 + 巡更/Cookie 健康
  ├─ tabs/{Overview,Collect,Library,Organize,Automations,Im,Settings}.tsx
  ├─ tabs/collect/{CreatorSection,KeywordSection,QuickLinkSection,RecentJobsPanel}.tsx
  ├─ tabs/settings/{Section,CookieSection,TranscribeSection,LibrarySection,PromptsSection}.tsx
  ├─ use-{douyin-status,collect-sources,collector-settings,jobs,videos,
  │       app-data,activity-digest,library-backlog,top-tags}.ts
  └─ components/{VideoCard,VideoCover,TranscriptPanel,RelatedVideos,
                 HotTagsPanel,RecentRunsPanel,SetupChecklist,
                 BacklogChips,BacklogActionGrid,PatrolDigest,
                 RecentDiscussionsPanel,QualityPill}.tsx

resources/mcp-servers/douyin-collector/collector_mcp.mjs   # stdio MCP, 5 工具
public/mcp-servers/douyin-collector.json                    # MCP 注册文件
```

---

## 验收 / 守护

- 单元测试：`npx jest src/lib/douyin-collector/__tests__/ src/components/apps/builtin/douyin-collector/__tests__/`（目前 221 个）
- TS 检查：`npx tsc --noEmit`
- native-app 校验：`npm run validate:native-app -- <staging-dir>`（生成 staging 见 `init-builtin-resources.ts`）
- MCP smoke：`echo '{...initialize...}\n{...tools/list...}' | node resources/mcp-servers/douyin-collector/collector_mcp.mjs`

每次代码改动需保证：
- TS 0 错
- 已有 jest 测试不回归
- validator 0 错 0 警
- UI 缺底层能力时显示 `not_connected / 需授权 / 失败原因`，绝不冒充完成
