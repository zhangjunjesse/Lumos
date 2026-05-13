import type { BuilderSession } from './session';
import {
  buildNativeShellPages,
  withNativeShellCollections,
  withNativeShellRoutes,
} from './native-shell-blueprint';
import { buildDouyinCollections, buildDouyinPages } from './template-douyin-collector-data';

interface BuildOpts {
  now?: number;
}

export function buildDouyinCollectorFiles(
  session: BuilderSession,
  opts: BuildOpts = {},
): Record<string, string> {
  const app = baseApp(session, opts);
  const routes = withNativeShellRoutes({
    default: 'sources',
    menu: [
      { id: 'sources', label: '采集来源', icon: 'rss', page: 'pages/sources.json' },
      { id: 'jobs', label: '采集任务', icon: 'list-checks', page: 'pages/jobs.json' },
      { id: 'library', label: '资料库', icon: 'library-big', page: 'pages/library.json' },
      { id: 'organize', label: '整理', icon: 'sticky-note', page: 'pages/organize.json' },
    ],
  });
  const dataSchema = withNativeShellCollections({ collections: buildDouyinCollections() });
  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildDouyinNativeAppSpec(app.name),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    ...buildDouyinPages(),
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'sources',
      primaryCollection: 'videos',
      primaryCollectionLabel: '视频资料',
      automationPresets: buildDouyinAutomationPresets(),
      commandPresets: buildDouyinCommandPresets(),
    }),
  });
}

function baseApp(session: BuilderSession, opts: BuildOpts) {
  const appName = session.appName ?? '抖音采集器';
  const description =
    session.appDescription ??
    '按博主或关键词采集抖音视频，抓字幕、做摘要、入知识库；长视频自动分段转写。';
  return {
    id: session.appId ?? 'douyin-collector',
    name: appName,
    version: `0.0.${Math.floor((opts.now ?? Date.now()) / 1000) % 100000}`,
    description,
    icon: './icon.png',
    // Schema enum: office | creative | data | communication | research |
    // developer | lifestyle | other. "knowledge-collection" was rejected
    // → manifest validation failed → install never happened → Settings UI
    // crashed on first open (LibrarySection's empty-collection SelectItem).
    category: 'research',
    entry: 'sources',
    requires: { knowledge: 'optional', llm: 'chat' },
    permissions: { data: 'isolated', system: ['notification', 'schedule', 'im-notification'] },
    tags: ['抖音', '知识采集', '字幕转写'],
  };
}

function buildDouyinAutomationPresets() {
  return [
    {
      label: '添加博主每日巡更',
      primary: true,
      input: {
        title: '博主每日巡更',
        enabled: false,
        schedule: '每天 08:30',
        native_action: 'douyin-collector:patrol-creators',
        description:
          '扫描所有 enabled 状态的博主订阅，按 cadence 拉增量视频，新增视频排队转写、摘要、待整理。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请先在设置页配置抖音 Cookie 并选择转写策略与并发上限。',
      },
    },
    {
      label: '添加关键词跑批',
      input: {
        title: '关键词跑批',
        enabled: false,
        schedule: '每天 09:30',
        native_action: 'douyin-collector:patrol-keywords',
        description:
          '扫描启用的关键词订阅，按 dedupe_window_days 去重；触发风控时立即暂停后续，避免连锁失败。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请检查关键词、时间窗、去重天数和命中后入库的目标 collection。',
      },
    },
  ];
}

function buildDouyinCommandPresets() {
  return [
    {
      label: '添加状态命令',
      primary: true,
      input: {
        command: '/douyin status',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看 Cookie 是否有效、当前订阅与最近采集 job 摘要。',
      },
    },
    {
      label: '添加运行结果命令',
      input: {
        command: '/douyin runs',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看最近的采集 job、转写状态和失败原因；外部微信也可发送 /app 抖音采集器 runs。',
      },
    },
    {
      label: '添加资料库命令',
      input: {
        command: '/douyin library',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看资料库总数、待整理草稿数和已入库数量。',
      },
    },
    {
      label: '添加来源订阅命令',
      input: {
        command: '/douyin sources',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看博主订阅、关键词订阅和当前巡更频率。',
      },
    },
  ];
}

