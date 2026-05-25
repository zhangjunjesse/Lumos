import type { BuilderSession } from './session';
import {
  buildNativeShellPages,
  withNativeShellCollections,
  withNativeShellRoutes,
} from './native-shell-blueprint';
import { buildXRadarCollections, buildXRadarPages } from './template-x-radar-data';

interface BuildOpts {
  now?: number;
}

/**
 * X 雷达 — 基于 Lumos 现有 X 能力的纯读监控/挖掘/摘要/数据拆解工作台。
 * 4 种任务模板（monitor/topic/digest/stats）共用 radar_tasks 表 + 同一套运行历史。
 * 业务实现见 src/lib/x-radar/patrol.ts；native_action 注册见 native-automation-runner.ts。
 */
export function buildXRadarFiles(
  session: BuilderSession,
  opts: BuildOpts = {},
): Record<string, string> {
  const app = baseApp(session, opts);
  const routes = withNativeShellRoutes({
    default: 'tasks',
    menu: [
      { id: 'tasks', label: '任务工作台', icon: 'radar', page: 'pages/tasks.json' },
      { id: 'alerts', label: '监控告警', icon: 'bell-ring', page: 'pages/alerts.json' },
      { id: 'reports', label: '选题报告', icon: 'file-text', page: 'pages/reports.json' },
      { id: 'digests', label: '关注摘要', icon: 'newspaper', page: 'pages/digests.json' },
      { id: 'stats', label: '数据拆解', icon: 'bar-chart-3', page: 'pages/stats.json' },
      { id: 'evidence', label: '原推快照', icon: 'twitter', page: 'pages/evidence.json' },
    ],
  });
  const dataSchema = withNativeShellCollections({ collections: buildXRadarCollections() });
  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildXRadarNativeAppSpec(app.name),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    ...buildXRadarPages(),
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'tasks',
      primaryCollection: 'radar_tasks',
      primaryCollectionLabel: '任务',
      automationPresets: buildXRadarAutomationPresets(),
      commandPresets: buildXRadarCommandPresets(),
    }),
  });
}

function baseApp(session: BuilderSession, opts: BuildOpts) {
  const appName = session.appName ?? 'X 雷达';
  const description =
    session.appDescription ??
    '基于 Lumos 现有 X 能力的纯读工作台：监控雷达 / 选题挖掘 / 关注摘要 / 数据拆解 4 种任务模板，共用调度、IM、运行历史。不发推、不回复、不点赞。';
  return {
    id: session.appId ?? 'x-radar',
    name: appName,
    version: `0.0.${Math.floor((opts.now ?? Date.now()) / 1000) % 100000}`,
    description,
    icon: './icon.png',
    category: 'research',
    entry: 'tasks',
    requires: { knowledge: 'optional', llm: 'chat', mcp: ['x-platform'] },
    permissions: { data: 'isolated', system: ['notification', 'schedule', 'im-notification'] },
    tags: ['x-platform', 'twitter', '监控', '选题', '数据分析'],
  };
}

function buildXRadarAutomationPresets() {
  return [
    {
      label: '添加监控雷达巡更',
      primary: true,
      input: {
        title: '监控雷达巡更',
        enabled: false,
        schedule: '每小时',
        native_action: 'x-radar:run-monitor-tasks',
        description: '扫描所有 kind=monitor 且 enabled=true 的任务，按 cadence 拉新推命中规则并写入 radar_alerts；命中且 im_enabled=true 时推 IM。',
        last_status: 'not_connected',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请在「服务 → X」登录并新建至少一个监控任务。',
      },
    },
    {
      label: '添加选题挖掘巡更',
      input: {
        title: '选题挖掘巡更',
        enabled: false,
        schedule: '每天 09:00',
        native_action: 'x-radar:run-topic-tasks',
        description: '扫描所有 kind=topic 且 enabled=true 的任务，按 cadence 抓证据 + thread 抽取，等 AI 桥接入后回填 topic_reports.report_md。',
        last_status: 'not_connected',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请检查抓取上限和入库 collection 设置。',
      },
    },
    {
      label: '添加关注摘要巡更',
      input: {
        title: '关注摘要巡更',
        enabled: false,
        schedule: '每天 08:00',
        native_action: 'x-radar:run-digest-tasks',
        description: '扫描所有 kind=digest 且 enabled=true 的任务，按窗口（daily/weekly）拉每人最新推证据，等 AI 桥接入后回填 follow_digests.summary_md。',
        last_status: 'not_connected',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请确认 @ 列表和摘要窗口。',
      },
    },
    {
      label: '添加数据拆解巡更',
      input: {
        title: '数据拆解巡更',
        enabled: false,
        schedule: '每周一 10:00',
        native_action: 'x-radar:run-stats-tasks',
        description: '扫描所有 kind=stats 且 enabled=true 的任务，按采样窗口拉量化数据计算互动率，等 AI 桥接入后回填 stats_reports.report_md。',
        last_status: 'not_connected',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请确认目标账号 / 话题与采样天数。',
      },
    },
  ];
}

