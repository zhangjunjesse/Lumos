# 需求澄清卡

## 基本信息

- 模块名：Bug Triage / Bug Fix
- 当前状态：`clarifying`
- 对应 `spec` 分支：`spec/bug-triage`
- 对应 `spec` worktree：`/Users/zhangjun/私藏/lumos-worktrees/spec-bug-triage`

## 你现在已知的事

- 当前问题是什么：需要有一个独立会话专门接收、定位、澄清和推进 bug。
- 谁会受到影响：任意模块，尤其是跨模块回归、行为异常、边界条件问题。
- 当前代码大致在哪些目录：待具体 bug 决定。

## 这次要先讨论清楚什么

- [ ] bug 的复现步骤
- [ ] 预期行为和实际行为
- [ ] 影响范围
- [ ] 是否已经能直接进入修复

## 未决问题

- bug 是否稳定复现？
- 是否有日志、报错、截图、录屏或对应页面路径？
- 是单模块问题还是跨模块问题？

## 暂定方案

- 方案 A：先做 bug 澄清和复现，确认后再转正式修复任务。
- 方案 B：如果复现和边界已经很清楚，直接产出修复方案和任务卡。
- 倾向方案：默认先 triage，再决定是否转修复。

## 当前限制

- 是否允许改正式代码：默认不允许，除非 bug 已冻结成修复任务
- 是否允许写原型：按需，且只限小范围验证
- 是否允许改全局配置：不允许

## 冻结条件

- [ ] 复现路径明确
- [ ] 预期行为明确
- [ ] 影响范围明确
- [ ] 允许修改目录明确
- [ ] 验收标准明确

## 输出给开发会话的内容

- bug 描述
- 复现步骤
- 影响范围
- 允许修改目录
- 验收标准

## 本轮 Open Issues Triage（2026-03-10）

当前按 open issues 顺序先做澄清和定位，不进入正式修复。

### Issue #3

- 标题：资料库，本地文件，doc 无法索引，变成了引用型
- 信息充分度：足够进入修复设计
- bug 描述：本地导入 `.doc` 文件后，没有进入全文索引，而是退化成 reference-only。
- 复现路径：
  1. 进入资料库 `/library`
  2. 选择本地文件导入
  3. 选择 `.doc` 文件
  4. 等待后台入库完成
  5. 打开资料详情，可见 `[Reference Only]` 与 `unsupported_ext_.doc`
- 预期行为：`.doc` 文件应尽量提取正文并入库，至少应在产品层明确提示是否支持。
- 实际行为：资料被登记为引用型，`processing_error=parseError` 为 `unsupported_ext_.doc`。
- 影响范围：所有本地 `.doc` 旧版 Word 文件；在 Windows 环境影响更大，`.docx` 不受此问题直接影响。
- 最小相关代码范围：
  - `src/lib/knowledge/parsers.ts`
  - `src/lib/knowledge/ingest-worker.ts`
  - `src/app/api/knowledge/items/route.ts`
- 初步根因：
  - `.doc` 被放在 `REFERENCE_ONLY_EXTS`，不在 `FULL_PARSE_EXTS` 中。
  - 当前内建正文提取只直接支持 `.docx`；`.doc` 只能依赖 `antiword` / `catdoc` / `textutil` 这类系统工具做自适应提取。
  - 现有实现没有保证这些外部工具在目标环境中可用，因此在 Windows 上很容易直接落到 `unsupported_ext_.doc` 分支。
- 建议修复边界：
  - 只限资料库解析链路，优先看 `src/lib/knowledge/parsers.ts`
  - 不动 `package.json`、全局配置、migration
  - 先明确产品预期：是要“跨平台支持 `.doc` 正文提取”，还是“明确标记为当前不支持而不是算 bug”
- 建议下一步：
  - 如果 `.doc` 必须支持，修复应集中在解析器新增稳定的跨平台 `.doc` 提取方案
  - 如果暂不支持，应把现状收敛为显式能力边界，而不是让用户误以为已入库成功

### Issue #4

- 标题：资料库，选择飞书文档，索引，有概述内容，但状态是处理失败
- 信息充分度：足够进入修复设计
- bug 描述：飞书文档导入后，详情面板已有“索引概述”，但状态标签仍显示“处理失败”。
- 复现路径：
  1. 进入资料库 `/library`
  2. 在飞书导入入口中选择单个飞书文档
  3. 触发导入并等待后台入库
  4. 打开该资料详情
  5. 可见 summary 已生成，但状态仍为 `failed`
- 预期行为：如果已经有可用概述与可检索内容，状态应与处理阶段一致，至少不应继续显示“处理失败”。
- 实际行为：
  - summary 与 failed status 同时出现，状态与内容可用性不一致
  - 详情区展示的是通用文案 `处理失败，建议检查格式或重新导入`
  - 手动执行一次“重建索引”后仍保持相同现象
- 影响范围：飞书文档导入链路；若根因在状态汇总逻辑，也可能影响其他“有摘要但状态异常”的资料类型。
- 最小相关代码范围：
  - `src/components/knowledge/library-import-panel.tsx`
  - `src/app/api/feishu/docs/attach/route.ts`
  - `src/app/api/knowledge/items/route.ts`
  - `src/lib/knowledge/importer.ts`
  - `src/lib/knowledge/bm25.ts`
  - `src/app/library-demo/page.tsx`
