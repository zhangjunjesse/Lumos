// Pure helpers used by compiler.ts to build the JSON files.

import type {
  FieldSpec, FieldType, CollectionSpec, CompileIssue,
  ColumnSpec, ActionSpec, BlockSpec,
} from './types';

const APP_NEED_LUMOS = '>=1.0.0';

export function slugifyId(value: string, fallback = 'app'): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return fallback;
  if (!/^[a-z]/.test(slug)) return `app-${slug}`;
  return slug.slice(0, 60);
}

export function defaultIcon(): string {
  return './icon.png';
}

export function bumpVersion(prev?: string): string {
  if (!prev) return '0.1.0';
  const m = prev.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return '0.1.0';
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export function buildRequiresAndPermissions(
  needs: string[] | undefined,
): { requires: Record<string, unknown>; permissions: Record<string, unknown> } {
  const requires: Record<string, unknown> = {
    lumos: APP_NEED_LUMOS,
    knowledge: 'none',
  };
  const permissions: Record<string, unknown> = { data: 'isolated' };

  if (!needs || needs.length === 0) {
    return { requires, permissions };
  }

  const tools: string[] = [];
  const mcps: string[] = [];
  const skills: string[] = [];
  const teams: string[] = [];
  const networkDomains: string[] = [];
  const system: string[] = [];

  for (const need of needs) {
    if (need === 'browser') { requires.browser = true; continue; }
    if (need === 'notification' || need === 'schedule' || need === 'clipboard') {
      system.push(need); continue;
    }
    if (need === 'knowledge:required') { requires.knowledge = 'required'; continue; }
    if (need === 'knowledge:optional') { requires.knowledge = 'optional'; continue; }
    if (need.startsWith('network:')) { networkDomains.push(need.slice(8)); continue; }
    if (need.startsWith('tool:')) { tools.push(need.slice(5)); continue; }
    if (need.startsWith('mcp:')) { mcps.push(need.slice(4)); continue; }
    if (need.startsWith('llm:')) { requires.llm = need.slice(4); continue; }
    if (need.startsWith('skill:')) { skills.push(need.slice(6)); continue; }
    if (need.startsWith('team:')) { teams.push(need.slice(5)); continue; }
  }

  if (tools.length) requires.tools = tools;
  if (mcps.length) requires.mcp = mcps;
  if (skills.length) requires.skills = skills;
  if (teams.length) requires.agentTeams = teams;
  if (networkDomains.length) {
    permissions.network = { mode: 'whitelist', domains: networkDomains };
  }
  if (system.length) permissions.system = system;

  return { requires, permissions };
}

const SCHEMA_FIELD_TYPE: Record<FieldType, string> = {
  text: 'string',
  longtext: 'text',
  int: 'integer',
  number: 'number',
  bool: 'boolean',
  date: 'date',
  datetime: 'datetime',
  enum: 'enum',
  ref: 'ref',
};

export function buildCollectionFields(
  name: string,
  collection: CollectionSpec,
  warnings: CompileIssue[],
): { fields: Record<string, unknown>[]; indexes: string[][] } {
  const userFields: Record<string, unknown>[] = [];
  const indexes: string[][] = [];
  const seen = new Set<string>();

  for (const [fname, fraw] of Object.entries(collection.fields)) {
    if (seen.has(fname)) {
      warnings.push({
        level: 'warning',
        loc: { path: ['data', name, 'fields', fname] },
        message: `重复字段 ${fname}，已忽略后一个。`,
      });
      continue;
    }
    seen.add(fname);
    if (typeof fraw === 'string') continue; // already handled by parser, kept for safety
    const f = fraw as FieldSpec;
    const out = serializeField(fname, f, warnings, ['data', name, 'fields', fname]);
    if (out) userFields.push(out);
    if (f.indexed || f.type === 'enum' || f.type === 'ref' || /_at$/.test(fname)) {
      indexes.push([fname]);
    }
  }

  // prepend `id` (uuid primary auto=uuid) if not present
  if (!seen.has('id')) {
    userFields.unshift({
      name: 'id', type: 'uuid', primary: true, auto: 'uuid',
    });
  }
  // append `updated_at` if not present
  if (!seen.has('updated_at')) {
    userFields.push({
      name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now',
    });
    indexes.push(['updated_at']);
  }

  return { fields: userFields, indexes: dedupeIndexes(indexes) };
}

function dedupeIndexes(indexes: string[][]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const idx of indexes) {
    const key = idx.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(idx);
    }
  }
  return result;
}

