import type { BuilderSession } from './session';
import {
  buildNativeShellPages,
  withNativeShellCollections,
  withNativeShellRoutes,
} from './native-shell-blueprint';
import { buildEcommerceAssistantFiles } from './template-ecommerce-assistant';
import { buildDouyinCollectorFiles } from './template-douyin-collector';
import { buildDeepResearchFiles } from './template-deep-research';

export interface AppBuilderTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  prompt: string;
  highlights: string[];
}

export const BLANK_APP_BUILDER_TEMPLATE_ID = 'blank';

export const APP_BUILDER_TEMPLATES: AppBuilderTemplate[] = [
  {
    id: 'goofish-assistant',
    name: '闲鱼助手',
    description: '买家会话、回复草稿、商品标记、微信 IM 通知和低风险命令边界。',
    category: '电商运营',
    prompt:
      '用户选择了「闲鱼助手」模板。必须沿受控 goofish 原生集成边界设计：先处理安装/登录/同步状态、买家会话、AI 回复草稿、用户确认发送、微信 IM 通知和低风险命令；发布商品、改价、下架、删除、批量修改和自动无确认回复都必须标为不可用或高风险不做。',
    highlights: ['买家会话', '回复草稿', 'IM 通知'],
  },
  {
    id: 'ecommerce-assistant',
    name: '电商商品助手',
    description: '一键生成电商商品图、识别商品资料、批量出图、风格预设和场景方向调整。',
    category: '电商运营',
    prompt:
      '用户选择了「电商商品助手」模板。必须按 SOP 流程设计：参考图筛选 → brief 识别 → 抠图（含质检回路）→ 场景策划 → 3 方向生成 → AI 评分 → 终版精修（含质检回路）→ 失败回路和白底兜底。所有写操作（启动任务、批量、重跑）必须用户确认，图像服务商缺失或失败必须显示 not_connected / failed 和原因，禁止 mock 冒充。',
    highlights: ['一键出图', 'AI 识别 brief', '风格预设'],
  },
  {
    id: 'douyin-collector',
    name: '抖音采集器',
    description: '按博主或关键词采集抖音视频，抓字幕、做摘要、入知识库；长视频自动分段转写。',
    category: '知识采集',
    prompt:
      '用户选择了「抖音采集器」模板。仅采集公开视频元数据 / 字幕 / 封面，绝不下载视频原文件用于分发；字幕优先级原生 → 抖音 ASR → Lumos speech-to-text MCP；写社交动作（评论 / 点赞 / 私信 / 关注）必须标为不可用；入库到 knowledge collection 必须先草稿后用户确认。Cookie 失效或风控触发时立即停止后续 job 并显示原因。',
    highlights: ['博主巡更', '关键词跑批', '长视频转写'],
  },
  {
    id: 'deep-research',
    name: '深度调研',
    description:
      '对话驱动的深度调研工作台：需求澄清 → 目标确认 → 任务拆解 → 风险分析 → 多源采集 → 综合分析 → 报告生成 → 自检验收。',
    category: '知识采集',
    prompt:
      '用户选择了「深度调研」模板。必须按八阶段 SOP 推进，绝不跳阶段：clarifying → goal_review → planning → risk_review → collecting → synthesizing → outline_review → drafting → qa → delivered。需求澄清未完成不进入目标书；用户未接受目标书不进入任务拆解；大纲未接受不进入终稿。多源采集复用 deepsearch / 抖音采集器 / bilibili / 知识库，证据必须带 URL / 摘要 / 置信度；触发风控 / 配额耗尽 / 站点失效时立即停止后续并写入风险登记册。任何阶段都不能用 mock 数据冒充完成。',
    highlights: ['八阶段 SOP', '多源采集', '证据链终稿'],
  },
  {
    id: 'customer-tracker',
    name: '客户跟进',
    description: '客户列表、新增客户、状态和备注，适合 CRM 入门场景。',
    category: '业务记录',
    prompt:
      '用户选择了「客户跟进」模板。优先围绕客户资料、跟进状态、联系人、备注、下次跟进日期和列表筛选继续完善。',
    highlights: ['客户列表', '新增表单', '跟进状态'],
  },
  {
    id: 'weekly-report',
    name: '周报助手',
    description: '记录本周事项、风险和下周计划，后续可接 AI 总结。',
    category: '办公协作',
    prompt:
      '用户选择了「周报助手」模板。优先围绕工作事项、成果、风险、下周计划、周报草稿和导出继续完善。',
    highlights: ['事项记录', '周报草稿', '计划归档'],
  },
  {
    id: 'resource-library',
    name: '资料整理',
    description: '保存链接、标签、处理状态和摘要，适合资料收集整理。',
    category: '知识整理',
    prompt:
      '用户选择了「资料整理」模板。优先围绕资料链接、标签、摘要、处理状态、来源和后续动作继续完善。',
    highlights: ['资料列表', '标签', '处理状态'],
  },
];

export function getAppBuilderTemplate(id?: string | null): AppBuilderTemplate | null {
  if (!id || id === BLANK_APP_BUILDER_TEMPLATE_ID) return null;
  return APP_BUILDER_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function inferAppBuilderTemplateId(
  appName?: string | null,
  appDescription?: string | null,
): string | null {
  const text = `${appName ?? ''}\n${appDescription ?? ''}`.toLowerCase();
  if (/(闲鱼|咸鱼|xianyu|goofish)/i.test(text)) return 'goofish-assistant';
  if (/(电商|商品图|出图|淘宝|拼多多|京东|亚马逊|ecommerce|product[- ]?image)/i.test(text)) {
    return 'ecommerce-assistant';
  }
  if (/(抖音|douyin|tiktok|短视频采集|视频转写|视频字幕)/i.test(text)) {
    return 'douyin-collector';
  }
  if (/(深度调研|深度研究|研究报告|deep[- ]?research|多源调研)/i.test(text)) {
    return 'deep-research';
  }
  return null;
}

export function buildTemplateBlueprintFiles(
  session: BuilderSession,
  templateId: string,
  opts: { now?: number } = {},
): Record<string, string> | null {
  const template = getAppBuilderTemplate(templateId);
  if (!template) return null;

  switch (template.id) {
    case 'goofish-assistant':
      return buildGoofishAssistantFiles(session, opts);
    case 'ecommerce-assistant':
      return buildEcommerceAssistantFiles(session, opts);
    case 'douyin-collector':
      return buildDouyinCollectorFiles(session, opts);
    case 'deep-research':
      return buildDeepResearchFiles(session, opts);
    case 'customer-tracker':
      return buildCustomerTrackerFiles(session, opts);
    case 'weekly-report':
      return buildWeeklyReportFiles(session, opts);
    case 'resource-library':
      return buildResourceLibraryFiles(session, opts);
    default:
      return null;
  }
}

function baseApp(session: BuilderSession, opts: { now?: number }, category = 'office') {
  const appName = session.appName ?? '未命名应用';
  const description = session.appDescription ?? `${appName} 的应用草稿`;
  return {
    id: session.appId ?? toAppId(appName, session.id),
    name: appName,
    version: `0.1.${Math.floor((opts.now ?? Date.now()) / 1000) % 100000}`,
    description,
    icon: './icon.png',
    category,
    requires: { knowledge: 'none' },
    permissions: { data: 'isolated' },
  };
}

function buildGoofishAssistantFiles(
  session: BuilderSession,
  opts: { now?: number },
): Record<string, string> {
  const app = {
    ...baseApp(session, opts, 'communication'),
    entry: 'inbox',
    requires: { knowledge: 'none', llm: 'chat' },
    permissions: { data: 'isolated', system: ['notification', 'schedule', 'im-notification'] },
    tags: ['闲鱼', '电商', 'IM'],
  };
  const routes = withNativeShellRoutes({
    default: 'inbox',
    menu: [
      { id: 'accounts', label: '账号', icon: 'user-round-cog', page: 'pages/accounts.json' },
      { id: 'inbox', label: '买家会话', icon: 'inbox', page: 'pages/inbox.json' },
      { id: 'drafts', label: '回复草稿', icon: 'message-square-text', page: 'pages/drafts.json' },
      { id: 'draft-reply', label: '写草稿', icon: 'edit-3', page: 'pages/draft-reply.json' },
      { id: 'items', label: '商品标记', icon: 'package-search', page: 'pages/items.json' },
      { id: 'auto-reply', label: '白名单话术', icon: 'shield-check', page: 'pages/auto-reply.json' },
      { id: 'reminders', label: '提醒规则', icon: 'bell-ring', page: 'pages/reminders.json' },
      { id: 'search', label: '搜索', icon: 'search', page: 'pages/search.json' },
    ],
  });
  const dataSchema = withNativeShellCollections({ collections: buildGoofishCollections() });
  const businessPages = buildGoofishPages();

  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildGoofishNativeAppSpec(app.name),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    ...businessPages,
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'inbox',
      primaryCollection: 'buyer_conversations',
      primaryCollectionLabel: '买家会话',
      automationPresets: buildGoofishAutomationPresets(),
      commandPresets: buildGoofishCommandPresets(),
    }),
  });
}

