/**
 * Data shapes (collections + pages) for the Deep Research built-in app.
 * Kept in a separate module so `template-deep-research.ts` stays under
 * the project's 300-line per-file guideline.
 *
 * Pages here are minimal — they exist to satisfy the manifest validator
 * (each page must include a `layout` and only valid widgets per
 * `resources/app-schemas/page.schema.json`). The actual UI is taken over
 * by `src/components/apps/builtin/deep-research/DeepResearchApp.tsx`,
 * matching the Douyin Collector pattern.
 */

export const DEEP_RESEARCH_DEFAULT_SYSTEM_PROMPT = [
  '你是 Lumos「深度调研」应用内置的资深研究编辑。你必须按下面 SOP 八阶段推进，每个阶段都要',
  '把证据 / 决策 / 失败原因写入对应集合，并在 UI 上让用户看到，绝不能跳跃。',
  '',
  'SOP（state machine）：clarifying → goal_review → planning → risk_review → collecting →',
  'synthesizing → outline_review → drafting → qa → delivered。',
  '',
  '1. clarifying：和用户多轮对话，把读者、用途、范围（包含 / 不包含）、深度、长度、语言、',
  '   语气、审美样章风格、交付 deadline 全部明确；信息不完整时继续追问，禁止臆测。',
  '2. goal_review：产出 SMART 目标书（含成功标准、out-of-scope、deadline）；等待用户「接受」按钮才推进。',
  '3. planning：把目标拆为研究问题树，≤8 个顶级问题；每题必带子问题、关键证据需求、',
  '   验证标准（要看到什么证据才算回答了）。',
  '4. risk_review：列出 ≥3 项风险（资料稀缺 / 付费墙 / 敏感话题 / 时效 / 语言 / 配额），',
  '   每项给出降级方案；写入 research_risks。',
  '5. collecting：对每个研究问题选择来源（deepsearch 公网 / 知乎 / 微信公众号 / 抖音 /',
  '   bilibili / 知识库），并发采集，每条证据必须含来源 URL、摘要、置信度（high|medium|low）',
  '   和创建时间；触发任何风控 / 配额耗尽 / 站点失效时立即停止后续并写入风险登记册，不',
  '   绕过任何风控。',
  '6. synthesizing：对每个问题汇总证据写出 finding；证据条数 < 阈值（默认 3 条 / 不同来源）时',
  '   标 needs_more_evidence，不冒充完成。',
  '7. outline_review：先写报告大纲（章节标题 + 每章要回答的研究问题 + 关键证据 id），',
  '   等待用户「接受」按钮才进入章节草稿。',
  '8. drafting / qa：分章节流式生成草稿，每段引用 evidence_id；终稿写入后跑自检（',
  '   引用完整性、未决问题清单、长度、问题树覆盖度），不通过时回到 collecting 或 synthesizing。',
  '',
  '强约束：',
  '- 写知识库 / 发外部消息 / 一次性推进多阶段都必须先草稿后用户确认。',
  '- 任何阶段失败显示真实 failure_reason，不要用 mock 数据补齐报告。',
  '- 报告语气和长度必须匹配设置中的「审美样章风格」与「默认报告长度」。',
  '- 引用必须能链回到 research_evidence 表的具体 id 和 url，不允许凭印象编造引用。',
].join('\n');

export function buildDeepResearchCollections(): unknown[] {
  return [
    researchTasks(),
    researchBriefs(),
    researchGoals(),
    researchQuestions(),
    researchRisks(),
    researchSources(),
    researchEvidence(),
    researchFindings(),
    researchReports(),
    researchQaChecks(),
  ];
}

