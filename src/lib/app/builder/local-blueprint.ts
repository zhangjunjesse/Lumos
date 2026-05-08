import type { BuilderSession } from './session';
import {
  buildNativeShellPages,
  withNativeShellCollections,
  withNativeShellRoutes,
} from './native-shell-blueprint';

export interface LocalBlueprintOptions {
  now?: number;
}

export function buildLocalBlueprintFiles(
  session: BuilderSession,
  opts: LocalBlueprintOptions = {},
): Record<string, string> {
  const now = opts.now ?? Date.now();
  const appName = session.appName ?? '未命名应用';
  const description = session.appDescription ?? `${appName} 的本地开发草图`;
  const appId = toAppId(appName, session.id);
  const version = `0.1.${Math.floor(now / 1000) % 100000}`;

  const app = {
    id: appId,
    name: appName,
    version,
    description,
    icon: './icon.png',
    category: 'other',
    entry: 'items',
    requires: {
      knowledge: 'none',
    },
    permissions: {
      data: 'isolated',
    },
  };

  const routes = withNativeShellRoutes({
    default: 'items',
    menu: [
      { id: 'items', label: '记录', icon: 'list', page: 'pages/items.json' },
      { id: 'new-item', label: '新增', icon: 'plus', page: 'pages/new-item.json' },
    ],
  });

  const dataSchema = withNativeShellCollections({
    collections: [
      {
        name: 'items',
        label: '记录',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'title', type: 'string', label: '标题', required: true, indexed: true },
          {
            name: 'status',
            type: 'enum',
            label: '状态',
            options: ['待处理', '进行中', '已完成'],
            default: '待处理',
            indexed: true,
          },
          { name: 'priority', type: 'integer', label: '优先级', default: 1 },
          { name: 'notes', type: 'text', label: '备注' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['status'], ['updated_at']],
      },
    ],
  });

  const itemsPage = {
    title: appName,
    description,
    layout: 'single',
    blocks: [
      {
        type: 'card',
        title: '工作台',
        children: [
          {
            type: 'markdown',
            content:
              '这是本地开发草图的首页。后续 AI 接入后会按真实需求扩展字段、流程和结果展示。',
          },
          { type: 'button', label: '新增记录', primary: true, open: 'page:new-item' },
        ],
      },
      {
        type: 'table',
        data: '{{ db.items }}',
        columns: [
          { field: 'title', label: '标题', search: true },
          { field: 'status', label: '状态', render: 'tag' },
          { field: 'priority', label: '优先级', sortable: true },
          { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
        ],
        search: { fields: ['title', 'notes'] },
        actions: {
          toolbar: [{ label: '新增记录', open: 'page:new-item', primary: true }],
        },
      },
    ],
  };

  const newItemPage = {
    title: '新增记录',
    description: `为 ${appName} 添加一条记录。`,
    layout: 'form',
    form: [
      { type: 'text', name: 'title', label: '标题', required: true, placeholder: '输入标题' },
      {
        type: 'select',
        name: 'status',
        label: '状态',
        options: ['待处理', '进行中', '已完成'],
        default: '待处理',
      },
      { type: 'number', name: 'priority', label: '优先级', min: 1, max: 5, step: 1, default: 1 },
      { type: 'textarea', name: 'notes', label: '备注', rows: 5 },
    ],
    submit: { label: '保存记录', run: 'db:create:items', render: 'none' },
  };

  return {
    'app.json': stringifyJson(app),
    'native-app-spec.json': stringifyJson({
      version: 1,
      summary: `${appName}：${description}`,
      userVisibleScope: [
        '打开工作台查看记录列表和状态。',
        '新增记录并保存标题、状态、优先级和备注。',
        '按标题或备注搜索记录。',
        '打开状态页查看就绪状态、未接入能力和运行记录数量。',
        '进入设置页保存默认视图、通知方式、AI 提示词、自动化开关和风险边界。',
        '进入运行结果页查看运行状态、结果摘要和失败原因。',
      ],
      status: {
        states: ['not_configured', 'ready', 'running', 'failed', 'not_connected'],
        readyCriteria: ['应用页面可打开。', '本地记录集合可读写。'],
        notConnectedBehavior: '如果后续接入 AI、工作流、IM 或外部服务失败，页面必须显示未接入或失败原因。',
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
          'items',
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
        { id: 'open-items', label: '打开工作台', howToVerify: '进入应用后默认看到记录工作台。' },
        { id: 'create-item', label: '新增记录', howToVerify: '点击新增记录，填写表单并保存。' },
        { id: 'list-items', label: '查看记录列表', howToVerify: '保存后在工作台看到新记录。' },
        { id: 'search-items', label: '搜索记录', howToVerify: '按标题或备注搜索记录。' },
        { id: 'status-empty-error', label: '验证状态', howToVerify: '无数据、加载中或保存失败时界面给出明确状态。' },
        { id: 'open-status', label: '查看状态页', howToVerify: '打开状态页，能看到记录数量、设置数量、运行记录数量和未接入能力说明。' },
        { id: 'save-settings', label: '保存设置', howToVerify: '进入设置页，保存默认视图、通知方式、AI 提示词、自动化开关和风险边界。' },
        { id: 'review-run-history', label: '查看运行结果', howToVerify: '进入运行结果页，能看到运行状态、结果摘要、失败原因和更新时间。' },
      ],
    }),
    'routes.json': stringifyJson(routes),
    'data-schema.json': stringifyJson(dataSchema),
    'pages/items.json': stringifyJson(itemsPage),
    'pages/new-item.json': stringifyJson(newItemPage),
    ...stringifyFiles(buildNativeShellPages({
      appName,
      primaryPageId: 'items',
      primaryCollection: 'items',
      primaryCollectionLabel: '记录',
    })),
  };
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

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function stringifyFiles(files: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [filePath, stringifyJson(content)]),
  );
}
