// Parses raw YAML text and field shorthand strings into AppSpec.
// Errors include best-effort line numbers from the YAML doc.

import YAML from 'yaml';

import type {
  AppSpec, FieldSpec, FieldType, CompileIssue,
} from './types';

export type ParseResult =
  | { ok: true; spec: AppSpec; warnings: CompileIssue[] }
  | { ok: false; errors: CompileIssue[]; warnings: CompileIssue[] };

export function parseAppSpecYaml(yamlText: string): ParseResult {
  const trimmed = (yamlText ?? '').trim();
  if (!trimmed) {
    return {
      ok: false,
      errors: [{ level: 'error', message: 'spec_yaml 不能为空，请提供至少 app: { name } 一节。' }],
      warnings: [],
    };
  }

  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(trimmed, { prettyErrors: true });
  } catch (err) {
    return {
      ok: false,
      errors: [{ level: 'error', message: `YAML 解析失败：${(err as Error).message}` }],
      warnings: [],
    };
  }

  const errors: CompileIssue[] = [];
  const warnings: CompileIssue[] = [];

  for (const e of doc.errors ?? []) {
    errors.push({
      level: 'error',
      loc: positionFromYamlError(e),
      message: `YAML 错误：${e.message}`,
    });
  }
  for (const w of doc.warnings ?? []) {
    warnings.push({
      level: 'warning',
      loc: positionFromYamlError(w),
      message: `YAML 警告：${w.message}`,
    });
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const raw = doc.toJSON() as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [{ level: 'error', message: 'spec_yaml 顶层必须是对象（含 app / pages / data 等键）。' }],
      warnings,
    };
  }

  const spec = normalizeAppSpec(raw as Record<string, unknown>, errors, warnings);
  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, spec, warnings };
}

function positionFromYamlError(err: { linePos?: { start?: { line: number; col: number } } }): CompileIssue['loc'] {
  const start = err.linePos?.start;
  if (!start) return undefined;
  return { line: start.line, column: start.col, path: [] };
}

function normalizeAppSpec(
  raw: Record<string, unknown>,
  errors: CompileIssue[],
  warnings: CompileIssue[],
): AppSpec {
  const app = pickObject(raw.app);
  if (!app || typeof app.name !== 'string' || !app.name.trim()) {
    errors.push({ level: 'error', message: 'app.name 必填，且必须是非空字符串。' });
  }

  const data = pickObject(raw.data);
  const collections: AppSpec['data'] = {};
  if (data) {
    for (const [name, value] of Object.entries(data)) {
      const col = pickObject(value);
      const fieldsRaw = pickObject(col?.fields);
      if (!col || !fieldsRaw) {
        errors.push({
          level: 'error',
          loc: { path: ['data', name] },
          message: `data.${name}.fields 必填，且必须是对象。`,
        });
        continue;
      }
      const fields: Record<string, FieldSpec> = {};
      for (const [fname, fval] of Object.entries(fieldsRaw)) {
        const parsed = parseFieldValue(fval, [`data`, name, 'fields', fname], errors, warnings);
        if (parsed) fields[fname] = parsed;
      }
      collections[name] = { label: stringOrUndef(col.label), fields };
    }
  }

  const pagesRaw = pickObject(raw.pages);
  const pages: Record<string, NonNullable<AppSpec['pages']>[string]> = {};
  if (pagesRaw) {
    for (const [pid, pval] of Object.entries(pagesRaw)) {
      const pobj = pickObject(pval);
      if (!pobj) {
        errors.push({
          level: 'error',
          loc: { path: ['pages', pid] },
          message: `pages.${pid} 必须是对象。`,
        });
        continue;
      }
      pages[pid] = pobj as NonNullable<AppSpec['pages']>[string];
    }
  }

  const seedRaw = pickObject(raw.seed);
  const seed: AppSpec['seed'] = {};
  if (seedRaw) {
    for (const [k, v] of Object.entries(seedRaw)) {
      if (Array.isArray(v)) {
        seed[k] = v.filter((row): row is Record<string, unknown> =>
          row !== null && typeof row === 'object' && !Array.isArray(row));
      } else {
        warnings.push({
          level: 'warning',
          loc: { path: ['seed', k] },
          message: `seed.${k} 应该是数组，已忽略。`,
        });
      }
    }
  }

  const workflowsRaw = pickObject(raw.workflows);
  const workflows: Record<string, NonNullable<AppSpec['workflows']>[string]> = {};
  if (workflowsRaw) {
    for (const [wid, wval] of Object.entries(workflowsRaw)) {
      const wobj = pickObject(wval);
      if (wobj) workflows[wid] = wobj as NonNullable<AppSpec['workflows']>[string];
    }
  }

  const menu = parseMenu(raw.menu);
  const defaultPage = stringOrUndef(raw.default);

  return {
    app: {
      name: typeof app?.name === 'string' ? app.name : '未命名应用',
      description: stringOrUndef(app?.description),
      category: stringOrUndef(app?.category) as AppSpec['app']['category'],
      needs: parseStringArray(app?.needs),
      fullscreen: typeof app?.fullscreen === 'boolean' ? app.fullscreen : undefined,
    },
    menu,
    default: defaultPage,
    data: Object.keys(collections).length > 0 ? collections : undefined,
    pages: Object.keys(pages).length > 0 ? pages : undefined,
    workflows: Object.keys(workflows).length > 0 ? workflows : undefined,
    seed: Object.keys(seed).length > 0 ? seed : undefined,
  };
}