function researchTasks() {
  return {
    name: 'research_tasks',
    label: '调研任务',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'title', type: 'string', label: '主题', required: true, indexed: true },
      { name: 'audience', type: 'string', label: '读者' },
      { name: 'purpose', type: 'string', label: '用途' },
      {
        name: 'style',
        type: 'enum',
        label: '审美样章风格',
        options: ['克制学术', '行业研究', '投资人友好', '中文长文', '简报', '自定义'],
        default: '行业研究',
        indexed: true,
      },
      { name: 'language', type: 'string', label: '语言', default: 'zh-CN' },
      { name: 'length_target', type: 'string', label: '长度目标', default: '5000-8000 字' },
      { name: 'deadline', type: 'datetime', label: '交付截止' },
      {
        name: 'stage',
        type: 'enum',
        label: 'SOP 阶段',
        options: [
          'clarifying',
          'goal_review',
          'planning',
          'risk_review',
          'collecting',
          'synthesizing',
          'outline_review',
          'drafting',
          'qa',
          'delivered',
          'blocked',
        ],
        default: 'clarifying',
        required: true,
        indexed: true,
      },
      {
        name: 'status',
        type: 'enum',
        label: '运行状态',
        options: ['active', 'paused', 'failed', 'delivered', 'cancelled'],
        default: 'active',
        indexed: true,
      },
      { name: 'blocking_reason', type: 'text', label: '阻塞原因' },
      { name: 'last_advance_at', type: 'datetime', label: '最近推进时间', indexed: true },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['stage'], ['status'], ['updated_at'], ['style']],
  };
}

function researchBriefs() {
  return {
    name: 'research_briefs',
    label: '需求澄清产出',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'audience', type: 'text', label: '读者画像' },
      { name: 'purpose', type: 'text', label: '使用场景与决策' },
      { name: 'scope_in', type: 'text', label: '包含范围' },
      { name: 'scope_out', type: 'text', label: '不包含范围' },
      { name: 'depth_target', type: 'text', label: '深度要求' },
      { name: 'tone', type: 'text', label: '语气样章参考' },
      { name: 'open_questions', type: 'text', label: '未澄清问题（JSON 数组）' },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['drafting', 'pending_user_accept', 'accepted', 'rejected'],
        default: 'drafting',
        indexed: true,
      },
      { name: 'accepted_at', type: 'datetime', label: '用户接受时间' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['status']],
  };
}

function researchGoals() {
  return {
    name: 'research_goals',
    label: '目标书',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'smart_goal', type: 'text', label: 'SMART 目标' },
      { name: 'success_criteria', type: 'text', label: '成功标准（JSON 数组）' },
      { name: 'out_of_scope', type: 'text', label: '明确不做（JSON 数组）' },
      { name: 'deliverables', type: 'text', label: '交付物清单（JSON 数组）' },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['drafting', 'pending_user_accept', 'accepted', 'rejected'],
        default: 'drafting',
        indexed: true,
      },
      { name: 'accepted_at', type: 'datetime', label: '用户接受时间' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['status']],
  };
}

function researchQuestions() {
  return {
    name: 'research_questions',
    label: '研究问题树',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'parent_ref', type: 'string', label: '父问题 ID', indexed: true },
      { name: 'order_index', type: 'integer', label: '排序', default: 0 },
      { name: 'question', type: 'text', label: '问题', required: true },
      { name: 'evidence_requirements', type: 'text', label: '关键证据需求' },
      { name: 'verification_criteria', type: 'text', label: '验证标准' },
      { name: 'evidence_target_count', type: 'integer', label: '目标证据条数', default: 3 },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['draft', 'collecting', 'needs_more_evidence', 'synthesized', 'blocked'],
        default: 'draft',
        indexed: true,
      },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['parent_ref'], ['status'], ['order_index']],
  };
}