function buildGoofishCollections(): unknown[] {
  return [
    buildGoofishAccountsCollection(),
    buildBuyerConversationsCollection(),
    buildReplyDraftsCollection(),
    buildItemMarksCollection(),
    buildAutoReplyRulesCollection(),
    buildReminderRulesCollection(),
    buildKeywordAlertsCollection(),
  ];
}

function buildGoofishAccountsCollection() {
  return {
    name: 'goofish_accounts',
    label: '闲鱼账号',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'account_label', type: 'string', label: '账号', required: true, indexed: true },
      {
        name: 'login_status',
        type: 'enum',
        label: '登录状态',
        options: ['needs_auth', 'ready', 'failed', 'unknown'],
        default: 'needs_auth',
        indexed: true,
      },
      {
        name: 'sync_status',
        type: 'enum',
        label: '同步状态',
        options: ['not_connected', 'idle', 'syncing', 'success', 'failed'],
        default: 'not_connected',
        indexed: true,
      },
      { name: 'last_sync_at', type: 'datetime', label: '最近同步' },
      { name: 'last_error', type: 'text', label: '失败原因' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['login_status'], ['sync_status'], ['updated_at']],
  };
}

function buildBuyerConversationsCollection() {
  return {
    name: 'buyer_conversations',
    label: '买家会话',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'conversation_id', type: 'string', label: '会话 ID', indexed: true },
      { name: 'buyer_name', type: 'string', label: '买家', required: true, indexed: true },
      { name: 'item_title', type: 'string', label: '商品', indexed: true },
      { name: 'unread_count', type: 'integer', label: '未读数', default: 0, indexed: true },
      { name: 'last_message', type: 'text', label: '最近消息' },
      { name: 'last_message_at', type: 'datetime', label: '最近消息时间', indexed: true },
      { name: 'account_unb', type: 'string', label: '账号 UNB', indexed: true },
      { name: 'buyer_user_id', type: 'string', label: '买家 ID', indexed: true },
      {
        name: 'reply_status',
        type: 'enum',
        label: '回复状态',
        options: ['待回复', '已草稿', '待确认', '已回复', '忽略'],
        default: '待回复',
        indexed: true,
      },
      {
        name: 'priority',
        type: 'enum',
        label: '优先级',
        options: ['普通', '重要', '紧急'],
        default: '普通',
        indexed: true,
      },
      { name: 'notes', type: 'text', label: '备注' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['reply_status'], ['priority'], ['updated_at']],
  };
}

function buildReplyDraftsCollection() {
  return {
    name: 'reply_drafts',
    label: '回复草稿',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'conversation_id', type: 'string', label: '会话 ID', indexed: true },
      { name: 'buyer_name', type: 'string', label: '买家', required: true, indexed: true },
      { name: 'item_title', type: 'string', label: '商品', indexed: true },
      { name: 'incoming_message', type: 'text', label: '买家消息' },
      { name: 'draft_text', type: 'text', label: '回复草稿', required: true },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['draft', 'pending_confirmation', 'sent', 'failed', 'rejected'],
        default: 'draft',
        indexed: true,
      },
      {
        name: 'confirmation_channel',
        type: 'enum',
        label: '确认方式',
        options: ['应用内确认', '微信 IM 确认', '未确认', 'whitelist_auto'],
        default: '未确认',
      },
      { name: 'confirmation_code', type: 'string', label: '草稿编号', indexed: true },
      { name: 'confirmation_expires_at', type: 'datetime', label: '确认有效期' },
      { name: 'risk_note', type: 'text', label: '风险说明' },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'matched_rule_id', type: 'string', label: '命中规则', indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['conversation_id'], ['status'], ['confirmation_code'], ['matched_rule_id'], ['updated_at']],
  };
}

function buildItemMarksCollection() {
  return {
    name: 'item_marks',
    label: '商品标记',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'item_id', type: 'string', label: '商品 ID', indexed: true },
      { name: 'item_title', type: 'string', label: '商品标题', required: true, indexed: true },
      {
        name: 'status',
        type: 'enum',
        label: '标记',
        options: ['只读', '待处理', '重点跟进', '已关闭'],
        default: '只读',
        indexed: true,
      },
      { name: 'notes', type: 'text', label: '备注' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['status'], ['updated_at']],
  };
}

function buildAutoReplyRulesCollection() {
  return {
    name: 'auto_reply_rules',
    label: '白名单话术',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'trigger_pattern', type: 'string', label: '触发条件', required: true, indexed: true },
      {
        name: 'trigger_type',
        type: 'enum',
        label: '类型',
        options: ['keyword', 'regex'],
        default: 'keyword',
      },
      { name: 'reply_template', type: 'text', label: '回复模板', required: true },
      { name: 'category', type: 'string', label: '分类', indexed: true },
      { name: 'enabled', type: 'boolean', label: '启用', default: true },
      {
        name: 'status',
        type: 'enum',
        label: '审核状态',
        options: ['pending', 'active'],
        default: 'pending',
        indexed: true,
      },
      { name: 'match_count', type: 'integer', label: '命中次数', default: 0 },
      { name: 'last_matched_at', type: 'datetime', label: '上次命中' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
  };
}