function serializeField(
  fname: string,
  field: FieldSpec,
  warnings: CompileIssue[],
  path: string[],
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {
    name: fname,
    type: SCHEMA_FIELD_TYPE[field.type] ?? 'string',
  };
  if (field.label) out.label = field.label;
  if (field.required) out.required = true;
  if (field.unique) out.unique = true;
  if (field.indexed) out.indexed = true;
  if (field.primary) out.primary = true;
  if (field.placeholder) out.placeholder = field.placeholder;
  if (field.auto) out.auto = field.auto;

  if (field.type === 'enum') {
    if (!field.options || field.options.length === 0) {
      warnings.push({
        level: 'warning',
        loc: { path },
        message: `${fname}: enum 字段没有 options，已默认 [选项A, 选项B]。`,
      });
      out.options = ['选项A', '选项B'];
    } else {
      out.options = field.options;
    }
    if (field.default !== undefined) {
      const opts = (out.options as string[]);
      if (!opts.includes(String(field.default))) {
        warnings.push({
          level: 'warning',
          loc: { path },
          message: `${fname}: default "${field.default}" 不在 options 内，已改用首项 "${opts[0]}"。`,
        });
        out.default = opts[0];
      } else {
        out.default = field.default;
      }
    }
  } else if (field.type === 'ref') {
    if (!field.ref) {
      warnings.push({
        level: 'warning',
        loc: { path },
        message: `${fname}: ref 字段缺少目标 collection，已忽略。`,
      });
      return null;
    }
    out.ref = field.ref;
    if (field.default !== undefined) out.default = field.default;
  } else if (field.default !== undefined) {
    out.default = field.default;
  }

  return out;
}

// --- column / actions / blocks compilation ---

export function compileColumn(
  col: string | ColumnSpec,
  collection: CollectionSpec | undefined,
): Record<string, unknown> | null {
  const spec: ColumnSpec = typeof col === 'string' ? { field: col } : col;
  const fieldRaw = collection?.fields[spec.field];
  const fieldSpec = typeof fieldRaw === 'string' ? null : (fieldRaw as FieldSpec | undefined);
  const inferredLabel = fieldSpec?.label ?? spec.field;
  const inferredRender =
    spec.render ?? inferRender(fieldSpec);
  const out: Record<string, unknown> = {
    field: spec.field,
    label: spec.label ?? inferredLabel,
  };
  if (inferredRender) out.render = inferredRender;
  if (spec.sortable) out.sortable = true;
  if (spec.searchable) out.search = true;
  return out;
}

function inferRender(field: FieldSpec | null | undefined): ColumnSpec['render'] | undefined {
  if (!field) return undefined;
  if (field.type === 'enum') return 'tag';
  if (field.type === 'date' || field.type === 'datetime') return 'date';
  if (field.type === 'longtext') return 'markdown';
  if (field.type === 'ref') return 'link';
  return undefined;
}

export function compileAction(action: ActionSpec): Record<string, unknown> | null {
  if (!action.run && !action.open) return null;
  const out: Record<string, unknown> = { label: action.label };
  if (action.primary) out.primary = true;
  if (action.run) out.run = action.run;
  if (action.open) out.open = action.open;
  if (action.input) out.input = action.input;
  if (action.confirm !== undefined) out.confirm = action.confirm;
  return out;
}

export function compileBlock(block: BlockSpec): Record<string, unknown> | null {
  if (typeof block === 'string') {
    return { type: 'markdown', content: block };
  }
  if ('markdown' in block) {
    return { type: 'markdown', content: block.markdown };
  }
  if ('card' in block) {
    const children = (block.card.children ?? [])
      .map(compileBlock)
      .filter((x): x is Record<string, unknown> => x !== null);
    const out: Record<string, unknown> = { type: 'card' };
    if (block.card.title) out.title = block.card.title;
    if (children.length > 0) out.children = children;
    return out;
  }
  if ('table' in block) {
    const t = block.table;
    const out: Record<string, unknown> = {
      type: 'table',
      data: t.data.startsWith('{{') ? t.data : `{{ db.${t.data} }}`,
      columns: (t.columns ?? []).map((c) =>
        typeof c === 'string'
          ? { field: c, label: c }
          : { field: c.field, label: c.label ?? c.field, ...(c.render ? { render: c.render } : {}), ...(c.sortable ? { sortable: true } : {}), ...(c.searchable ? { search: true } : {}) },
      ),
    };
    if (t.search?.length) out.search = { fields: t.search };
    if (t.actions?.length) {
      const compiled = t.actions.map(compileAction).filter((x): x is Record<string, unknown> => x !== null);
      if (compiled.length > 0) out.actions = { toolbar: compiled };
    }
    return out;
  }
  if ('button' in block) {
    const b = block.button;
    if (!b.run && !b.open) return null;
    const out: Record<string, unknown> = { type: 'button', label: b.label };
    if (b.primary) out.primary = true;
    if (b.run) out.run = b.run;
    if (b.open) out.open = b.open;
    if (b.input) out.input = b.input;
    if (b.confirm !== undefined) out.confirm = b.confirm;
    return out;
  }
  if ('link' in block) {
    return { type: 'link', label: block.link.label, open: block.link.open };
  }
  if ('tag' in block) {
    const out: Record<string, unknown> = { type: 'tag', value: block.tag.value };
    if (block.tag.color) out.color = block.tag.color;
    return out;
  }
  if ('badge' in block) {
    return { type: 'badge', value: block.badge.value };
  }
  return null;
}
