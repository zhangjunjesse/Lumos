import type { BuilderSession } from './session';

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

export function buildTemplateBlueprintFiles(
  session: BuilderSession,
  templateId: string,
  opts: { now?: number } = {},
): Record<string, string> | null {
  const template = getAppBuilderTemplate(templateId);
  if (!template) return null;

  switch (template.id) {
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

function buildCustomerTrackerFiles(
  session: BuilderSession,
  opts: { now?: number },
): Record<string, string> {
  const app = { ...baseApp(session, opts, 'office'), entry: 'customers' };
  const routes = {
    default: 'customers',
    menu: [
      { id: 'customers', label: '客户', icon: 'users', page: 'pages/customers.json' },
      { id: 'new-customer', label: '新增', icon: 'plus', page: 'pages/new-customer.json' },
    ],
  };
  const dataSchema = {
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
  };
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
    'routes.json': routes,
    'data-schema.json': dataSchema,
    'pages/customers.json': listPage,
    'pages/new-customer.json': formPage,
  });
}

function buildWeeklyReportFiles(
  session: BuilderSession,
  opts: { now?: number },
): Record<string, string> {
  const app = { ...baseApp(session, opts, 'office'), entry: 'reports' };
  const routes = {
    default: 'reports',
    menu: [
      { id: 'reports', label: '周报', icon: 'file-text', page: 'pages/reports.json' },
      { id: 'new-report', label: '填写', icon: 'plus', page: 'pages/new-report.json' },
    ],
  };
  const dataSchema = {
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
  };
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
    'routes.json': routes,
    'data-schema.json': dataSchema,
    'pages/reports.json': listPage,
    'pages/new-report.json': formPage,
  });
}

function buildResourceLibraryFiles(
  session: BuilderSession,
  opts: { now?: number },
): Record<string, string> {
  const app = { ...baseApp(session, opts, 'research'), entry: 'resources' };
  const routes = {
    default: 'resources',
    menu: [
      { id: 'resources', label: '资料', icon: 'library', page: 'pages/resources.json' },
      { id: 'new-resource', label: '新增', icon: 'plus', page: 'pages/new-resource.json' },
    ],
  };
  const dataSchema = {
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
  };
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
    'routes.json': routes,
    'data-schema.json': dataSchema,
    'pages/resources.json': listPage,
    'pages/new-resource.json': formPage,
  });
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