function buildReminderRulesCollection() {
  return {
    name: 'reminder_rules',
    label: '提醒规则',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      {
        name: 'rule_type',
        type: 'enum',
        label: '触发类型',
        options: ['new_message', 'reply_timeout', 'keyword_hit', 'draft_backlog'],
        required: true,
        indexed: true,
      },
      { name: 'threshold_minutes', type: 'integer', label: '阈值（分钟）', default: 30 },
      { name: 'threshold_count', type: 'integer', label: '阈值（条数）', default: 5 },
      { name: 'keywords', type: 'text', label: '关键词（JSON 数组）' },
      { name: 'channels', type: 'text', label: '通道（JSON 数组）', default: '["in_app"]' },
      { name: 'enabled', type: 'boolean', label: '启用', default: true },
      { name: 'cooldown_minutes', type: 'integer', label: '冷却（分钟）', default: 10 },
      { name: 'last_triggered_at', type: 'datetime', label: '上次触发' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
  };
}

function buildKeywordAlertsCollection() {
  return {
    name: 'keyword_alerts',
    label: '关键词告警',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'keyword', type: 'string', label: '关键词', required: true, indexed: true },
      { name: 'conversation_id', type: 'string', label: '会话 ID', indexed: true },
      { name: 'buyer_name', type: 'string', label: '买家' },
      { name: 'message', type: 'text', label: '原始消息' },
      {
        name: 'severity',
        type: 'enum',
        label: '严重程度',
        options: ['low', 'medium', 'high'],
        default: 'medium',
        indexed: true,
      },
      { name: 'handled', type: 'boolean', label: '已处理', default: false, indexed: true },
      { name: 'handled_at', type: 'datetime', label: '处理时间' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
  };
}

function buildGoofishPages(): Record<string, unknown> {
  return {
    'pages/accounts.json': buildAccountsPage(),
    'pages/inbox.json': buildInboxPage(),
    'pages/drafts.json': buildDraftsPage(),
    'pages/draft-reply.json': buildDraftReplyPage(),
    'pages/items.json': buildItemsPage(),
    'pages/auto-reply.json': buildAutoReplyPage(),
    'pages/reminders.json': buildRemindersPage(),
    'pages/search.json': buildSearchPage(),
  };
}

function buildAccountsPage() {
  const boundaryCard = {
    type: 'card',
    title: '受控接入边界',
    children: [
      {
        type: 'markdown',
        content: [
          '- 账号安装、登录和同步必须来自 Lumos 的受控闲鱼集成。',
          '- 未安装、未登录或同步失败时，保持 `needs_auth` / `not_connected` / `failed`，不能显示假数据。',
          '- 第一阶段只读账号、会话、消息和商品；发送消息必须先生成草稿并由用户确认。',
        ].join('\n'),
      },
    ],
  };
  return {
    title: '闲鱼账号',
    description: '查看账号登录、同步状态和失败原因；未接入时必须显示需授权或失败原因。',
    layout: 'single',
    blocks: [boundaryCard, buildAccountsTable()],
  };
}

function buildAccountsTable() {
  return {
    type: 'table',
    data: '{{ db.goofish_accounts }}',
    columns: [
      { field: 'account_label', label: '账号', search: true },
      { field: 'login_status', label: '登录', render: 'tag' },
      { field: 'sync_status', label: '同步', render: 'tag' },
      { field: 'last_error', label: '失败原因', search: true },
      { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
    ],
    search: { fields: ['account_label', 'last_error'] },
    filter: [
      { field: 'login_status', options: ['needs_auth', 'ready', 'failed', 'unknown'] },
      { field: 'sync_status', options: ['not_connected', 'idle', 'syncing', 'success', 'failed'] },
    ],
    actions: {
      toolbar: [
        {
          label: '同步闲鱼数据',
          primary: true,
          run: 'native:goofish:sync',
          confirm: '确认通过 Lumos 受控闲鱼集成同步账号、买家会话和商品上下文？',
        },
        {
          label: '记录账号状态',
          run: 'db:create:goofish_accounts',
          input: {
            account_label: '待授权闲鱼账号',
            login_status: 'needs_auth',
            sync_status: 'not_connected',
            last_error: '请先在「扩展 > 闲鱼」完成安装、登录和同步授权。',
          },
        },
      ],
    },
  };
}

function buildInboxPage() {
  return {
    title: '买家会话',
    description: '集中查看待回复买家、商品上下文、最近消息和处理状态。',
    layout: 'list-detail',
    list: buildInboxList(),
    detail: { view: { form: buildInboxDetailForm(), submit: { label: '保存会话', run: 'db:update:buyer_conversations' } } },
  };
}

function buildInboxList() {
  return {
    type: 'table',
    data: '{{ db.buyer_conversations }}',
    columns: [
      { field: 'buyer_name', label: '买家', search: true },
      { field: 'item_title', label: '商品', search: true },
      { field: 'unread_count', label: '未读', sortable: true },
      { field: 'reply_status', label: '回复状态', render: 'tag' },
      { field: 'priority', label: '优先级', render: 'tag' },
      { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
    ],
    filter: [
      { field: 'reply_status', options: ['待回复', '已草稿', '待确认', '已回复', '忽略'] },
      { field: 'priority', options: ['普通', '重要', '紧急'] },
    ],
    actions: {
      toolbar: [
        {
          label: '同步闲鱼数据',
          primary: true,
          run: 'native:goofish:sync',
          confirm: '确认同步闲鱼买家会话到当前应用？',
        },
        {
          label: '新增待回复',
          run: 'db:create:buyer_conversations',
          input: {
            buyer_name: '待处理买家',
            item_title: '待关联商品',
            unread_count: 1,
            last_message: '从闲鱼同步接入前，可先手动记录需要回复的买家消息。',
            reply_status: '待回复',
            priority: '普通',
          },
        },
        { label: '写回复草稿', open: 'page:draft-reply' },
      ],
      row: [
        {
          label: '生成回复草稿',
          run: 'native:goofish:generate-reply-draft',
          confirm: '确认根据这条买家会话生成一条回复草稿？草稿只会保存，不会发送给买家。',
        },
      ],
    },
  };
}

function buildInboxDetailForm() {
  return [
    { type: 'text', name: 'conversation_id', label: '会话 ID', placeholder: '同步后由闲鱼集成写入' },
    { type: 'text', name: 'buyer_name', label: '买家', required: true },
    { type: 'text', name: 'item_title', label: '商品' },
    { type: 'number', name: 'unread_count', label: '未读数', min: 0, step: 1, default: 0 },
    { type: 'textarea', name: 'last_message', label: '最近消息', rows: 5 },
    {
      type: 'select',
      name: 'reply_status',
      label: '回复状态',
      options: ['待回复', '已草稿', '待确认', '已回复', '忽略'],
      default: '待回复',
    },
    {
      type: 'select',
      name: 'priority',
      label: '优先级',
      options: ['普通', '重要', '紧急'],
      default: '普通',
    },
    { type: 'textarea', name: 'notes', label: '备注', rows: 4 },
  ];
}

function buildDraftsPage() {
  const safetyCard = {
    type: 'card',
    title: '发送安全线',
    children: [
      {
        type: 'markdown',
        content: [
          '- AI 只能生成草稿；发送买家消息属于写操作。',
          '- 草稿必须绑定明确会话和接收方，且由用户在应用内或微信 IM 明确确认。',
          '- 自动无确认回复、批量发送和绕过闲鱼风控不进入第一阶段。',
        ].join('\n'),
      },
      { type: 'button', label: '新建草稿', primary: true, open: 'page:draft-reply' },
    ],
  };
  return {
    title: '回复草稿',
    description: '回复必须先以草稿形式保存，确认后才允许发送到明确会话。',
    layout: 'single',
    blocks: [safetyCard, buildDraftsTable()],
  };
}

function buildDraftsTable() {
  return {
    type: 'table',
    data: '{{ db.reply_drafts }}',
    columns: [
      { field: 'buyer_name', label: '买家', search: true },
      { field: 'item_title', label: '商品', search: true },
      { field: 'confirmation_code', label: '草稿编号', search: true },
      { field: 'status', label: '状态', render: 'tag' },
      { field: 'confirmation_channel', label: '确认方式', render: 'tag' },
      { field: 'draft_text', label: '草稿', search: true },
      { field: 'confirmation_expires_at', label: '确认有效期', render: 'date', sortable: true },
      { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
    ],
    search: { fields: ['buyer_name', 'item_title', 'confirmation_code', 'incoming_message', 'draft_text', 'risk_note'] },
    filter: [
      { field: 'status', options: ['draft', 'pending_confirmation', 'sent', 'failed', 'rejected'] },
    ],
    actions: {
      row: [
        {
          label: '确认发送',
          run: 'native:goofish:send-draft',
          input: { confirmed: true },
          confirm: '确认把这条草稿发送给对应闲鱼买家？发送后不可由 Lumos 撤回。',
        },
        {
          label: '拒绝草稿',
          run: 'native:goofish:reject-draft',
          input: { confirmed: true },
          confirm: '确认拒绝这条草稿？拒绝后不会发送，可重新生成新草稿。',
        },
      ],
    },
  };
}

function buildDraftReplyPage() {
  return {
    title: '写回复草稿',
    description: '记录买家消息、商品上下文和待确认回复；真正发送必须另行确认。',
    layout: 'form',
    form: [
      { type: 'text', name: 'conversation_id', label: '会话 ID', placeholder: '必须绑定明确闲鱼会话' },
      { type: 'text', name: 'buyer_name', label: '买家', required: true },
      { type: 'text', name: 'item_title', label: '商品' },
      { type: 'textarea', name: 'incoming_message', label: '买家消息', rows: 5 },
      { type: 'textarea', name: 'draft_text', label: '回复草稿', required: true, rows: 6 },
      {
        type: 'select',
        name: 'status',
        label: '状态',
        options: ['draft', 'pending_confirmation', 'sent', 'failed', 'rejected'],
        default: 'draft',
      },
      {
        type: 'select',
        name: 'confirmation_channel',
        label: '确认方式',
        options: ['应用内确认', '微信 IM 确认', '未确认'],
        default: '未确认',
      },
      {
        type: 'textarea',
        name: 'risk_note',
        label: '风险说明',
        rows: 3,
        placeholder: '例如：不承诺平台外交易、不承诺未核实库存、不绕过平台规则。',
      },
    ],
    submit: { label: '保存草稿', run: 'db:create:reply_drafts', render: 'none' },
  };
}

function buildItemsPage() {
  return {
    title: '商品标记',
    description: '第一阶段只做商品只读上下文、备注和待处理标记。',
    layout: 'list-detail',
    list: buildItemsList(),
    detail: { view: { form: buildItemsDetailForm(), submit: { label: '保存标记', run: 'db:update:item_marks' } } },
  };
}

function buildItemsList() {
  return {
    type: 'table',
    data: '{{ db.item_marks }}',
    columns: [
      { field: 'item_title', label: '商品', search: true },
      { field: 'item_id', label: '商品 ID', search: true },
      { field: 'status', label: '标记', render: 'tag' },
      { field: 'notes', label: '备注', search: true },
      { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
    ],
    filter: [{ field: 'status', options: ['只读', '待处理', '重点跟进', '已关闭'] }],
    actions: {
      toolbar: [
        {
          label: '新增商品标记',
          primary: true,
          run: 'db:create:item_marks',
          input: {
            item_title: '待关联商品',
            status: '只读',
            notes: '只记录上下文和备注，不改价、不下架、不删除。',
          },
        },
      ],
    },
  };
}

function buildItemsDetailForm() {
  return [
    { type: 'text', name: 'item_id', label: '商品 ID', placeholder: '同步后由闲鱼集成写入' },
    { type: 'text', name: 'item_title', label: '商品标题', required: true },
    {
      type: 'select',
      name: 'status',
      label: '标记',
      options: ['只读', '待处理', '重点跟进', '已关闭'],
      default: '只读',
    },
    { type: 'textarea', name: 'notes', label: '备注', rows: 5 },
  ];
}

function buildAutoReplyPage() {
  return {
    title: '白名单话术',
    description: '只有审核通过的白名单话术才会被自动回复使用；新增/修改后默认 pending，需在本页确认后才变 active。',
    layout: 'list-detail',
    list: buildAutoReplyList(),
    detail: { view: { form: buildAutoReplyDetailForm(), submit: { label: '保存白名单', run: 'db:update:auto_reply_rules' } } },
  };
}

function buildAutoReplyList() {
  return {
    type: 'table',
    data: '{{ db.auto_reply_rules }}',
    columns: [
      { field: 'trigger_pattern', label: '触发条件', search: true },
      { field: 'trigger_type', label: '类型', render: 'tag' },
      { field: 'category', label: '分类', search: true },
      { field: 'status', label: '审核状态', render: 'tag' },
      { field: 'enabled', label: '启用', render: 'tag' },
      { field: 'match_count', label: '命中次数', sortable: true },
      { field: 'last_matched_at', label: '上次命中', render: 'date', sortable: true },
      { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
    ],
    filter: [
      { field: 'status', options: ['pending', 'active'] },
      { field: 'trigger_type', options: ['keyword', 'regex'] },
    ],
    actions: {
      toolbar: [
        {
          label: '新增白名单',
          primary: true,
          run: 'db:create:auto_reply_rules',
          input: {
            trigger_pattern: '在吗',
            trigger_type: 'keyword',
            reply_template: '在的，请问需要了解哪款商品？',
            category: '招呼',
            enabled: true,
            status: 'pending',
          },
        },
      ],
      row: [
        {
          label: '审核通过',
          run: 'db:update:auto_reply_rules',
          input: { status: 'active' },
          confirm: '确认通过这条白名单话术？通过后才会被自动回复扫描使用。',
        },
      ],
    },
  };
}

function buildAutoReplyDetailForm() {
  return [
    { type: 'text', name: 'trigger_pattern', label: '触发条件', required: true },
    {
      type: 'select',
      name: 'trigger_type',
      label: '类型',
      options: ['keyword', 'regex'],
      default: 'keyword',
    },
    { type: 'textarea', name: 'reply_template', label: '回复模板', required: true, rows: 5 },
    { type: 'text', name: 'category', label: '分类', placeholder: '例如：招呼/议价/物流' },
    { type: 'switch', name: 'enabled', label: '启用', default: true },
    {
      type: 'select',
      name: 'status',
      label: '审核状态',
      options: ['pending', 'active'],
      default: 'pending',
      description: '修改触发条件或回复模板后必须重新审核。',
    },
  ];
}

function buildRemindersPage() {
  return {
    title: '提醒规则',
    description: '配置触发类型、阈值、通道和冷却；微信/桌面通道不可达时只触发应用内提醒。',
    layout: 'list-detail',
    list: buildRemindersList(),
    detail: { view: { form: buildRemindersDetailForm(), submit: { label: '保存提醒规则', run: 'db:update:reminder_rules' } } },
  };
}

function buildRemindersList() {
  return {
    type: 'table',
    data: '{{ db.reminder_rules }}',
    columns: [
      { field: 'rule_type', label: '触发类型', render: 'tag' },
      { field: 'threshold_minutes', label: '阈值（分钟）', sortable: true },
      { field: 'threshold_count', label: '阈值（条数）', sortable: true },
      { field: 'channels', label: '通道', search: true },
      { field: 'enabled', label: '启用', render: 'tag' },
      { field: 'cooldown_minutes', label: '冷却（分钟）', sortable: true },
      { field: 'last_triggered_at', label: '上次触发', render: 'date', sortable: true },
      { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
    ],
    filter: [
      { field: 'rule_type', options: ['new_message', 'reply_timeout', 'keyword_hit', 'draft_backlog'] },
    ],
    actions: {
      toolbar: [
        {
          label: '新增提醒规则',
          primary: true,
          run: 'db:create:reminder_rules',
          input: {
            rule_type: 'reply_timeout',
            threshold_minutes: 30,
            threshold_count: 5,
            channels: '["in_app"]',
            enabled: true,
            cooldown_minutes: 10,
          },
        },
      ],
    },
  };
}

function buildRemindersDetailForm() {
  return [
    {
      type: 'select',
      name: 'rule_type',
      label: '触发类型',
      required: true,
      options: ['new_message', 'reply_timeout', 'keyword_hit', 'draft_backlog'],
    },
    { type: 'number', name: 'threshold_minutes', label: '阈值（分钟）', min: 1, step: 1, default: 30 },
    { type: 'number', name: 'threshold_count', label: '阈值（条数）', min: 1, step: 1, default: 5 },
    {
      type: 'textarea',
      name: 'keywords',
      label: '关键词（JSON 数组）',
      rows: 3,
      placeholder: '例如：["退款","投诉","质量"]',
    },
    {
      type: 'textarea',
      name: 'channels',
      label: '通道（JSON 数组）',
      rows: 2,
      placeholder: '从 in_app / wechat / desktop 三选；例如 ["in_app","wechat"]',
      description: 'in_app 始终可达；wechat 需 IM 桥连通；desktop 仅写审计字段，待平台 NotificationCenter 前端接入后才会真正弹窗。',
    },
    { type: 'switch', name: 'enabled', label: '启用', default: true },
    { type: 'number', name: 'cooldown_minutes', label: '冷却（分钟）', min: 0, step: 1, default: 10 },
  ];
}

function buildSearchPage() {
  return {
    title: '搜索',
    description: '在 4 个范围内搜索：店内商品、历史会话、买家档案、全平台市场（市场不可达时显示 not_connected）。',
    layout: 'form',
    form: [
      {
        type: 'select',
        name: 'scope',
        label: '搜索范围',
        required: true,
        options: [
          { value: 'history', label: '历史会话' },
          { value: 'buyer', label: '买家档案' },
          { value: 'market', label: '全平台市场（依赖账号 cookies）' },
          { value: 'shop', label: '店内商品（暂未接入）' },
        ],
        default: 'history',
        description: 'history/buyer 本地可达；market 走内置浏览器需账号 cookies 在线；shop 当前缺底层"列出本店商品"能力，不可达时返回 not_connected。',
      },
      { type: 'text', name: 'query', label: '搜索词', required: true, placeholder: '输入关键词' },
      { type: 'number', name: 'limit', label: '返回上限', min: 1, max: 50, step: 1, default: 10 },
    ],
    submit: { label: '执行搜索', run: 'native:goofish:search', render: 'none' },
  };
}

function buildGoofishAutomationPresets() {
  return [
    {
      label: '添加同步自动化',
      primary: true,
      input: {
        title: '同步闲鱼数据',
        enabled: true,
        schedule: '每 2 小时',
        native_action: 'goofish:sync',
        description: '通过 Lumos 受控闲鱼集成同步账号、买家会话和商品只读上下文。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary: '可点击「立即运行」执行一次同步；点击「同步定时任务」后会注册为 Lumos 定时任务。',
      },
    },
    {
      label: '添加自动回复扫描',
      input: {
        title: '白名单自动回复扫描',
        enabled: false,
        schedule: '每 1 分钟',
        native_action: 'goofish:auto-reply-scan',
        description: '扫描新买家消息：命中已 active 白名单且通过频控的自动回复，否则生成草稿待确认。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请先在白名单话术页审核启用至少一条规则。',
      },
    },
    {
      label: '添加提醒检查',
      input: {
        title: '提醒规则检查',
        enabled: false,
        schedule: '每 5 分钟',
        native_action: 'goofish:check-reminders',
        description: '按已启用的提醒规则检查：新消息 / 回复超时 / 关键词命中 / 草稿堆积，命中后写入应用通知中心和（可选）微信、桌面渠道。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请先在提醒规则页配置至少一条规则。',
      },
    },
  ];
}

function buildGoofishCommandPresets() {
  return [
    ...buildGoofishCoreCommandPresets(),
    ...buildGoofishDraftCommandPresets(),
    ...buildGoofishExtensionCommandPresets(),
  ];
}

function buildGoofishCoreCommandPresets() {
  return [
    {
      label: '添加状态命令',
      primary: true,
      input: {
        command: '/goofish status',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '可点击「测试命令」查看当前应用内闲鱼账号状态；外部微信也可发送 /goofish status 查询。',
      },
    },
    {
      label: '添加未读命令',
      input: {
        command: '/goofish unread',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '可点击「测试命令」查看当前应用内未读买家会话；外部微信也可发送 /goofish unread 查询。',
      },
    },
    {
      label: '添加同步命令',
      input: {
        command: '/goofish sync',
        risk_level: 'low_write',
        confirmation_required: true,
        status: 'draft',
        result_summary: '可点击「测试命令」并确认后触发受控闲鱼同步；外部微信只记录同步请求，不会静默同步。',
      },
    },
  ];
}

function buildGoofishDraftCommandPresets() {
  return [
    {
      label: '添加草稿命令',
      input: {
        command: '/goofish draft 待处理买家',
        risk_level: 'low_write',
        confirmation_required: false,
        status: 'draft',
        result_summary: '可点击「测试命令」为匹配买家生成本地回复草稿；外部微信也可发送 /goofish draft <买家或商品>，不会发送给买家。',
      },
    },
    {
      label: '添加草稿列表命令',
      input: {
        command: '/goofish drafts',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '可点击「测试命令」查看待确认回复草稿；外部微信也可发送 /goofish drafts 获取草稿编号。',
      },
    },
    {
      label: '添加确认草稿命令',
      input: {
        command: '/goofish confirm 草稿编号',
        risk_level: 'low_write',
        confirmation_required: true,
        status: 'draft',
        result_summary: '外部微信可发送 /goofish confirm <草稿编号> 显式确认单条未过期草稿；缺草稿编号或草稿过期会被拒绝。',
      },
    },
    {
      label: '添加拒绝草稿命令',
      input: {
        command: '/goofish reject 草稿编号',
        risk_level: 'low_write',
        confirmation_required: true,
        status: 'draft',
        result_summary: '外部微信可发送 /goofish reject <草稿编号> 拒绝单条待确认草稿，不会发送给买家。',
      },
    },
  ];
}

function buildGoofishExtensionCommandPresets() {
  return [
    {
      label: '添加白名单查看命令',
      input: {
        command: '/goofish whitelist list',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看当前白名单话术规则及审核状态；外部微信只读。',
      },
    },
    {
      label: '添加白名单新增命令',
      input: {
        command: '/goofish whitelist add <pattern> <reply>',
        risk_level: 'high',
        confirmation_required: true,
        status: 'draft',
        result_summary: '通过 IM 新增白名单话术，写入 pending 状态，必须回到应用内审核才会 active。',
      },
    },
    {
      label: '添加提醒查看命令',
      input: {
        command: '/goofish reminders',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看当前已配置提醒规则及最近触发时间。',
      },
    },
    {
      label: '添加搜索命令',
      input: {
        command: '/goofish search <scope> <query>',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '在应用内执行搜索；scope=shop/history/buyer 可达，market 不可达时返回未接入提示。',
      },
    },
  ];
}

function buildCustomerTrackerFiles(
  session: BuilderSession,
  opts: { now?: number },
): Record<string, string> {
  const app = { ...baseApp(session, opts, 'office'), entry: 'customers' };
  const routes = withNativeShellRoutes({
    default: 'customers',
    menu: [
      { id: 'customers', label: '客户', icon: 'users', page: 'pages/customers.json' },
      { id: 'new-customer', label: '新增', icon: 'plus', page: 'pages/new-customer.json' },
    ],
  });
  const dataSchema = withNativeShellCollections({
    collections: [
      {
        name: 'customers',
        label: '客户',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'name', type: 'string', label: '客户名称', required: true, indexed: true },
          { name: 'contact', type: 'string', label: '联系人', indexed: true },
          {
            name: 'status',
            type: 'enum',
            label: '跟进状态',
            options: ['新线索', '沟通中', '已成交', '暂缓'],
            default: '新线索',
            indexed: true,
          },
          { name: 'next_followup', type: 'date', label: '下次跟进' },
          { name: 'notes', type: 'text', label: '备注' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['status'], ['next_followup'], ['updated_at']],
      },
    ],
  });
  const listPage = {
    title: '客户工作台',
    description: '查看客户状态、联系人和下一步跟进安排。',
    layout: 'single',
    blocks: [
      {
        type: 'card',
        title: '今日重点',
        children: [
          { type: 'markdown', content: '优先处理「沟通中」和即将到期的跟进客户。' },
          { type: 'button', label: '新增客户', primary: true, open: 'page:new-customer' },
        ],
      },
      {
        type: 'table',
        data: '{{ db.customers }}',
        columns: [
          { field: 'name', label: '客户名称', search: true },
          { field: 'contact', label: '联系人', search: true },
          { field: 'status', label: '状态', render: 'tag' },
          { field: 'next_followup', label: '下次跟进', render: 'date', sortable: true },
          { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
        ],
        search: { fields: ['name', 'contact', 'notes'] },
        actions: {
          toolbar: [{ label: '新增客户', open: 'page:new-customer', primary: true }],
        },
      },
    ],
  };
  const formPage = {
    title: '新增客户',
    description: '录入客户资料和第一次跟进安排。',
    layout: 'form',
    form: [
      { type: 'text', name: 'name', label: '客户名称', required: true, placeholder: '输入客户或公司名称' },
      { type: 'text', name: 'contact', label: '联系人', placeholder: '姓名 / 电话 / 微信' },
      {
        type: 'select',
        name: 'status',
        label: '跟进状态',
        options: ['新线索', '沟通中', '已成交', '暂缓'],
        default: '新线索',
      },
      { type: 'text', name: 'next_followup', label: '下次跟进', placeholder: '例如：2026-05-08' },
      { type: 'textarea', name: 'notes', label: '备注', rows: 5 },
    ],
    submit: { label: '保存客户', run: 'db:create:customers', render: 'none' },
  };
  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildNativeAppSpec({
      appName: app.name,
      summary: '管理客户资料、跟进状态、备注和下一次跟进安排。',
      userVisibleScope: [
        '打开客户工作台查看客户列表和状态。',
        '新增客户并保存联系人、状态、下次跟进和备注。',
        '按客户名称、联系人或备注搜索客户记录。',
      ],
      entities: ['customers'],
      acceptance: [
        ['open-customers', '打开客户工作台', '进入应用后默认看到客户工作台和今日重点。'],
        ['create-customer', '新增客户', '点击新增客户，填写表单并保存一条客户记录。'],
        ['list-customers', '查看客户列表', '回到客户工作台后能看到刚保存的客户。'],
        ['search-customers', '搜索客户', '在列表里按客户名称、联系人或备注搜索。'],
        ['status-empty-error', '验证状态', '无数据、加载中或保存失败时界面给出明确状态。'],
      ],
    }),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    'pages/customers.json': listPage,
    'pages/new-customer.json': formPage,
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'customers',
      primaryCollection: 'customers',
      primaryCollectionLabel: '客户',
    }),
  });
}

function buildWeeklyReportFiles(
  session: BuilderSession,
  opts: { now?: number },
): Record<string, string> {
  const app = { ...baseApp(session, opts, 'office'), entry: 'reports' };
  const routes = withNativeShellRoutes({
    default: 'reports',
    menu: [
      { id: 'reports', label: '周报', icon: 'file-text', page: 'pages/reports.json' },
      { id: 'new-report', label: '填写', icon: 'plus', page: 'pages/new-report.json' },
    ],
  });
  const dataSchema = withNativeShellCollections({
    collections: [
      {
        name: 'reports',
        label: '周报',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'week', type: 'string', label: '周期', required: true, indexed: true },
          { name: 'done', type: 'text', label: '本周完成' },
          { name: 'risks', type: 'text', label: '风险问题' },
          { name: 'next_plan', type: 'text', label: '下周计划' },
          {
            name: 'status',
            type: 'enum',
            label: '状态',
            options: ['草稿', '待发送', '已发送'],
            default: '草稿',
            indexed: true,
          },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['week'], ['status'], ['updated_at']],
      },
    ],
  });
  const listPage = {
    title: '周报列表',
    description: '集中查看每周周报草稿和发送状态。',
    layout: 'single',
    blocks: [
      {
        type: 'card',
        title: '周报草稿',
        children: [
          { type: 'markdown', content: '先记录关键事项，后续可让 AI 把内容整理成正式周报。' },
          { type: 'button', label: '填写本周周报', primary: true, open: 'page:new-report' },
        ],
      },
      {
        type: 'table',
        data: '{{ db.reports }}',
        columns: [
          { field: 'week', label: '周期', search: true },
          { field: 'status', label: '状态', render: 'tag' },
          { field: 'done', label: '本周完成', search: true },
          { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
        ],
        search: { fields: ['week', 'done', 'risks', 'next_plan'] },
        actions: {
          toolbar: [{ label: '填写周报', open: 'page:new-report', primary: true }],
        },
      },
    ],
  };
  const formPage = {
    title: '填写周报',
    description: '记录本周完成、风险和下周计划。',
    layout: 'form',
    form: [
      { type: 'text', name: 'week', label: '周期', required: true, placeholder: '例如：2026-W18' },
      { type: 'textarea', name: 'done', label: '本周完成', rows: 5 },
      { type: 'textarea', name: 'risks', label: '风险问题', rows: 4 },
      { type: 'textarea', name: 'next_plan', label: '下周计划', rows: 4 },
      {
        type: 'select',
        name: 'status',
        label: '状态',
        options: ['草稿', '待发送', '已发送'],
        default: '草稿',
      },
    ],
    submit: { label: '保存周报', run: 'db:create:reports', render: 'none' },
  };
  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildNativeAppSpec({
      appName: app.name,
      summary: '记录每周工作事项、风险、计划和周报草稿状态。',
      userVisibleScope: [
        '打开周报列表查看历史周报草稿和发送状态。',
        '填写本周完成、风险问题、下周计划并保存。',
        '按周期、完成事项或计划内容搜索周报记录。',
      ],
      entities: ['reports'],
      acceptance: [
        ['open-reports', '打开周报列表', '进入应用后默认看到周报列表和周报草稿入口。'],
        ['create-report', '填写周报', '点击填写周报，录入周期、完成事项、风险和计划。'],
        ['list-reports', '查看周报记录', '保存后在列表中看到本周周报。'],
        ['search-reports', '搜索周报', '按周期或正文关键词搜索历史周报。'],
        ['status-empty-error', '验证状态', '空列表和保存失败时界面给出明确状态。'],
      ],
    }),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    'pages/reports.json': listPage,
    'pages/new-report.json': formPage,
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'reports',
      primaryCollection: 'reports',
      primaryCollectionLabel: '周报',
    }),
  });
}