- 当前定位思路：
  - 飞书文档导入实际会先导出为本地 `.md`，再走资料库单文件异步入库队列。
  - UI 详情页的状态来自 `processing_status`，概述来自 `summary`；这两者不是同一个字段。
  - 由于是单个飞书文档、且重建索引后仍稳定复现，现象更像“状态判定与 summary 落库不同步”，不是单纯的展示文案问题。
- 可能根因（按优先级）：
  - 高概率是 `processImport()` / `reindex` 中的 BM25 阶段异常：代码会把 `bm25` 记为 `failed`，但仍继续执行 embedding 和 summary，所以最终会出现“有概述但状态失败”
  - BM25 失败原因当前没有被持久化，UI 只能显示通用失败文案，看不到真实错误文本
  - 推断的一个具体触发点是 `src/lib/knowledge/bm25.ts` 对 `@node-rs/jieba` 词典路径的运行时假设较强，Electron/打包环境下可能抛异常；这一点还需要日志验证
  - “旧 summary 没清空”现在是次级可能性，因为你确认重建索引后仍稳定复现
- 建议修复边界：
  - 只限飞书导入到资料库的状态收敛逻辑、BM25 阶段错误透出、资料详情展示逻辑
  - 不扩展到聊天、全局设置、数据库结构改动
- 建议下一步：
  - 正式修复前，优先在导入/重建索引链路里打印并保留 BM25 阶段真实异常
  - 修复目标应包含两点：一是解决真正的索引失败点，二是避免“失败状态与可用概述并存”这类状态失真

### Issue #5

- 标题：资料库，飞书文档，pdf 无法索引
- 信息充分度：足够进入修复设计
- bug 描述：飞书文件中的 PDF 下载到本地后进入资料库，解析时报错 `DOMMatrix is not defined`，无法完成全文索引。
- 复现路径：
  1. 进入资料库 `/library`
  2. 在飞书导入入口选择一个 PDF 文件
  3. 系统先下载该文件到 `.lumos-uploads/feishu-files`
  4. 后台入库时进入 PDF 解析
  5. 详情面板显示 `DOMMatrix is not defined`
- 预期行为：PDF 应被解析并建立索引，至少不应在服务端因浏览器 API 缺失而失败。
- 实际行为：PDF 解析失败，资料无法正常完成索引。
- 影响范围：
  - 所有通过资料库解析链路进入的 PDF 都可能受影响，不只飞书 PDF
  - 在缺少 `pdftotext` 的环境下更容易触发，Windows 风险最高
- 最小相关代码范围：
  - `src/app/api/feishu/drive/download/route.ts`
  - `src/lib/knowledge/parsers.ts`
  - `src/lib/knowledge/ingest-worker.ts`
- 初步根因：
  - 飞书 PDF 最终还是走通用 `parsePdf()` 路径，不是飞书接口自身问题。
  - `parsePdf()` 先尝试系统命令 `pdftotext`，失败后回退到 `pdf-parse`。
  - 当前依赖组合里，`pdf-parse` 的底层运行链在 Node 侧触发了 `DOMMatrix` 缺失，代码里没有做 polyfill 或兼容分支。
- 建议修复边界：
  - 只限 PDF 解析器初始化与回退策略，重点看 `src/lib/knowledge/parsers.ts`
  - 不需要改导入协议、包管理文件、全局配置
- 建议下一步：
  - 先把 PDF 解析路径稳定下来，再决定是否补充更清晰的失败提示
  - 修复完成后要同时验证本地 PDF 与飞书 PDF，两条入口共用同一解析链

### Issue #6

- 标题：项目-会话-右侧预览标签区域，飞书标签，不应该展示飞书应用配置
- 信息充分度：足够进入修复设计
- bug 描述：项目/会话右侧内容面板中的飞书标签页，除了文档列表，还直接展示了飞书应用配置卡片。
- 复现路径：
  1. 打开项目或会话页面
  2. 在右侧内容面板新增或切换到“飞书”标签
  3. 进入飞书标签页
  4. 可见文档面板顶部直接出现“飞书应用配置”
- 预期行为：该标签页应聚焦“飞书文档浏览 / 预览 / 加入会话 / 加入资料库”；应用配置应放到设置页或单独入口。
- 实际行为：`FeishuConfigCard` 被直接渲染到飞书文档面板正文中。
- 影响范围：所有右侧内容面板中的飞书标签页；属于稳定可复现的 UI/信息架构问题。
- 最小相关代码范围：
  - `src/components/layout/ContentRenderer.tsx`
  - `src/components/feishu/FeishuPanel.tsx`
- 初步根因：
  - `ContentRenderer` 对 `feishu-doc` 标签直接渲染 `FeishuPanel`
  - `FeishuPanel` 内部无条件渲染了 `<FeishuConfigCard />`
  - 因此配置卡不是误注入，而是组件职责混在了一起
- 建议修复边界：
  - 只限右侧飞书面板的组件拆分与展示条件
  - 不涉及后端 API、资料库链路、全局设置结构
- 建议下一步：
  - 把配置入口从主面板正文移走，或至少改为折叠/仅未配置时展示
  - 修复时同时确认 `extensions/page.tsx` 里的飞书面板是否也要保持一致
