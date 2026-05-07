import type { BuilderSession } from './session';

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

  const routes = {
    default: 'items',
    menu: [
      { id: 'items', label: '记录', icon: 'list', page: 'pages/items.json' },
      { id: 'new-item', label: '新增', icon: 'plus', page: 'pages/new-item.json' },
    ],
  };

  const dataSchema = {
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
  };

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
    'routes.json': stringifyJson(routes),
    'data-schema.json': stringifyJson(dataSchema),
    'pages/items.json': stringifyJson(itemsPage),
    'pages/new-item.json': stringifyJson(newItemPage),
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