function buildResourceLibraryFiles(
  session: BuilderSession,
  opts: { now?: number },
): Record<string, string> {
  const app = { ...baseApp(session, opts, 'research'), entry: 'resources' };
  const routes = withNativeShellRoutes({
    default: 'resources',
    menu: [
      { id: 'resources', label: '资料', icon: 'library', page: 'pages/resources.json' },
      { id: 'new-resource', label: '新增', icon: 'plus', page: 'pages/new-resource.json' },
    ],
  });
  const dataSchema = withNativeShellCollections({
    collections: [
      {
        name: 'resources',
        label: '资料',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'title', type: 'string', label: '标题', required: true, indexed: true },
          { name: 'url', type: 'string', label: '链接' },
          { name: 'tags', type: 'string', label: '标签', indexed: true },
          {
            name: 'status',
            type: 'enum',
            label: '处理状态',
            options: ['待阅读', '整理中', '已归档'],
            default: '待阅读',
            indexed: true,
          },
          { name: 'summary', type: 'text', label: '摘要' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['status'], ['tags'], ['updated_at']],
      },
    ],
  });
  const listPage = {
    title: '资料库',
    description: '保存资料来源、标签、处理状态和摘要。',
    layout: 'single',
    blocks: [
      {
        type: 'card',
        title: '收集入口',
        children: [
          { type: 'markdown', content: '把链接、摘要和后续动作集中在这里，便于后续检索和复用。' },
          { type: 'button', label: '新增资料', primary: true, open: 'page:new-resource' },
        ],
      },
      {
        type: 'table',
        data: '{{ db.resources }}',
        columns: [
          { field: 'title', label: '标题', search: true },
          { field: 'tags', label: '标签', search: true },
          { field: 'status', label: '状态', render: 'tag' },
          { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
        ],
        search: { fields: ['title', 'tags', 'summary', 'url'] },
        actions: {
          toolbar: [{ label: '新增资料', open: 'page:new-resource', primary: true }],
        },
      },
    ],
  };
  const formPage = {
    title: '新增资料',
    description: '保存资料链接、标签和初步摘要。',
    layout: 'form',
    form: [
      { type: 'text', name: 'title', label: '标题', required: true, placeholder: '输入资料标题' },
      { type: 'text', name: 'url', label: '链接', placeholder: 'https://...' },
      { type: 'text', name: 'tags', label: '标签', placeholder: '用逗号分隔' },
      {
        type: 'select',
        name: 'status',
        label: '处理状态',
        options: ['待阅读', '整理中', '已归档'],
        default: '待阅读',
      },
      { type: 'textarea', name: 'summary', label: '摘要', rows: 5 },
    ],
    submit: { label: '保存资料', run: 'db:create:resources', render: 'none' },
  };
  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildNativeAppSpec({
      appName: app.name,
      summary: '保存资料链接、标签、处理状态和摘要，形成可持续整理的资料库。',
      userVisibleScope: [
        '打开资料库查看资料列表、标签和处理状态。',
        '新增资料链接、标签、状态和摘要。',
        '按标题、标签、摘要或链接搜索资料。',
      ],
      entities: ['resources'],
      acceptance: [
        ['open-resources', '打开资料库', '进入应用后默认看到资料库和新增资料入口。'],
        ['create-resource', '新增资料', '点击新增资料，填写标题、链接、标签、状态和摘要。'],
        ['list-resources', '查看资料列表', '保存后在资料库列表看到新资料。'],
        ['search-resources', '搜索资料', '按标题、标签、摘要或链接搜索资料记录。'],
        ['status-empty-error', '验证状态', '无资料、加载中或保存失败时界面给出明确状态。'],
      ],
    }),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    'pages/resources.json': listPage,
    'pages/new-resource.json': formPage,
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'resources',
      primaryCollection: 'resources',
      primaryCollectionLabel: '资料',
    }),
  });
}