function researchRisks() {
  return {
    name: 'research_risks',
    label: '难度与风险登记',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      {
        name: 'category',
        type: 'enum',
        label: '风险类别',
        options: ['data_scarcity', 'paywall', 'sensitive_topic', 'staleness', 'language', 'quota', 'compliance', 'other'],
        required: true,
        indexed: true,
      },
      { name: 'description', type: 'text', label: '说明', required: true },
      {
        name: 'severity',
        type: 'enum',
        label: '严重度',
        options: ['low', 'medium', 'high', 'critical'],
        default: 'medium',
        indexed: true,
      },
      { name: 'mitigation', type: 'text', label: '降级方案' },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['open', 'mitigated', 'accepted', 'blocked'],
        default: 'open',
        indexed: true,
      },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['category'], ['severity'], ['status']],
  };
}

function researchSources() {
  return {
    name: 'research_sources',
    label: '采集来源订阅',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      {
        name: 'kind',
        type: 'enum',
        label: '来源类型',
        options: ['deepsearch', 'douyin_creator', 'douyin_keyword', 'bilibili', 'knowledge_collection', 'manual_url', 'mcp'],
        required: true,
        indexed: true,
      },
      { name: 'target', type: 'string', label: '目标（URL / 关键词 / collection id）', required: true, indexed: true },
      { name: 'config', type: 'text', label: '配置（JSON 对象）' },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['not_connected', 'ready', 'syncing', 'success', 'failed', 'paused'],
        default: 'not_connected',
        indexed: true,
      },
      { name: 'last_run_at', type: 'datetime', label: '最近采集' },
      { name: 'last_failure_reason', type: 'text', label: '失败原因' },
      { name: 'discovered_count', type: 'integer', label: '发现条数', default: 0 },
      { name: 'enabled', type: 'boolean', label: '启用', default: true, indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['kind'], ['status'], ['enabled']],
  };
}

function researchEvidence() {
  return {
    name: 'research_evidence',
    label: '证据片段',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'question_ref', type: 'string', label: '研究问题 ID', indexed: true },
      { name: 'source_ref', type: 'string', label: '来源 ID', indexed: true },
      {
        name: 'source_kind',
        type: 'enum',
        label: '来源类型',
        options: ['deepsearch', 'douyin', 'bilibili', 'knowledge', 'manual_url', 'mcp'],
        required: true,
        indexed: true,
      },
      { name: 'url', type: 'string', label: '原文 URL', indexed: true },
      { name: 'title', type: 'string', label: '标题' },
      { name: 'author', type: 'string', label: '作者 / 创作者' },
      { name: 'published_at', type: 'datetime', label: '原文发表时间' },
      { name: 'snippet', type: 'text', label: '证据片段', required: true },
      {
        name: 'confidence',
        type: 'enum',
        label: '置信度',
        options: ['low', 'medium', 'high'],
        default: 'medium',
        indexed: true,
      },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['collected', 'dedup_pending', 'duplicate', 'used', 'discarded'],
        default: 'collected',
        indexed: true,
      },
      { name: 'dedup_hash', type: 'string', label: '去重哈希', indexed: true },
      { name: 'collected_at', type: 'datetime', label: '采集时间', indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [
      ['task_ref'],
      ['question_ref'],
      ['source_kind'],
      ['status'],
      ['confidence'],
      ['dedup_hash'],
    ],
  };
}

function researchFindings() {
  return {
    name: 'research_findings',
    label: '研究问题综合答案',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'question_ref', type: 'string', label: '研究问题 ID', required: true, indexed: true },
      { name: 'answer', type: 'text', label: '综合答案', required: true },
      { name: 'evidence_ids', type: 'text', label: '引用证据 ID（JSON 数组）' },
      { name: 'open_questions', type: 'text', label: '未决问题（JSON 数组）' },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['drafting', 'needs_more_evidence', 'synthesized', 'used_in_report'],
        default: 'drafting',
        indexed: true,
      },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['question_ref'], ['status']],
  };
}

