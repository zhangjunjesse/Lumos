import type { BuilderSession } from './session';
import {
  buildNativeShellPages,
  withNativeShellCollections,
  withNativeShellRoutes,
} from './native-shell-blueprint';
import {
  buildDeepResearchCollections,
  buildDeepResearchPages,
  DEEP_RESEARCH_DEFAULT_SYSTEM_PROMPT,
} from './template-deep-research-data';

interface BuildOpts {
  now?: number;
}

/**
 * 深度调研 — 对话驱动的端到端调研工作台。八阶段 SOP：
 *   1. 需求澄清（Clarify）   2. 目标确认（Goal）
 *   3. 任务拆解（Plan）     4. 难度风险分析（Risk）
 *   5. 资料采集（Collect）   6. 综合分析（Synthesize）
 *   7. 报告生成（Report）   8. 自检验收（QA）
 *
 * 多源采集复用 Lumos 已有能力：deepsearch 公网 / 知乎 / 微信公众号、抖音
 * 采集器、bilibili、知识库、Office 文档；不替换任何全局基础设施。
 */
export function buildDeepResearchFiles(
  session: BuilderSession,
  opts: BuildOpts = {},
): Record<string, string> {
  const app = baseApp(session, opts);
  const routes = withNativeShellRoutes({
    default: 'tasks',
    menu: [
      { id: 'tasks', label: '调研任务', icon: 'compass', page: 'pages/tasks.json' },
      { id: 'clarify', label: '需求澄清', icon: 'messages-square', page: 'pages/clarify.json' },
      { id: 'goal', label: '目标书', icon: 'goal', page: 'pages/goal.json' },
      { id: 'plan', label: '问题树', icon: 'list-tree', page: 'pages/plan.json' },
      { id: 'risk', label: '难度风险', icon: 'shield-alert', page: 'pages/risk.json' },
      { id: 'collect', label: '资料采集', icon: 'rss', page: 'pages/collect.json' },
      { id: 'synthesize', label: '综合分析', icon: 'sparkles', page: 'pages/synthesize.json' },
      { id: 'report', label: '报告', icon: 'file-text', page: 'pages/report.json' },
      { id: 'qa', label: '自检验收', icon: 'shield-check', page: 'pages/qa.json' },
    ],
  });
  const dataSchema = withNativeShellCollections({ collections: buildDeepResearchCollections() });
  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildDeepResearchNativeAppSpec(app.name),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    ...buildDeepResearchPages(),
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'tasks',
      primaryCollection: 'research_tasks',
      primaryCollectionLabel: '调研任务',
      automationPresets: buildDeepResearchAutomationPresets(),
      commandPresets: buildDeepResearchCommandPresets(),
    }),
  });
}

function baseApp(session: BuilderSession, opts: BuildOpts) {
  const appName = session.appName ?? '深度调研';
  const description =
    session.appDescription ??
    '对话驱动的深度调研工作台：需求澄清 → 目标确认 → 任务拆解 → 风险分析 → 多源采集 → 综合分析 → 报告生成 → 自检验收，全流程 SOP 可见、可回滚。';
  return {
    id: session.appId ?? 'deep-research',
    name: appName,
    version: `0.0.${Math.floor((opts.now ?? Date.now()) / 1000) % 100000}`,
    description,
    icon: './icon.png',
    category: 'research',
    entry: 'tasks',
    requires: { knowledge: 'optional', llm: 'chat' },
    permissions: { data: 'isolated', system: ['notification', 'schedule', 'im-notification'] },
    tags: ['深度调研', '研究报告', 'deepsearch', '抖音', '多源采集', 'SOP'],
  };
}