function buildXRadarCommandPresets() {
  return [
    {
      label: '添加状态命令',
      primary: true,
      input: {
        command: '/x-radar status',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看 X 雷达就绪状态、X 登录态、任务数量；外部微信也可发 /app X 雷达 status 查询。',
      },
    },
    {
      label: '添加任务列表命令',
      input: {
        command: '/x-radar tasks',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看所有任务的模板类型、最近运行状态和下次运行时间。',
      },
    },
    {
      label: '添加告警列表命令',
      input: {
        command: '/x-radar alerts',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看最新监控告警（默认最近 24 小时）。',
      },
    },
    {
      label: '添加选题报告命令',
      input: {
        command: '/x-radar report <task>',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看指定任务最近的选题报告摘要、证据条数和入库状态。',
      },
    },
    {
      label: '添加关注摘要命令',
      input: {
        command: '/x-radar digest <task>',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看指定任务最近的关注摘要简报（最近窗口）。',
      },
    },
    {
      label: '添加数据拆解命令',
      input: {
        command: '/x-radar stats <task>',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看指定任务最近的数据拆解指标和热门 thread。',
      },
    },
  ];
}

function buildXRadarNativeAppSpec(appName: string) {
  return {
    version: 1,
    summary: `${appName}：基于 Lumos 现有 X 能力的纯读监控/挖掘/摘要/数据拆解工作台。用户在任务工作台挑 4 种模板之一创建任务，按定时或手动跑，命中告警 / 选题报告 / 关注摘要 / 数据报告落到对应栏目并按需推 IM。不发推、不回复、不点赞、不触碰任何写社交动作。`,
    userVisibleScope: [
      '在任务工作台新建任务并挑选 4 种模板之一；查看每个任务的模板类型、规则、最近运行状态、命中 / 产物数量、失败原因。',
      '监控雷达：配关键词或账号 + 命中规则，自动按 cadence 扫，命中入告警并可选推 IM。',
      '选题挖掘：配话题 / 关键词，自动 search + thread 抽取，落 tweet_evidence + topic_reports（AI 提炼模块未接入前 report_md 留空并显示 failure_reason）。',
      '关注摘要：配 @ 列表 + 日/周窗口，自动拉每人新推证据，等 AI 摘要桥接入后回填 summary_md。',
      '数据拆解：配账号或话题，定期拉量化数据，算互动率、发推节奏，等 AI 报告桥接入后回填 report_md。',
      '在告警 / 选题报告 / 关注摘要 / 数据报告页查看产物详情，含原推快照、链接、时间戳、AI 提炼内容（接入后）、可见的失败原因。',
      '在设置页配置 4 个模板的默认参数、AI 提示词、入库目标 knowledge collection、IM 通知开关、风险边界。',
      '在自动化页查看 4 个模板的定时任务状态、立即运行入口；在通知命令页查看 /x-radar 命令模板。',
      'X 未登录 / cookie 失效 / X 限流时，状态进入 needs_auth / failed 并显示原因；任何模板都不能用 mock 数据冒充产物。',
    ],
    status: {
      states: ['not_configured', 'needs_auth', 'ready', 'syncing', 'running', 'failed', 'not_connected'],
      readyCriteria: [
        '应用页面可打开；设置页已保存默认模板参数、AI 提示词与风险边界。',
        '「服务 → X」已登录且 cookie 在有效期内。',
        '至少存在一个 enabled 状态的任务。',
        '任意一个任务能从 running 进入 success 并产出告警 / 报告 / 摘要中的一项（topic/digest/stats 在 AI 桥未接入前仍写出证据 + failure_reason）。',
        'X 限流、抓取超时或 cookie 失效时必须显示 failure_reason 并停止后续 run，不能用 mock 推文冒充。',
      ],
      notConnectedBehavior:
        'X cookie 缺失 / 失效时所有任务停止并显示「需重新登录 X」；缺 IM 服务 / knowledge collection / AI 桥时对应动作显示 not_connected 并保留原始产物，不冒充已完成。',
    },
    settings: [
      { id: 'auth', label: 'X 账号', fields: ['登录状态', '登录名', '最近校验时间', '重新登录入口'] },
      { id: 'templates-defaults', label: '任务模板默认值', fields: ['监控-默认时间窗', '监控-默认互动数阈值', '挖掘-每次抓取上限', '挖掘-thread 抽取条数', '摘要-窗口（日 / 周）', '拆解-数据采样窗口', '全局并发上限'] },
      { id: 'ai-prompts', label: 'AI 提示词', fields: ['选题提炼提示词', '关注摘要提示词', '数据点评提示词', '应用助手提示词'] },
      { id: 'library', label: '入库目标', fields: ['选题报告默认 knowledge collection', '关注摘要默认 collection', '是否自动入库'] },
      { id: 'risk', label: '风险边界', fields: ['写操作确认', '高风险不做项', '失败时保留中间产物', '推 IM 默认开关'] },
    ],
    data: {
      entities: [
        'radar_tasks',
        'radar_alerts',
        'topic_reports',
        'follow_digests',
        'stats_reports',
        'task_evidence_refs',
        'tweet_evidence',
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
    ai: { enabled: true, promptSettings: true, draftBeforeWrite: true, visibleFailureHandling: true },
    automations: { enabled: true, controls: ['enable', 'pause', 'run_now', 'edit', 'delete'], visibleRunResults: true },
    runResults: { visible: true, states: ['running', 'success', 'failed', 'cancelled'], failureReasons: true, retry: true },
    im: {
      enabled: true,
      lowRiskCommands: ['/x-radar status', '/x-radar tasks', '/x-radar alerts', '/x-radar report <task>', '/x-radar digest <task>', '/x-radar stats <task>'],
      confirmationRequiredFor: [
        '通过 IM 命令触发新一轮 X 抓取（避免在用户不知情时消耗 X 限流配额）',
        '通过 IM 命令把报告 / 摘要写入 knowledge collection（需在应用内确认目标 collection）',
        '通过 IM 命令一次性批量重跑多个任务（必须在应用内确认范围）',
      ],
      visibleCommandResults: true,
    },
    risk: {
      writeActionsRequireConfirmation: true,
      highRiskActions: [
        '触发新一轮 X 抓取（消耗 X 限流配额，可能命中反爬）',
        '批量把报告 / 摘要入库到 knowledge collection（写知识库）',
        '批量推 IM 通知（避免噪音轰炸用户 / 群）',
        '批量删除已采集证据 / 报告',
      ],
      outOfScope: [
        '发推 / 回复 / 引用转发 / 点赞 / 收藏（任何 X 写社交动作）',
        '媒体上传 / 视频下载用于再分发',
        '绕过 X 反爬（自建 transaction-id、IP 池、模拟点击量等）',
        '为该应用单独修改 BrowserManager / 全局浏览器基础设施',
        'X cookie 失效或 X 风控触发时仍继续后续 run',
        '用 mock 推文 / mock 互动数补齐报告或告警',
      ],
    },
    acceptance: [
      { id: 'installation-self-check', label: '安装自检', howToVerify: '安装完成后查看安装自检结果，或在状态页点击「重新运行安装自检」；通过或失败会自动写入本验收项。' },
      { id: 'open-tasks', label: '打开任务工作台', howToVerify: '能看到任务列表与新建入口；空态有引导，无 mock 任务。' },
      { id: 'x-login-bound', label: 'X 登录态可见', howToVerify: '状态页显示当前 X 登录名与最近校验时间；cookie 失效时显示 needs_auth 并给重新登录入口。' },
      { id: 'monitor-hit', label: '监控雷达跑通', howToVerify: '创建一个监控任务（关键词 / 账号 + 命中规则），立即运行后任务 status 从 running → success，至少一条命中写入 radar_alerts，原推链接可点。' },
      { id: 'topic-evidence-falls-through', label: '选题挖掘抓证据可见', howToVerify: '创建一个选题挖掘任务，立即运行后 topic_reports 出现新记录含证据 URL；failure_reason 注明 AI 提炼未接入而非伪装 success。' },
      { id: 'follow-digest-falls-through', label: '关注摘要抓证据可见', howToVerify: '创建关注摘要任务，立即运行后 follow_digests 出现含每个账号 tweet_count；failure_reason 注明 AI 摘要未接入。' },
      { id: 'stats-metrics-computed', label: '数据拆解指标已算', howToVerify: '创建数据拆解任务，立即运行后 stats_reports 含 metrics_json 实际数字与 top_threads_json；report_md 留空并 failure_reason 注明 AI 报告未接入。' },
      { id: 'auth-failure-visible', label: 'X 登录失效可见', howToVerify: '把 X cookie 改成无效值后启动任意任务，状态进入 needs_auth 并显示「X 登录已过期」；不展示 mock 推文。' },
      { id: 'im-notify-toggle', label: 'IM 通知可控', howToVerify: '为监控任务启用 IM 通知，命中告警后 app_notifications 出现一条 success 记录，失败时 last_error 可见；关闭开关后不再推送。' },
      { id: 'review-automations', label: '查看自动化', howToVerify: '进入自动化页能看到 4 个模板的定时任务状态、上次运行和失败原因；可立即运行 / 暂停。' },
      { id: 'review-im-commands', label: '查看 IM 命令模板', howToVerify: '进入通知命令页能看到 /x-radar status|tasks|alerts|report|digest|stats 命令模板。' },
      { id: 'review-run-history', label: '查看运行结果', howToVerify: '进入运行结果页能看到每个任务的 running/success/failed/cancelled 历史、结果摘要、失败原因和重试入口说明。' },
      { id: 'task-lifecycle', label: '任务生命周期闭环', howToVerify: '对一个 running 任务点击「关闭」或「删除」，UI 显示终态；OpenWorkflow run 不再 active，scheduled_workflows 不再触发，schedule_run_history 写入 cancelled。' },
      { id: 'save-settings', label: '保存设置', howToVerify: '在设置页保存模板默认值、AI 提示词、入库目标 collection 与风险边界；保存后再次打开仍能看到。' },
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