function buildDouyinNativeAppSpec(appName: string) {
  return {
    version: 1,
    summary: `${appName}：按博主、关键词、视频链接三种入口采集抖音公开视频，抓字幕（必要时语音 ASR 兜底，长视频分段并发），生成 AI 摘要和标签后入知识库；纯只读社交，不发评论 / 点赞 / 私信。`,
    userVisibleScope: [
      '在采集来源页订阅博主或关键词，可手动触发一次拉取，可禁用 / 删除 / 改频率。',
      '在采集任务页查看每条 job 的运行状态、发现条数、转写条数和失败原因；可重跑 / 取消。',
      '在资料库页按创作者 / 标签 / 状态 / 时长筛选已采集视频。',
      '在整理页对单条视频查看播放器、字幕、AI 摘要和章节切分；编辑标签、改入库状态、入知识库。',
      '在设置页配置抖音 Cookie、转写策略（仅原生字幕 / 允许 ASR / 强制语音 ASR）、并发上限、AI 提示词、入库目标 knowledge collection 和风险边界。',
      '在自动化页查看博主巡更与关键词跑批的启用状态、最近运行、失败原因、立即运行入口。',
      '在通知命令页查看 /douyin 命令模板和 /app 抖音采集器 status|runs|acceptance|help 通用命令。',
      '抖音 Cookie 失效或风控触发时，状态进入 needs_auth；底层服务（speech-to-text MCP / knowledge collection）缺失或失败时，状态进入 not_connected / failed 并显示原因。',
    ],
    status: {
      states: ['not_configured', 'needs_auth', 'ready', 'syncing', 'failed', 'not_connected'],
      readyCriteria: [
        '应用页面可打开，设置页已保存抖音 Cookie 与转写策略。',
        '至少存在一个启用的博主或关键词订阅。',
        '任意一条 collect_job 能在 success 状态结束并产出至少一条 video 草稿。',
        '抖音风控或转写失败时必须显示 failure_reason，不能用 mock 字幕冒充。',
      ],
      notConnectedBehavior:
        '缺 Cookie / 转写 MCP / knowledge collection 时，整理页和入库按钮显示 not_connected / failed 和原因；用户尚未订阅任何博主或关键词时显示空态引导而不是假数据。',
    },
    settings: [
      { id: 'auth', label: '抖音 Cookie', fields: ['Cookie 文本', '过期时间', '最近校验'] },
      { id: 'transcribe', label: '转写策略', fields: ['仅原生字幕', '允许抖音 ASR', '语音 ASR 兜底', '长视频分段时长', '并发上限'] },
      { id: 'library', label: '入库目标', fields: ['默认 knowledge collection', '入库版本', '是否自动入库'] },
      { id: 'ai-prompts', label: 'AI 提示词', fields: ['摘要提示词', '章节切分提示词', '标签建议提示词'] },
      { id: 'risk', label: '风险边界', fields: ['写操作确认', '高风险不做项', '失败时保留中间产物'] },
    ],
    data: {
      entities: [
        'creators',
        'keywords',
        'collect_jobs',
        'videos',
        'transcripts',
        'library_links',
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
      lowRiskCommands: ['/douyin status', '/douyin runs', '/douyin library', '/douyin sources'],
      confirmationRequiredFor: [
        '通过 IM 命令触发新采集 job（避免在用户不知情时消耗抖音风控配额）',
        '通过 IM 命令把视频入库到 knowledge collection（需在应用内确认目标）',
      ],
      visibleCommandResults: true,
    },
    risk: {
      writeActionsRequireConfirmation: true,
      highRiskActions: [
        '触发新采集 job（消耗抖音风控配额、可能命中限流）',
        '批量启动转写（消耗 ASR 服务商配额）',
        '把视频入库到 knowledge collection（写知识库）',
        '批量入库或批量删除已采集视频',
      ],
      outOfScope: [
        '发评论 / 点赞 / 私信 / 关注（任何抖音写社交动作）',
        '批量下载视频原文件用于分发',
        '绕过抖音风控（验证码自动破解、IP 池、模拟点击量等）',
        '商业用途的字幕 / 内容再分发；用户对抓取内容的用途负责',
        '在 Cookie 失效或风控触发时仍继续后续采集 job',
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
        id: 'open-sources',
        label: '打开采集来源页',
        howToVerify: '能看到博主订阅和关键词订阅两张表；空态有引导，无 mock 数据。',
      },
      {
        id: 'add-creator',
        label: '订阅博主',
        howToVerify:
          '在采集来源页填入博主链接 / sec_uid，保存后博主出现在列表，cadence 可改、可禁用 / 启用。',
      },
      {
        id: 'add-keyword',
        label: '订阅关键词',
        howToVerify: '在采集来源页填入关键词、时间窗、去重天数，保存后关键词出现在列表。',
      },
      {
        id: 'run-collect-job',
        label: '运行一次采集',
        howToVerify:
          '基于一个博主或关键词点击「立即采集」，job 状态从 queued → running → success / failed；过程和失败原因可见。',
      },
      {
        id: 'transcribe-video',
        label: '抓字幕 / 转写',
        howToVerify:
          '对一条 video 点击「抓字幕」，transcript_status 从 pending → success；subtitle_source 字段显示真实来源（native / asr-douyin / asr-local）。',
      },
      {
        id: 'long-video-segmented',
        label: '长视频分段转写',
        howToVerify:
          '对一条 ≥10 分钟的视频触发转写，transcripts.segments 体现分段；并发上限受设置控制；任意分段失败时整体不打回 success。',
      },
      {
        id: 'organize-and-publish',
        label: '整理后入库',
        howToVerify:
          '在整理页编辑摘要 / 标签 / 章节后点击「入知识库」，library_status 从 unprocessed → draft → published；library_links 出现新记录。',
      },
      {
        id: 'auth-failure-visible',
        label: 'Cookie 失效可见',
        howToVerify:
          '把 Cookie 改成无效值后启动采集，状态进入 needs_auth 并显示「Cookie 失效或抖音返回风控」，不展示 mock 视频。',
      },
      {
        id: 'asr-failure-visible',
        label: '转写失败可见',
        howToVerify:
          '在 speech-to-text MCP 不可达或 ASR 配额耗尽时触发转写，transcript_status=failed 并写入 failure_reason，不冒充 success。',
      },
      {
        id: 'review-automations',
        label: '查看自动化',
        howToVerify: '进入自动化页，能看到博主巡更、关键词跑批的状态、上次运行和失败原因；可立即运行 / 暂停。',
      },
      {
        id: 'review-im-commands',
        label: '查看 IM 命令模板',
        howToVerify:
          '进入通知命令页，能看到 /douyin status|runs|library|sources 命令模板；高风险命令必须在应用内确认。',
      },
      {
        id: 'review-run-history',
        label: '查看运行结果',
        howToVerify: '进入运行结果页，能看到采集 / 转写 / 入库的运行状态、摘要、失败原因和重试入口说明。',
      },
      {
        id: 'save-settings',
        label: '保存设置',
        howToVerify:
          '在设置页保存 Cookie、转写策略、入库目标 collection、AI 提示词和风险边界；保存后再次打开仍能看到。',
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