function buildNativeAppSpec({
  appName,
  summary,
  userVisibleScope,
  entities,
  acceptance,
}: {
  appName: string;
  summary: string;
  userVisibleScope: string[];
  entities: string[];
  acceptance: Array<[id: string, label: string, howToVerify: string]>;
}) {
  return {
    version: 1,
    summary: `${appName}：${summary}`,
    userVisibleScope: [
      ...userVisibleScope,
      '打开状态页查看就绪状态、未接入能力和运行记录数量。',
      '进入设置页保存默认视图、通知方式、AI 提示词、自动化开关和风险边界。',
      '进入运行结果页查看运行状态、结果摘要和失败原因。',
    ],
    status: {
      states: ['not_configured', 'ready', 'running', 'failed', 'not_connected'],
      readyCriteria: [
        '应用页面可打开。',
        '本地数据集合可读写。',
        '核心列表或表单能返回真实状态。',
      ],
      notConnectedBehavior: '如果后续接入 AI、工作流、IM 或外部服务失败，页面必须显示未接入或失败原因，而不是展示假结果。',
    },
    settings: [
      {
        id: 'general',
        label: '基础设置',
        fields: ['应用名称', '默认视图', '数据保存位置说明'],
      },
    ],
    data: {
      entities: [
        ...entities,
        'app_settings',
        'app_automations',
        'run_history',
        'assistant_messages',
        'app_notifications',
        'app_command_runs',
        'acceptance_checks',
      ],
      reusableStores: ['settings', 'run_history', 'user_marks'],
    },
    ai: {
      enabled: false,
      promptSettings: false,
      draftBeforeWrite: true,
      visibleFailureHandling: true,
    },
    automations: {
      enabled: false,
      controls: ['run_now', 'edit', 'delete'],
      visibleRunResults: true,
    },
    runResults: {
      visible: true,
      states: ['running', 'success', 'failed', 'cancelled'],
      failureReasons: true,
      retry: true,
    },
    im: {
      enabled: false,
      lowRiskCommands: [],
      confirmationRequiredFor: ['所有写操作'],
      visibleCommandResults: true,
    },
    risk: {
      writeActionsRequireConfirmation: true,
      highRiskActions: ['批量删除数据', '覆盖已有记录', '向外部系统发送消息'],
      outOfScope: ['未声明权限的外部系统操作', '未确认的批量写操作'],
    },
    acceptance: [
      {
        id: 'installation-self-check',
        label: '安装自检',
        howToVerify: '安装完成后查看安装自检结果，或在状态页点击重新运行安装自检；通过或失败会自动写入本验收项。',
      },
      ...acceptance.map(([id, label, howToVerify]) => ({ id, label, howToVerify })),
      {
        id: 'open-status',
        label: '查看状态页',
        howToVerify: '打开状态页，能看到主数据数量、设置数量、运行记录数量和未接入能力说明。',
      },
      {
        id: 'save-settings',
        label: '保存设置',
        howToVerify: '进入设置页，保存默认视图、通知方式、AI 提示词、自动化开关和风险边界。',
      },
      {
        id: 'review-run-history',
        label: '查看运行结果',
        howToVerify: '进入运行结果页，能看到运行状态、结果摘要、失败原因和更新时间。',
      },
    ],
  };
}