function researchReports() {
  return {
    name: 'research_reports',
    label: '报告',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'version', type: 'integer', label: '版本', default: 1, indexed: true },
      {
        name: 'kind',
        type: 'enum',
        label: '类型',
        options: ['outline', 'section_draft', 'full_draft', 'final'],
        required: true,
        indexed: true,
      },
      { name: 'title', type: 'string', label: '标题' },
      { name: 'content_md', type: 'text', label: 'Markdown 内容' },
      { name: 'sections_json', type: 'text', label: '章节结构（JSON）' },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['drafting', 'pending_user_accept', 'accepted', 'rejected', 'qa_failed'],
        default: 'drafting',
        indexed: true,
      },
      { name: 'qa_summary', type: 'text', label: '自检摘要' },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['kind'], ['version'], ['status']],
  };
}

function researchQaChecks() {
  return {
    name: 'research_qa_checks',
    label: '自检验收',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'task_ref', type: 'string', label: '任务 ID', required: true, indexed: true },
      { name: 'report_ref', type: 'string', label: '报告 ID', indexed: true },
      {
        name: 'check_type',
        type: 'enum',
        label: '检查项',
        options: ['citation_integrity', 'open_questions', 'length', 'tree_coverage', 'style_match', 'sensitive_review'],
        required: true,
        indexed: true,
      },
      {
        name: 'result',
        type: 'enum',
        label: '结果',
        options: ['pass', 'warn', 'fail'],
        default: 'warn',
        indexed: true,
      },
      { name: 'details', type: 'text', label: '说明' },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['task_ref'], ['report_ref'], ['check_type'], ['result']],
  };
}

export function buildDeepResearchPages(): Record<string, unknown> {
  const placeholder = (title: string, summary: string) => ({
    title,
    layout: 'single' as const,
    blocks: [{ type: 'markdown' as const, content: summary }],
  });
  return {
    'pages/tasks.json': placeholder(
      '调研任务',
      [
        '- 这里列出所有调研任务的主题、SOP 阶段、阻塞原因和最近推进时间。',
        '- 新建任务时必须填写主题、读者、用途、审美样章风格；进入需求澄清后才能推进。',
        '- 所有阶段都按 clarifying → goal_review → planning → risk_review → collecting → synthesizing → outline_review → drafting → qa → delivered 严格推进，不跳跃。',
      ].join('\n'),
    ),
    'pages/clarify.json': placeholder(
      '需求澄清',
      '与 AI 多轮对话，明确读者 / 用途 / 范围 / 深度 / 长度 / 语气 / 审美样章；澄清未完成不进入下一阶段。',
    ),
    'pages/goal.json': placeholder(
      '目标书',
      'SMART 目标书 + 成功标准 + 明确不做；用户接受后才进入任务拆解。',
    ),
    'pages/plan.json': placeholder(
      '研究问题树',
      '≤8 顶级研究问题，每题含子问题、证据需求与验证标准；可手动增删改并重新平衡。',
    ),
    'pages/risk.json': placeholder(
      '难度与风险',
      '列出资料稀缺 / 付费墙 / 敏感话题 / 时效 / 语言 / 配额耗尽等风险与降级方案；至少 3 项。',
    ),
    'pages/collect.json': placeholder(
      '资料采集',
      '多源并行：deepsearch（公网 / 知乎 / 微信公众号）+ 抖音博主 / 关键词 + bilibili + 知识库；每条证据带 URL、摘要、置信度，并按 dedup_hash 去重。',
    ),
    'pages/synthesize.json': placeholder(
      '综合分析',
      '按研究问题汇总证据生成 finding，标注未决问题；证据条数不达标显示 needs_more_evidence。',
    ),
    'pages/report.json': placeholder(
      '报告',
      '先生成大纲（用户接受）→ 分章节流式草稿 → 终稿；引用挂到具体证据 id；样章风格匹配设置。',
    ),
    'pages/qa.json': placeholder(
      '自检验收',
      '引用完整性、未决问题清单、长度、问题树覆盖度自检；用户最终接受才能 deliver。',
    ),
  };
}
