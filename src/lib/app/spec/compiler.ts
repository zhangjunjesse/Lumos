// Compiles AppSpec → 5 underlying JSON files (app.json/routes.json/data-schema.json/pages/*.json/workflows/*.json).
// Catches cross-reference errors (page→collection, menu→page, columns→fields).
// Boilerplate (id, version, icon, requires, permissions, id field, updated_at, indexes) is auto-injected.

import type {
  AppSpec, FieldSpec, ListPage, FormPage, DetailPage, SinglePage, ResultPage,
  CompileResult, CompileIssue, CompiledFile, FieldType, MenuEntry,
} from './types';
import {
  buildCollectionFields, buildRequiresAndPermissions, bumpVersion,
  compileAction, compileBlock, compileColumn, defaultIcon, slugifyId,
} from './compile-helpers';
import { parseAppSpecYaml } from './parser';

const PAGE_LAYOUTS = ['list', 'form', 'detail', 'single', 'result'] as const;

const FIELD_TO_FORM_WIDGET: Record<FieldType, string> = {
  text: 'text', longtext: 'textarea',
  int: 'number', number: 'number',
  bool: 'switch',
  date: 'text', datetime: 'text',
  enum: 'select',
  ref: 'text',
};

const ICON_BY_LAYOUT: Record<string, string> = {
  list: 'list-checks', form: 'plus', detail: 'file-text',
  single: 'home', result: 'sparkles',
};

export interface CompileOptions {
  sessionId?: string;
  previousVersion?: string;
}

export function compileFromYaml(yaml: string, opts: CompileOptions = {}): CompileResult {
  const parsed = parseAppSpecYaml(yaml);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors, warnings: parsed.warnings };
  }
  return compile(parsed.spec, opts, parsed.warnings);
}