function buildDeepResearchAutomationPresets() {
  return [
    {
      label: '添加调研推进巡更',
      primary: true,
      input: {
        title: '调研推进巡更',
        enabled: false,
        schedule: '每天 10:00',
        native_action: 'deep-research:advance-active-tasks',
        description:
          '巡检 active 状态的调研任务：未澄清的提醒用户澄清；已澄清未确认目标的提醒确认；已确认目标的开始执行下一阶段；阻塞超过 24 小时的写入风险登记册并通知用户。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary:
          '默认禁用。开启前请先在设置页确认默认 LLM、deepsearch 配额、采集来源白名单与「报告样章风格」。',
      },
    },
    {
      label: '添加证据补全巡更',
      input: {
        title: '证据补全巡更',
        enabled: false,
        schedule: '每天 18:00',
        native_action: 'deep-research:topup-evidence',
        description:
          '巡检综合分析阶段：每个研究问题最低证据条数（默认 3 条 / 不同来源）未达标时，对照已采集来源补抓增量；耗尽配额时停止后续并写入风险登记册。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary:
          '默认禁用。开启前请检查证据条数门槛、来源白名单、单次补抓上限和命中后写入的目标研究问题。',
      },
    },
  ];
}

function buildDeepResearchCommandPresets() {
  return [
    {
      label: '添加任务总览命令',
      primary: true,
      input: {
        command: '/research tasks',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看当前所有调研任务的阶段、阻塞与最近一次推进时间。',
      },
    },
    {
      label: '添加问题树命令',
      input: {
        command: '/research plan <task>',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看指定任务的研究问题树与每题的证据条数 / 未决项。',
      },
    },
    {
      label: '添加报告命令',
      input: {
        command: '/research report <task>',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看指定任务最近的报告版本（大纲 / 章节草稿 / 终稿）与自检结论。',
      },
    },
    {
      label: '添加阻塞命令',
      input: {
        command: '/research risk <task>',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看指定任务的风险登记册：付费墙、稀缺资料、敏感话题、配额耗尽等。',
      },
    },
  ];
}

