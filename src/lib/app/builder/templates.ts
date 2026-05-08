import type { BuilderSession } from './session';
import {
  buildNativeShellPages,
  withNativeShellCollections,
  withNativeShellRoutes,
} from './native-shell-blueprint';

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
    id: toAppId(appName, session.id),
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
    ],
  });
  const dataSchema = withNativeShellCollections({
    collections: [
      {
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
      },
      {
        name: 'buyer_conversations',
        label: '买家会话',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'conversation_id', type: 'string', label: '会话 ID', indexed: true },
          { name: 'buyer_name', type: 'string', label: '买家', required: true, indexed: true },
          { name: 'item_title', type: 'string', label: '商品', indexed: true },
          { name: 'unread_count', type: 'integer', label: '未读数', default: 0, indexed: true },
          { name: 'last_message', type: 'text', label: '最近消息' },
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
      },
      {
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
            options: ['应用内确认', '微信 IM 确认', '未确认'],
            default: '未确认',
          },
          { name: 'confirmation_code', type: 'string', label: '草稿编号', indexed: true },
          { name: 'confirmation_expires_at', type: 'datetime', label: '确认有效期' },
          { name: 'risk_note', type: 'text', label: '风险说明' },
          { name: 'failure_reason', type: 'text', label: '失败原因' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['conversation_id'], ['status'], ['confirmation_code'], ['updated_at']],
      },
      {
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
      },
    ],
  });

  const accountsPage = {
    title: '闲鱼账号',
    description: '查看账号登录、同步状态和失败原因；未接入时必须显示需授权或失败原因。',
    layout: 'single',
    blocks: [
      {
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
      },
      {
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
      },
    ],
  };

  const inboxPage = {
    title: '买家会话',
    description: '集中查看待回复买家、商品上下文、最近消息和处理状态。',
    layout: 'list-detail',
    list: {
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
    },
    detail: {
      view: {
        form: [
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
        ],
        submit: { label: '保存会话', run: 'db:update:buyer_conversations' },
      },
    },
  };

  const draftsPage = {
    title: '回复草稿',
    description: '回复必须先以草稿形式保存，确认后才允许发送到明确会话。',
    layout: 'single',
    blocks: [
      {
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
      },
      {
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
      },
    ],
  };

  const draftReplyPage = {
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

  const itemsPage = {
    title: '商品标记',
    description: '第一阶段只做商品只读上下文、备注和待处理标记。',
    layout: 'list-detail',
    list: {
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
    },
    detail: {
      view: {
        form: [
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
        ],
        submit: { label: '保存标记', run: 'db:update:item_marks' },
      },
    },
  };

  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildGoofishNativeAppSpec(app.name),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    'pages/accounts.json': accountsPage,
    'pages/inbox.json': inboxPage,
    'pages/drafts.json': draftsPage,
    'pages/draft-reply.json': draftReplyPage,
    'pages/items.json': itemsPage,
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'inbox',
      primaryCollection: 'buyer_conversations',
      primaryCollectionLabel: '买家会话',
      automationPresets: [
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
      ],
      commandPresets: [
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
          label: '添加同步命令',
          input: {
            command: '/goofish sync',
            risk_level: 'low_write',
            confirmation_required: true,
            status: 'draft',
            result_summary: '可点击「测试命令」并确认后触发受控闲鱼同步；外部微信只记录同步请求，不会静默同步。',
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
      ],
    }),
  });
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
    summary: `${appName}：管理闲鱼买家会话、AI 回复草稿、商品标记、微信 IM 通知命令和低风险自动化边界。`,
    userVisibleScope: [
      '打开闲鱼账号页查看安装、登录、同步状态和失败原因。',
      '点击同步闲鱼数据，把受控闲鱼集成里的账号、买家会话和商品只读上下文写入应用隔离集合。',
      '打开买家会话页查看待回复买家、商品上下文、最近消息和处理状态。',
      '创建回复草稿，草稿必须绑定明确会话和买家，发送前保持待确认。',
      '进入商品标记页记录商品只读上下文、备注和待处理标记。',
      '进入通知命令页记录微信 IM 通知目标、低风险命令和确认边界。',
      '进入自动化和运行结果页查看同步、未读检查、摘要任务的未接入或失败状态。',
    ],
    status: {
      states: ['not_configured', 'needs_auth', 'ready', 'syncing', 'running', 'failed', 'not_connected'],
      readyCriteria: [
        '应用页面可打开，设置页已保存基础风险边界。',
        '闲鱼账号安装、登录和同步状态可见。',
        '买家会话、回复草稿、商品标记和运行结果集合可读写。',
        'IM 或自动化未接入时必须显示 not_connected 和失败原因。',
      ],
      notConnectedBehavior: '缺安装、缺登录、同步失败、IM 桥或自动化桥未接入时，页面必须显示未接入 / 需授权 / 失败原因，不能展示假结果。',
    },
    settings: [
      {
        id: 'goofish',
        label: '闲鱼接入',
        fields: ['安装检测', '账号登录状态', '同步频率', '同步失败提示'],
      },
      {
        id: 'reply-ai',
        label: 'AI 回复',
        fields: ['AI 提示词', '禁止承诺', '议价边界', '售后语气', '输出格式'],
      },
      {
        id: 'im',
        label: '微信 IM',
        fields: ['通知目标', '低风险命令', '确认方式', '命令结果可见'],
      },
      {
        id: 'risk',
        label: '风险边界',
        fields: ['写操作确认', '高风险不做项', '失败时保留草稿'],
      },
    ],
    data: {
      entities: [
        'goofish_accounts',
        'buyer_conversations',
        'reply_drafts',
        'item_marks',
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
    im: {
      enabled: true,
      lowRiskCommands: [
        '/goofish status',
        '/goofish unread',
        '/goofish drafts',
        '/goofish sync',
        '/goofish draft <conversation>',
        '/goofish confirm <draft>',
        '/goofish reject <draft>',
      ],
      confirmationRequiredFor: ['发送买家回复草稿', 'IM 命令触发低风险写操作'],
      visibleCommandResults: true,
    },
    risk: {
      writeActionsRequireConfirmation: true,
      highRiskActions: ['发送买家消息', '确认 IM 命令触发的低风险写操作'],
      outOfScope: [
        '自动无确认回复买家',
        '发布商品',
        '改价',
        '下架或删除商品',
        '批量修改商品',
        '绕过闲鱼风控的浏览器自动化',
      ],
    },
    acceptance: [
      {
        id: 'installation-self-check',
        label: '安装自检',
        howToVerify: '安装完成后查看安装自检结果，或在状态页点击重新运行安装自检；通过或失败会自动写入本验收项。',
      },
      {
        id: 'open-accounts',
        label: '查看账号状态',
        howToVerify: '打开账号页，能看到登录、同步状态和未接入 / 需授权说明。',
      },
      {
        id: 'open-inbox',
        label: '查看买家会话',
        howToVerify: '打开买家会话页，能看到买家、商品、未读数、回复状态和优先级。',
      },
      {
        id: 'sync-goofish-data',
        label: '同步闲鱼数据',
        howToVerify: '点击同步闲鱼数据；未安装或未登录时运行结果写入明确失败原因，已登录时买家会话和商品标记会写入应用内集合。',
      },
      {
        id: 'create-conversation',
        label: '新增待回复会话',
        howToVerify: '点击新增待回复，列表里出现一条待处理买家记录。',
      },
      {
        id: 'create-draft',
        label: '保存回复草稿',
        howToVerify: '打开买家会话页，点击某条会话的生成回复草稿；或打开写草稿页手动录入并保存，草稿列表可见。',
      },
      {
        id: 'draft-confirmation',
        label: '确认发送边界',
        howToVerify: '草稿页显示发送前需确认；点击确认发送只会发送绑定了明确会话和买家 ID 的草稿，自动无确认回复不在可操作范围内。',
      },
      {
        id: 'mark-item',
        label: '记录商品标记',
        howToVerify: '打开商品标记页，新增只读商品备注和待处理标记。',
      },
      {
        id: 'save-settings',
        label: '保存提示词和风险边界',
        howToVerify: '进入设置页，保存 AI 提示词、通知方式、自动化开关和风险边界。',
      },
      {
        id: 'review-im-commands',
        label: '查看 IM 命令模板',
        howToVerify: '进入通知命令页，能看到低风险命令、确认要求和命令结果状态。',
      },
      {
        id: 'review-automations',
        label: '查看自动化',
        howToVerify: '进入自动化页，能看到同步、未读检查或摘要任务的未接入 / 运行状态。',
      },
      {
        id: 'review-run-history',
        label: '查看运行结果',
        howToVerify: '进入运行结果页，能看到运行状态、结果摘要、失败原因和重试入口说明。',
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