function parseMenu(raw: unknown): NonNullable<AppSpec['menu']> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<AppSpec['menu']> = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push(item);
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.id !== 'string') continue;
      out.push({
        id: obj.id,
        label: stringOrUndef(obj.label),
        icon: stringOrUndef(obj.icon),
        hidden: typeof obj.hidden === 'boolean' ? obj.hidden : undefined,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function parseStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return out.length > 0 ? out : undefined;
}

function pickObject(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return undefined;
}

function stringOrUndef(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

// ---- Field shorthand parser --------------------------------------------------
// Examples it accepts:
//   "text required"
//   "text required label=\"客户名称\""
//   "enum[新线索|沟通中|成交] default=新线索 indexed"
//   "ref(customers) required"
//   "datetime auto=now"

const FIELD_TYPE_ALIASES: Record<string, FieldType> = {
  text: 'text', string: 'text', short: 'text',
  longtext: 'longtext', long: 'longtext', textarea: 'longtext', markdown: 'longtext',
  int: 'int', integer: 'int',
  number: 'number', float: 'number', decimal: 'number',
  bool: 'bool', boolean: 'bool', toggle: 'bool',
  date: 'date',
  datetime: 'datetime', timestamp: 'datetime',
  enum: 'enum',
  ref: 'ref',
};

const KNOWN_MODIFIERS = new Set(['required', 'unique', 'indexed', 'primary']);

export function parseFieldShorthand(input: string): FieldSpec | { error: string } {
  const text = input.trim();
  if (!text) return { error: '字段定义不能为空。' };

  // Tokenize while respecting quoted strings, enum brackets, ref parens
  const tokens = tokenizeShorthand(text);
  if (tokens.length === 0) return { error: '无法解析字段定义。' };

  const head = tokens[0];
  const result: FieldSpec = parseHead(head);

  for (let i = 1; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (KNOWN_MODIFIERS.has(tok.toLowerCase())) {
      const mod = tok.toLowerCase() as 'required' | 'unique' | 'indexed' | 'primary';
      result[mod] = true;
      continue;
    }
    const eq = tok.indexOf('=');
    if (eq > 0) {
      const key = tok.slice(0, eq).trim().toLowerCase();
      const valueRaw = tok.slice(eq + 1).trim();
      const value = stripQuotes(valueRaw);
      applyKeyValue(result, key, value);
      continue;
    }
    return { error: `未识别的修饰符 "${tok}"。支持: required/unique/indexed/primary 或 key=value。` };
  }

  if (result.type === 'enum' && (!result.options || result.options.length === 0)) {
    return { error: 'enum 字段必须用 enum[a|b|c] 提供选项。' };
  }
  if (result.type === 'ref' && !result.ref) {
    return { error: 'ref 字段必须用 ref(collection_name) 指定引用集合。' };
  }
  return result;
}

function parseHead(head: string): FieldSpec {
  if (head.startsWith('enum[') || head.startsWith('enum(')) {
    const open = head.indexOf('[') >= 0 ? '[' : '(';
    const close = open === '[' ? ']' : ')';
    const inner = head.slice(head.indexOf(open) + 1, head.lastIndexOf(close));
    const options = inner.split('|').map((s) => s.trim()).filter(Boolean);
    return { type: 'enum', options };
  }
  if (head.startsWith('ref(')) {
    const inner = head.slice(4, head.lastIndexOf(')'));
    return { type: 'ref', ref: inner.trim() };
  }
  const aliased = FIELD_TYPE_ALIASES[head.toLowerCase()];
  if (aliased) return { type: aliased };
  return { type: 'text' };
}

function applyKeyValue(field: FieldSpec, key: string, value: string): void {
  switch (key) {
    case 'label': field.label = value; break;
    case 'placeholder': field.placeholder = value; break;
    case 'default': field.default = coerceLiteral(value); break;
    case 'auto':
      if (value === 'now' || value === 'uuid') field.auto = value;
      break;
    case 'ref': field.ref = value; break;
    default: /* unknown key — ignore silently */ break;
  }
}

function coerceLiteral(raw: string): string | number | boolean | null {
  const lower = raw.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null') return null;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function tokenizeShorthand(text: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let inQuote: '"' | "'" | null = null;
  let depth = 0;
  for (const ch of text) {
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      buf += ch;
      continue;
    }
    if (ch === '[' || ch === '(') { depth += 1; buf += ch; continue; }
    if (ch === ']' || ch === ')') { depth -= 1; buf += ch; continue; }
    if (depth === 0 && /\s/.test(ch)) {
      if (buf) { tokens.push(buf); buf = ''; }
      continue;
    }
    buf += ch;
  }
  if (buf) tokens.push(buf);
  return tokens;
}

function stripQuotes(raw: string): string {
  if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw[raw.length - 1] === raw[0]) {
    return raw.slice(1, -1);
  }
  return raw;
}

export function parseFieldValue(
  raw: unknown,
  path: string[],
  errors: CompileIssue[],
  _warnings: CompileIssue[],
): FieldSpec | undefined {
  if (typeof raw === 'string') {
    const parsed = parseFieldShorthand(raw);
    if ('error' in parsed) {
      errors.push({
        level: 'error',
        loc: { path },
        message: `${path.join('.')} 解析失败：${parsed.error}`,
      });
      return undefined;
    }
    return parsed;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as FieldSpec;
  }
  errors.push({
    level: 'error',
    loc: { path },
    message: `${path.join('.')} 必须是字符串简写（"text required"）或对象。`,
  });
  return undefined;
}