function buildGoofishNativeAppSpec(appName: string) {
  return {
    version: 1,
    summary: `${appName}：管理闲鱼买家会话、AI 回复草稿、商品标记、白名单自动回复、分级提醒、4 范围搜索、微信 IM 通知命令和低风险自动化边界。`,
    userVisibleScope: buildGoofishUserVisibleScope(),
    status: buildGoofishStatus(),
    settings: buildGoofishSettings(),
    data: {
      entities: [
        'goofish_accounts',
        'buyer_conversations',
        'reply_drafts',
        'item_marks',
        'auto_reply_rules',
        'reminder_rules',
        'keyword_alerts',
        'app_settings',
        'app_automations',
        'run_history',
        'assistant_messages',
        'app_notifications',
        'app_command_runs',
        'acceptance_checks',
      ],
      reusableStores: ['settings', 'drafts', 'notifications', 'command_runs', 'run_history', 'user_marks'],
    },
    ai: {
      enabled: true,
      promptSettings: true,
      draftBeforeWrite: true,
      visibleFailureHandling: true,
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
    im: buildGoofishIm(),
    risk: buildGoofishRisk(),
    acceptance: buildGoofishAcceptance(),
  };
}

function buildGoofishUserVisibleScope() {
  return [
    '打开闲鱼账号页查看安装、登录、同步状态和失败原因。',
    '点击同步闲鱼数据，把受控闲鱼集成里的账号、买家会话和商品只读上下文写入应用隔离集合。',
    '打开买家会话页查看待回复买家、商品上下文、最近消息和处理状态。',
    '创建回复草稿，草稿必须绑定明确会话和买家，发送前保持待确认。',
    '进入商品标记页记录商品只读上下文、备注和待处理标记。',
    '进入白名单话术页新增/审核分级自动回复模板（pending → active）。',
    '进入提醒规则页配置触发类型、阈值、通道和冷却。',
    '进入搜索页在 shop/history/buyer/market 4 个范围内检索；market 不可达时显示 not_connected。',
    '进入通知命令页记录微信 IM 通知目标、低风险命令和确认边界。',
    '进入自动化和运行结果页查看同步、白名单扫描、提醒检查、未读检查、摘要任务的未接入或失败状态。',
  ];
}

function buildGoofishStatus() {
  return {
    states: ['not_configured', 'needs_auth', 'ready', 'syncing', 'running', 'failed', 'not_connected'],
    readyCriteria: [
      '应用页面可打开，设置页已保存基础风险边界。',
      '闲鱼账号安装、登录和同步状态可见。',
      '买家会话、回复草稿、商品标记、白名单话术、提醒规则和运行结果集合可读写。',
      'IM 或自动化未接入时必须显示 not_connected 和失败原因。',
    ],
    notConnectedBehavior: '缺安装、缺登录、同步失败、IM 桥、自动化桥或全平台搜索 MCP 未接入时，页面必须显示未接入 / 需授权 / 失败原因，不能展示假结果。app_notifications 的 in_app 渠道当前仅写记录、状态停在 ready，前端 NotificationCenter 接入前用户在状态页可看到列表但不弹窗，桌面渠道同此约束。',
  };
}

function buildGoofishSettings() {
  return [
    { id: 'goofish', label: '闲鱼接入', fields: ['安装检测', '账号登录状态', '同步频率', '同步失败提示'] },
    { id: 'reply-ai', label: 'AI 回复', fields: ['AI 提示词', '禁止承诺', '议价边界', '售后语气', '输出格式'] },
    { id: 'im', label: '微信 IM', fields: ['通知目标', '低风险命令', '确认方式', '命令结果可见'] },
    { id: 'risk', label: '风险边界', fields: ['写操作确认', '高风险不做项', '失败时保留草稿'] },
    { id: 'auto-reply', label: '分级自动回复', fields: ['白名单总开关', '频控阈值', '审核要求', '熔断'] },
    { id: 'reminder', label: '提醒规则', fields: ['触发类型', '阈值', '通道', '冷却'] },
    { id: 'search', label: '搜索范围', fields: ['默认 scope', '市场调研可达性提示', 'shop 接入状态提示（当前未接入）'] },
  ];
}

function buildGoofishIm() {
  return {
    enabled: true,
    lowRiskCommands: [
      '/goofish status',
      '/goofish unread',
      '/goofish drafts',
      '/goofish sync',
      '/goofish draft <conversation>',
      '/goofish confirm <draft>',
      '/goofish reject <draft>',
      '/goofish whitelist list',
      '/goofish reminders',
      '/goofish search <scope> <query>',
    ],
    confirmationRequiredFor: [
      '发送买家回复草稿',
      'IM 命令触发低风险写操作',
      '通过 IM 新增白名单话术（写入 pending 后必须应用内审核）',
    ],
    visibleCommandResults: true,
  };
}

function buildGoofishRisk() {
  return {
    writeActionsRequireConfirmation: true,
    highRiskActions: [
      '发送买家消息',
      '确认 IM 命令触发的低风险写操作',
      '修改白名单话术（必须先 pending 后 active）',
      '修改提醒关键词',
      '手动触发全平台市场搜索（如可达）',
    ],
    outOfScope: [
      '白名单外的自动回复',
      '发布商品',
      '改价',
      '下架或删除商品',
      '批量修改商品',
      '绕过闲鱼风控的浏览器自动化',
      '修改白名单话术后未在应用内审核即生效',
      '白名单话术绕过频控',
      '自动列出本店全部上架商品（缺底层能力）',
      '桌面通知渠道实际触发（NotificationCenter 前端未接入）',
    ],
  };
}

function buildGoofishAcceptance() {
  return [
    { id: 'installation-self-check', label: '安装自检', howToVerify: '安装完成后查看安装自检结果，或在状态页点击重新运行安装自检；通过或失败会自动写入本验收项。' },
    { id: 'open-accounts', label: '查看账号状态', howToVerify: '打开账号页，能看到登录、同步状态和未接入 / 需授权说明。' },
    { id: 'open-inbox', label: '查看买家会话', howToVerify: '打开买家会话页，能看到买家、商品、未读数、回复状态和优先级。' },
    { id: 'sync-goofish-data', label: '同步闲鱼数据', howToVerify: '点击同步闲鱼数据；未安装或未登录时运行结果写入明确失败原因，已登录时买家会话和商品标记会写入应用内集合。' },
    { id: 'create-conversation', label: '新增待回复会话', howToVerify: '点击新增待回复，列表里出现一条待处理买家记录。' },
    { id: 'create-draft', label: '保存回复草稿', howToVerify: '打开买家会话页，点击某条会话的生成回复草稿；或打开写草稿页手动录入并保存，草稿列表可见。' },
    { id: 'draft-confirmation', label: '确认发送边界', howToVerify: '草稿页显示发送前需确认；点击确认发送只会发送绑定了明确会话和买家 ID 的草稿，自动无确认回复不在可操作范围内。' },
    { id: 'mark-item', label: '记录商品标记', howToVerify: '打开商品标记页，新增只读商品备注和待处理标记。' },
    { id: 'save-settings', label: '保存提示词和风险边界', howToVerify: '进入设置页，保存 AI 提示词、通知方式、自动化开关和风险边界。' },
    { id: 'review-im-commands', label: '查看 IM 命令模板', howToVerify: '进入通知命令页，能看到低风险命令、确认要求和命令结果状态。' },
    { id: 'review-automations', label: '查看自动化', howToVerify: '进入自动化页，能看到同步、未读检查或摘要任务的未接入 / 运行状态。' },
    { id: 'review-run-history', label: '查看运行结果', howToVerify: '进入运行结果页，能看到运行状态、结果摘要、失败原因和重试入口说明。' },
    { id: 'whitelist-pending-flow', label: '白名单审核流', howToVerify: '新增/修改白名单话术后，状态显示 pending；在白名单页点击审核通过后才变 active；只有 active 规则会被自动回复扫描使用。' },
    { id: 'whitelist-throttle', label: '频控降级', howToVerify: '同一买家 5 分钟内重复命中白名单时，第二次起降级为草稿；运行结果显示 throttled 计数。' },
    { id: 'reminder-cooldown', label: '提醒冷却', howToVerify: '同一规则在 cooldown_minutes 内不会重复触发提醒。' },
    { id: 'reminder-channels', label: '多渠道提醒', howToVerify: '配置 in_app/wechat/desktop 时：in_app 必写 app_notifications；wechat 需 IM 桥连通，否则在 last_error 显示「IM 桥未连通」但不阻塞 in_app；desktop 当前仅写审计字段，待平台 NotificationCenter 前端接入后才会真正弹桌面窗。' },
    { id: 'search-scope-reach', label: '搜索范围可达性', howToVerify: '搜索页切换 4 个 scope：history/buyer 走本地集合可达；market 走内置浏览器后台模式 + 账号 cookies 可达，未登录或被风控时返回 not_reachable + 原因；shop 当前缺底层「列出本店商品」能力，固定返回 not_reachable，不允许 mock 冒充。' },
  ];
}

function stringifyFiles(files: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      `${JSON.stringify(content, null, 2)}\n`,
    ]),
  );
}

function toAppId(name: string, sessionId: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const base = slug.length >= 3 ? slug : `app-${sessionId.replace(/^bs_/, '').slice(0, 8)}`;
  return /^[a-z]/.test(base) ? base : `app-${base}`.slice(0, 64);
}