function buildDeepResearchNativeAppSpec(appName: string) {
  return {
    version: 1,
    summary: `${appName}：对话驱动的端到端深度调研工作台。八阶段 SOP（澄清 → 目标 → 拆解 → 风险 → 采集 → 综合 → 报告 → 自检）每阶段都有可见的用户确认与失败原因；多源采集复用 deepsearch（公网 / 知乎 / 微信公众号）、抖音采集器、bilibili、Lumos 知识库，不绕过登录态或风控。`,
    userVisibleScope: [
      '在调研任务页新建任务并选择审美样章风格；查看每个任务当前 SOP 阶段、阻塞原因、最近推进时间。',
      '在需求澄清页与 AI 多轮对话明确读者、用途、范围、深度、语气、长度和审美参考；澄清未完成不进入下一阶段。',
      '在目标书页查看 SMART 目标、成功标准、不在范围内的事项；用户接受后才进入任务拆解。',
      '在问题树页查看研究问题树（≤8 顶级 / 每题含子问题与验证标准）；可以增删改并重新平衡子题。',
      '在难度风险页查看资料稀缺 / 付费墙 / 敏感话题 / 时效 / 语言 / 配额耗尽等风险与降级方案。',
      '在资料采集页订阅 deepsearch 站点、抖音博主与关键词、bilibili 关键词、知识库 collection；按问题树并发采集并去重，证据带来源 URL 与置信度。',
      '在综合分析页按问题汇总证据 → AI 写出每题答案 → 标注未决问题；证据数量不达标时显示 needs_more_evidence。',
      '在报告页先看大纲（用户确认）→ 章节流式草稿 → 终稿；可选样章风格（克制学术 / 行业研究 / 投资人友好 / 中文长文）。',
      '在自检验收页查看引用完整性、未决问题清单、长度、问题树覆盖度自检结果；用户做最终接受 / 重做指令。',
      '在自动化页查看调研推进巡更与证据补全巡更状态；在通知命令页查看 /research 与 /app 命令模板。',
      'deepsearch 站点失效、抖音 Cookie 失效、LLM 配额耗尽时状态进入 needs_auth / not_connected / failed 并显示原因；任何阶段都不用 mock 内容冒充完成。',
    ],
    status: {
      states: ['not_configured', 'needs_auth', 'ready', 'syncing', 'failed', 'not_connected'],
      readyCriteria: [
        '应用页面可打开，设置页已保存默认 LLM、报告样章风格与风险边界。',
        '至少存在一个 active 状态的调研任务，并完成需求澄清进入目标书阶段。',
        '至少一个研究问题在综合分析阶段拿到 ≥3 条不同来源的证据并产出 finding。',
        'deepsearch / 抖音 / bilibili / LLM 任一来源不可用时必须显示 failure_reason，不能用 mock 数据冒充。',
      ],
      notConnectedBehavior:
        '缺 deepsearch 站点登录态、抖音 Cookie、LLM Provider 或 knowledge collection 时，采集页和综合分析页相关条目显示 not_connected / failed 和原因；未开始任何调研任务时显示空态引导而不是假报告。',
    },
    settings: [
      {
        id: 'defaults',
        label: '调研默认值',
        fields: ['默认 LLM 模型', '默认报告语言', '默认报告长度', '默认审美样章风格'],
      },
      {
        id: 'sources',
        label: '采集来源白名单',
        fields: [
          'deepsearch 启用站点（公网 / 知乎 / 微信公众号 / B 站 / 抖音）',
          '抖音 Cookie 与并发上限',
          'bilibili 字幕 / AI 摘要开关',
          '内部 knowledge collection 白名单',
        ],
      },
      {
        id: 'sop-thresholds',
        label: 'SOP 门槛',
        fields: [
          '每题最低证据数（默认 3 条 / 不同来源）',
          '问题树最大顶级数（默认 8）',
          '单次采集 max-pages',
          '阻塞超时（小时）',
        ],
      },
      {
        id: 'ai-prompts',
        label: 'AI 提示词',
        fields: ['澄清追问提示词', '目标书生成提示词', '问题拆解提示词', '综合分析提示词', '报告章节提示词', '自检提示词'],
      },
      {
        id: 'risk',
        label: '风险边界',
        fields: ['写操作确认', '高风险不做项', '敏感话题处理策略', '失败时保留中间产物'],
      },
    ],
    data: {
      entities: [
        'research_tasks',
        'research_briefs',
        'research_goals',
        'research_questions',
        'research_risks',
        'research_sources',
        'research_evidence',
        'research_findings',
        'research_reports',
        'research_qa_checks',
        'app_settings',
        'app_automations',
        'run_history',
        'assistant_messages',
        'app_notifications',
        'app_command_runs',
        'acceptance_checks',
      ],
      reusableStores: ['settings', 'run_history', 'notifications', 'command_runs'],
    },
    ai: {
      enabled: true,
      promptSettings: true,
      draftBeforeWrite: true,
      visibleFailureHandling: true,
      defaultSystemPrompt: DEEP_RESEARCH_DEFAULT_SYSTEM_PROMPT,
    },
    automations: {
      enabled: true,
      controls: ['enable', 'pause', 'run_now', 'edit', 'delete'],
      visibleRunResults: true,
    },
    runResults: {
      visible: true,
      states: ['running', 'success', 'failed', 'cancelled'],
      failureReasons: true,
      retry: true,
    },
    im: {
      enabled: true,
      lowRiskCommands: [
        '/research tasks',
        '/research plan <task>',
        '/research report <task>',
        '/research risk <task>',
      ],
      confirmationRequiredFor: [
        '通过 IM 命令启动新的采集 job（避免在用户不知情时消耗 deepsearch / 抖音 / LLM 配额）',
        '通过 IM 命令把报告 / 证据写入 knowledge collection（必须在应用内确认目标 collection）',
        '通过 IM 命令一次性推进 SOP 多个阶段（必须在应用内确认每个阶段的目标书 / 大纲 / 终稿）',
      ],
      visibleCommandResults: true,
    },
    risk: {
      writeActionsRequireConfirmation: true,
      highRiskActions: [
        '启动新一轮多源采集（消耗 deepsearch / 抖音 / bilibili / LLM 配额，可能命中目标站点风控）',
        '把研究证据或终稿写入 knowledge collection（写知识库）',
        '基于 AI 自检结论一键标记报告「已交付」（绕过用户终审）',
        '在敏感 / 政治 / 医疗等高风险话题上输出建议性结论而不做警告标注',
      ],
      outOfScope: [
        '为绕过付费墙抓取付费内容、破解登录、模拟点击量等任何风控对抗手段',
        '把 AI 生成的"未经证据支撑的判断"写入终稿而不标注未决',
        '对一手数据 / 法律 / 医疗结论给出"作为决策依据"的强断言',
        '在用户未接受目标书的情况下直接出报告',
        '在采集失败 / 配额耗尽时用 mock 资料补齐报告',
      ],
    },
    acceptance: [
      {
        id: 'installation-self-check',
        label: '安装自检',
        howToVerify:
          '安装完成后查看安装自检结果，或在状态页点击重新运行安装自检；通过或失败会自动写入本验收项。',
      },
      {
        id: 'open-tasks',
        label: '打开调研任务页',
        howToVerify: '能看到调研任务列表与新建入口；空态有引导，无 mock 任务。',
      },
      {
        id: 'create-task',
        label: '新建调研任务',
        howToVerify:
          '在调研任务页输入主题、读者、用途与样章风格，保存后任务出现在列表，stage=clarifying。',
      },
      {
        id: 'clarify-loop',
        label: '需求澄清闭环',
        howToVerify:
          '在需求澄清页与 AI 多轮对话后产出 brief，用户接受后任务 stage 推进到 goal；未接受 brief 时不能跳到下一阶段。',
      },
      {
        id: 'accept-goal',
        label: '接受目标书',
        howToVerify:
          '在目标书页查看 SMART 目标 / 成功标准 / out-of-scope；用户接受后 stage 推进到 planning。',
      },
      {
        id: 'build-question-tree',
        label: '建立研究问题树',
        howToVerify:
          '在问题树页能看到 ≤8 顶级问题，每题含子问题与验证标准；可手动增删改并重新平衡子题。',
      },
      {
        id: 'review-risks',
        label: '查看风险登记册',
        howToVerify:
          '在难度风险页查看资料稀缺 / 付费墙 / 敏感话题 / 配额耗尽等风险及降级方案；至少 3 项风险被识别。',
      },
      {
        id: 'collect-multisource',
        label: '多源采集成功',
        howToVerify:
          '在资料采集页订阅 ≥2 个不同来源（如 deepsearch 公网 + 抖音 + bilibili），任意一个研究问题拿到 ≥3 条不同来源的证据，每条带 URL / 摘要 / 置信度。',
      },
      {
        id: 'synthesize-finding',
        label: '综合分析产出',
        howToVerify:
          '在综合分析页对某个研究问题产出 finding，含引用列表、未决问题标注；证据不达标时显示 needs_more_evidence 而不冒充完成。',
      },
      {
        id: 'outline-confirm',
        label: '报告大纲确认',
        howToVerify:
          '在报告页生成报告大纲并由用户接受后才允许写章节草稿；未接受大纲时不能进入终稿。',
      },
      {
        id: 'final-report',
        label: '终稿产出',
        howToVerify:
          '在报告页看到分章节流式草稿与终稿，引用挂到具体证据；样章风格符合设置项中的选择。',
      },
      {
        id: 'qa-pass',
        label: '自检通过',
        howToVerify:
          '在自检验收页通过引用完整性、未决问题清单、问题树覆盖度自检；用户最终接受报告，stage 推进到 delivered。',
      },
      {
        id: 'auth-failure-visible',
        label: '采集失败可见',
        howToVerify:
          '把 deepsearch 站点或抖音 Cookie 置为无效，触发采集后状态进入 needs_auth；不展示 mock 证据。',
      },
      {
        id: 'review-automations',
        label: '查看自动化',
        howToVerify:
          '进入自动化页，能看到推进巡更与证据补全巡更的状态、上次运行和失败原因；可立即运行 / 暂停。',
      },
      {
        id: 'review-im-commands',
        label: '查看 IM 命令模板',
        howToVerify:
          '进入通知命令页，能看到 /research tasks|plan|report|risk 命令模板；高风险命令必须回到应用内确认。',
      },
      {
        id: 'save-settings',
        label: '保存设置',
        howToVerify:
          '在设置页保存默认 LLM、报告样章风格、采集来源白名单、SOP 门槛、AI 提示词与风险边界；再次打开仍能看到。',
      },
    ],
  };
}

function stringifyFiles(files: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      `${JSON.stringify(content, null, 2)}\n`,
    ]),
  );
}