export function compile(
  spec: AppSpec,
  opts: CompileOptions = {},
  initialWarnings: CompileIssue[] = [],
): CompileResult {
  const errors: CompileIssue[] = [];
  const warnings: CompileIssue[] = [...initialWarnings];

  if (!spec.app?.name?.trim()) {
    errors.push({ level: 'error', message: 'app.name 必填。' });
    return { ok: false, errors, warnings };
  }

  const collections = spec.data ?? {};
  const collectionFields = compileDataSchema(collections, warnings);
  const collectionNames = new Set(Object.keys(collections));

  const pages = spec.pages ?? {};
  const pageIds = new Set(Object.keys(pages));
  validatePageStructures(pages, errors);

  // Cross-reference: pages that reference collections / fields
  for (const [pid, page] of Object.entries(pages)) {
    validatePageRefs(pid, page, collectionNames, collectionFields, pageIds, errors);
  }

  // Menu validation + auto-derive
  const menu = resolveMenu(spec.menu, pageIds, errors, warnings);

  // Default page
  const defaultPage = spec.default
    ?? (menu.length > 0 ? extractMenuId(menu[0]) : undefined);
  if (defaultPage && !pageIds.has(defaultPage)) {
    errors.push({
      level: 'error',
      loc: { path: ['default'] },
      message: `default 引用的 page "${defaultPage}" 不存在。`,
    });
  }
  if (!defaultPage) {
    errors.push({
      level: 'error',
      message: '至少需要一个 page，否则没有 entry。',
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  // Compile to files
  const sessionShard = opts.sessionId ? opts.sessionId.slice(-4) : '';
  const appId = makeAppId(spec.app.name, sessionShard);
  const { requires, permissions } = buildRequiresAndPermissions(spec.app.needs);

  const appJson: Record<string, unknown> = {
    id: appId,
    name: spec.app.name,
    version: bumpVersion(opts.previousVersion),
    description: spec.app.description ?? `${spec.app.name} 的应用`,
    icon: defaultIcon(),
    category: spec.app.category ?? 'office',
    entry: defaultPage!,
    requires,
    permissions,
  };
  if (spec.app.fullscreen) {
    // routes.json holds fullscreen, but app.json doesn't reject extra; skip
  }

  const routesJson = {
    default: defaultPage!,
    fullscreen: spec.app.fullscreen ?? undefined,
    menu: menu.map((m) => buildMenuItem(m, pages)),
  };
  if (!routesJson.fullscreen) delete (routesJson as Record<string, unknown>).fullscreen;

  const dataSchemaJson = Object.entries(collectionFields).length > 0
    ? {
        collections: Object.entries(collectionFields).map(([name, info]) => ({
          name,
          label: collections[name].label ?? name,
          fields: info.fields,
          ...(info.indexes.length > 0 ? { indexes: info.indexes } : {}),
        })),
      }
    : null;

  const pageFiles = Object.entries(pages).map(([pid, page]) =>
    compilePage(pid, page, collections, collectionFields, warnings),
  );

  const workflowFiles = Object.entries(spec.workflows ?? {}).map(([wid, wf]) => ({
    path: `workflows/${wid}.json`,
    content: jsonString({ id: wid, version: 2, ...wf }),
  }));

  const files: CompiledFile[] = [
    { path: 'app.json', content: jsonString(appJson) },
    { path: 'routes.json', content: jsonString(routesJson) },
    ...(dataSchemaJson ? [{ path: 'data-schema.json', content: jsonString(dataSchemaJson) }] : []),
    ...pageFiles,
    ...workflowFiles,
  ];

  // Seed data: write to a `seed/` directory (consumed by db.* runtime)
  if (spec.seed) {
    for (const [col, rows] of Object.entries(spec.seed)) {
      if (!collectionNames.has(col)) continue;
      files.push({
        path: `seed/${col}.json`,
        content: jsonString(rows),
      });
    }
  }

  let seedRowCount = 0;
  for (const rows of Object.values(spec.seed ?? {})) seedRowCount += rows.length;

  return {
    ok: true,
    files,
    warnings,
    summary: {
      appName: spec.app.name,
      pageCount: Object.keys(pages).length,
      collectionCount: Object.keys(collections).length,
      workflowCount: Object.keys(spec.workflows ?? {}).length,
      seedRowCount,
    },
  };
}

function makeAppId(name: string, shard: string): string {
  const base = slugifyId(name, 'app');
  if (!shard) return base;
  return `${base}-${shard.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 60);
}

function compileDataSchema(
  collections: NonNullable<AppSpec['data']>,
  warnings: CompileIssue[],
): Record<string, { fields: Record<string, unknown>[]; indexes: string[][] }> {
  const out: Record<string, { fields: Record<string, unknown>[]; indexes: string[][] }> = {};
  for (const [name, col] of Object.entries(collections ?? {})) {
    out[name] = buildCollectionFields(name, col, warnings);
  }
  return out;
}

function validatePageStructures(
  pages: Record<string, unknown>,
  errors: CompileIssue[],
): void {
  for (const [pid, page] of Object.entries(pages)) {
    const p = page as Record<string, unknown>;
    if (typeof p.layout !== 'string' || !PAGE_LAYOUTS.includes(p.layout as typeof PAGE_LAYOUTS[number])) {
      errors.push({
        level: 'error',
        loc: { path: ['pages', pid, 'layout'] },
        message: `pages.${pid}.layout 必须是 ${PAGE_LAYOUTS.join('/')} 之一。`,
      });
      continue;
    }
    if (typeof p.title !== 'string' || !p.title.trim()) {
      errors.push({
        level: 'error',
        loc: { path: ['pages', pid, 'title'] },
        message: `pages.${pid}.title 必填。`,
      });
    }
  }
}

function validatePageRefs(
  pid: string,
  page: unknown,
  collectionNames: Set<string>,
  collectionFields: Record<string, { fields: Record<string, unknown>[] }>,
  pageIds: Set<string>,
  errors: CompileIssue[],
): void {
  const p = page as Record<string, unknown>;
  const refCollection = (p.data ?? p.collection) as string | undefined;
  if (typeof refCollection === 'string' && !collectionNames.has(refCollection)) {
    errors.push({
      level: 'error',
      loc: { path: ['pages', pid] },
      message: `pages.${pid} 引用了不存在的 collection "${refCollection}"。已知 collection: ${[...collectionNames].join(', ') || '(无)'}`,
      suggestion: `在 data: 段落里新增 ${refCollection}: { fields: { ... } }`,
    });
    return;
  }
  if (typeof refCollection === 'string') {
    const fieldNames = new Set(
      (collectionFields[refCollection]?.fields ?? []).map((f) => (f as Record<string, unknown>).name as string),
    );
    const cols = (p.columns ?? []) as unknown[];
    for (const col of cols) {
      const fieldName = typeof col === 'string' ? col : (col as Record<string, unknown>).field as string;
      if (typeof fieldName === 'string' && !fieldNames.has(fieldName)) {
        errors.push({
          level: 'error',
          loc: { path: ['pages', pid, 'columns'] },
          message: `pages.${pid} 的 columns 引用了 "${fieldName}"，但 collection "${refCollection}" 没有这个字段。已知字段: ${[...fieldNames].join(', ')}`,
        });
      }
    }
  }
  // page→page references
  const actions = (p.actions ?? []) as unknown[];
  for (const a of actions) {
    const open = (a as Record<string, unknown>)?.open;
    if (typeof open === 'string' && open.startsWith('page:')) {
      const target = open.slice(5);
      if (!pageIds.has(target)) {
        errors.push({
          level: 'error',
          loc: { path: ['pages', pid, 'actions'] },
          message: `pages.${pid} 的 action 跳转到不存在的 page "${target}"。`,
        });
      }
    }
  }
}

function resolveMenu(
  rawMenu: AppSpec['menu'],
  pageIds: Set<string>,
  errors: CompileIssue[],
  _warnings: CompileIssue[],
): MenuEntry[] {
  if (rawMenu && rawMenu.length > 0) {
    for (const m of rawMenu) {
      const id = extractMenuId(m);
      if (!pageIds.has(id)) {
        errors.push({
          level: 'error',
          loc: { path: ['menu'] },
          message: `menu 引用的 page "${id}" 不存在。已知 page: ${[...pageIds].join(', ')}`,
        });
      }
    }
    return rawMenu;
  }
  // Auto-derive: all visible pages in declaration order
  return [...pageIds];
}

function extractMenuId(entry: MenuEntry): string {
  return typeof entry === 'string' ? entry : entry.id;
}

function buildMenuItem(entry: MenuEntry, pages: NonNullable<AppSpec['pages']>): Record<string, unknown> {
  const id = extractMenuId(entry);
  const explicitLabel = typeof entry === 'string' ? undefined : entry.label;
  const explicitIcon = typeof entry === 'string' ? undefined : entry.icon;
  const hidden = typeof entry === 'string' ? undefined : entry.hidden;
  const page = pages?.[id];
  const layout = page?.layout ?? 'single';
  const out: Record<string, unknown> = {
    id,
    label: explicitLabel ?? page?.title ?? id,
    icon: explicitIcon ?? ICON_BY_LAYOUT[layout] ?? 'home',
    page: `pages/${id}.json`,
  };
  if (hidden) out.hidden = true;
  return out;
}

function compilePage(
  pid: string,
  page: NonNullable<AppSpec['pages']>[string],
  collections: NonNullable<AppSpec['data']>,
  collectionFields: Record<string, { fields: Record<string, unknown>[] }>,
  warnings: CompileIssue[],
): CompiledFile {
  const path = `pages/${pid}.json`;
  let body: Record<string, unknown>;
  switch (page.layout) {
    case 'list':
      body = compileListPage(page as ListPage, collections, collectionFields);
      break;
    case 'form':
      body = compileFormPage(page as FormPage, collections, collectionFields, warnings, pid);
      break;
    case 'detail':
      body = compileDetailPage(page as DetailPage, collections, collectionFields, warnings, pid);
      break;
    case 'result':
      body = compileResultPage(page as ResultPage);
      break;
    case 'single':
    default:
      body = compileSinglePage(page as SinglePage);
      break;
  }
  return { path, content: jsonString(body) };
}

function compileListPage(
  page: ListPage,
  collections: NonNullable<AppSpec['data']>,
  collectionFields: Record<string, { fields: Record<string, unknown>[] }>,
): Record<string, unknown> {
  const collection = collections?.[page.data];
  const fields = (collectionFields[page.data]?.fields ?? []) as Record<string, unknown>[];
  const columnsRaw = page.columns?.length
    ? page.columns
    : fields.filter((f) => f.name !== 'id').map((f) => f.name as string).slice(0, 5);
  const columns = columnsRaw
    .map((c) => compileColumn(c, collection))
    .filter((x): x is Record<string, unknown> => x !== null);

  const tableBlock: Record<string, unknown> = {
    type: 'table',
    data: `{{ db.${page.data} }}`,
    columns,
  };
  if (page.search?.length) tableBlock.search = { fields: page.search };
  if (page.filter?.length) {
    tableBlock.filter = page.filter.map((field) => {
      const fieldRaw = collection?.fields[field];
      const opts = typeof fieldRaw === 'string' ? undefined : (fieldRaw as FieldSpec | undefined)?.options;
      return opts ? { field, options: opts } : { field };
    });
  }
  const rowActions = (page.rowActions ?? []).map(compileAction).filter((x): x is Record<string, unknown> => x !== null);
  const toolbar = (page.actions ?? []).map(compileAction).filter((x): x is Record<string, unknown> => x !== null);
  if (rowActions.length || toolbar.length) {
    tableBlock.actions = {};
    if (toolbar.length) (tableBlock.actions as Record<string, unknown>).toolbar = toolbar;
    if (rowActions.length) (tableBlock.actions as Record<string, unknown>).row = rowActions;
  }

  return {
    title: page.title,
    description: page.description,
    layout: 'single',
    blocks: [tableBlock],
  };
}

function compileFormPage(
  page: FormPage,
  collections: NonNullable<AppSpec['data']>,
  collectionFields: Record<string, { fields: Record<string, unknown>[] }>,
  _warnings: CompileIssue[],
  _pid: string,
): Record<string, unknown> {
  const collection = collections?.[page.collection];
  const fields = (collectionFields[page.collection]?.fields ?? []) as Record<string, unknown>[];
  const editableFields = fields.filter((f) => !f.auto && f.name !== 'id');

  const formFields = (page.fields?.length ? page.fields : editableFields.map((f) => f.name as string))
    .map((entry) => {
      const fieldName = typeof entry === 'string' ? entry : entry.field;
      const overrideWidget = typeof entry === 'string' ? undefined : entry.widget;
      const overrideRequired = typeof entry === 'string' ? undefined : entry.required;
      const overridePlaceholder = typeof entry === 'string' ? undefined : entry.placeholder;
      const fieldRaw = collection?.fields[fieldName];
      const fieldSpec = typeof fieldRaw === 'string' ? null : (fieldRaw as FieldSpec | undefined);
      if (!fieldSpec) return null;
      const widget = overrideWidget ?? FIELD_TO_FORM_WIDGET[fieldSpec.type] ?? 'text';
      const out: Record<string, unknown> = {
        type: widget,
        name: fieldName,
        label: fieldSpec.label ?? fieldName,
      };
      if (overrideRequired ?? fieldSpec.required) out.required = true;
      if (overridePlaceholder ?? fieldSpec.placeholder) out.placeholder = overridePlaceholder ?? fieldSpec.placeholder;
      if (fieldSpec.default !== undefined) out.default = fieldSpec.default;
      if (widget === 'select' && fieldSpec.options?.length) out.options = fieldSpec.options;
      return out;
    })
    .filter((x): x is Record<string, unknown> => x !== null);

  const submit = page.submit;
  const submitObj: Record<string, unknown> = typeof submit === 'string'
    ? { run: submit, label: '保存', render: 'none' }
    : submit
      ? { label: '保存', render: 'none', ...submit }
      : { run: `db:create:${page.collection}`, label: '保存', render: 'none' };

  return {
    title: page.title,
    description: page.description,
    layout: 'form',
    form: formFields,
    submit: submitObj,
  };
}

function compileDetailPage(
  page: DetailPage,
  collections: NonNullable<AppSpec['data']>,
  collectionFields: Record<string, { fields: Record<string, unknown>[] }>,
  _warnings: CompileIssue[],
  _pid: string,
): Record<string, unknown> {
  const fields = (collectionFields[page.collection]?.fields ?? []) as Record<string, unknown>[];
  const detail: Record<string, unknown> = {};
  if (page.tabs?.length) {
    detail.tabs = page.tabs.map((tab) => ({
      label: tab.label,
      view: tab.table
        ? {
            type: 'table',
            data: `{{ db.${tab.table} }}`,
            columns: (collectionFields[tab.table]?.fields ?? [])
              .slice(0, 4)
              .map((f) => ({ field: (f as Record<string, unknown>).name as string, label: ((f as Record<string, unknown>).label as string) ?? (f as Record<string, unknown>).name as string })),
          }
        : { form: buildDetailFormFields(tab.fields ?? [], collections, page.collection) },
    }));
  } else {
    detail.view = { form: buildDetailFormFields(page.fields ?? fields.map((f) => f.name as string), collections, page.collection) };
  }
  return {
    title: page.title,
    description: page.description,
    layout: 'list-detail',
    list: {
      type: 'table',
      data: `{{ db.${page.collection} }}`,
      columns: fields.filter((f) => f.name !== 'id').slice(0, 3).map((f) => ({
        field: f.name as string,
        label: (f.label as string) ?? f.name as string,
      })),
    },
    detail,
  };
}

function buildDetailFormFields(
  fieldNames: string[],
  collections: NonNullable<AppSpec['data']>,
  collectionName: string,
): Record<string, unknown>[] {
  const collection = collections?.[collectionName];
  const out: Record<string, unknown>[] = [];
  for (const name of fieldNames) {
    const fieldRaw = collection?.fields[name];
    const fieldSpec = typeof fieldRaw === 'string' ? null : (fieldRaw as FieldSpec | undefined);
    if (!fieldSpec) continue;
    const entry: Record<string, unknown> = {
      type: FIELD_TO_FORM_WIDGET[fieldSpec.type] ?? 'text',
      name,
      label: fieldSpec.label ?? name,
    };
    if (fieldSpec.required) entry.required = true;
    if (fieldSpec.options?.length) entry.options = fieldSpec.options;
    out.push(entry);
  }
  return out;
}

function compileSinglePage(page: SinglePage): Record<string, unknown> {
  const blocks = (page.blocks ?? []).map(compileBlock).filter((x): x is Record<string, unknown> => x !== null);
  return {
    title: page.title,
    description: page.description,
    layout: 'single',
    blocks: blocks.length > 0 ? blocks : [{ type: 'markdown', content: '（页面内容待补充）' }],
  };
}

function compileResultPage(page: ResultPage): Record<string, unknown> {
  return {
    title: page.title,
    description: page.description,
    layout: 'result',
    source: { run: page.source, ...(page.input ? { input: page.input } : {}) },
    render: page.render,
  };
}

function jsonString(value: unknown): string {
  return `${JSON.stringify(value, (_k, v) => (v === undefined ? undefined : v), 2)}\n`;
}
