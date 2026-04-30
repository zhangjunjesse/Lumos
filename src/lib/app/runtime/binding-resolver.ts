import type { AppDataStore } from './data-store';
import type { SecretVault } from './secret-vault';

/**
 * Binding template resolver.
 *
 * Renders strings that contain `{{ namespace.expression }}` segments by
 * resolving each segment against a runtime context. Used by:
 *   - The declarative page renderer (M1 W4) to resolve `{{ db.customers }}`
 *     into table data, `{{ inputs.x }}` into the live form value, etc.
 *   - The workflow integration adapter to render step prompts.
 *
 * Supported namespaces (M1):
 *   inputs.<name>            — current form / page inputs
 *   config.<key>             — secret vault value (decrypted)
 *   db.<collection>          — array of all rows (most-recent-first)
 *   db.<collection>.count    — integer count
 *   user.<key>               — current user info from supplied map
 *   steps.<id>.output        — workflow step output from supplied map
 *
 * Deliberately omitted in M1 (defer to M3+):
 *   db.<collection>.where(...)   — needs a tiny DSL parser
 *   state.<key>                  — depends on per-app state store, TBD
 *
 * The resolver is intentionally non-Turing-complete: dotted lookups only,
 * one parenthesis-free terminal method (`.count`), no comparison, no
 * arithmetic. AI-builder-generated bindings cannot accidentally execute
 * arbitrary code.
 */

export interface BindingContext {
  inputs?: Record<string, unknown>;
  user?: Record<string, unknown>;
  steps?: Record<string, { output?: unknown }>;
  /** Optional — required if any `{{ db.* }}` binding appears. */
  dataStore?: AppDataStore;
  /** Optional — required if any `{{ config.* }}` binding appears. */
  vault?: SecretVault;
  appId?: string;
}

const TOKEN_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

const IDENT_HEAD = /^[A-Za-z_]/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class BindingError extends Error {
  readonly expression: string;
  constructor(expression: string, message: string) {
    super(`Binding '${expression}': ${message}`);
    this.name = 'BindingError';
    this.expression = expression;
  }
}

/**
 * Resolve a single binding expression (without surrounding `{{ }}`).
 *
 * Returns the raw value — could be string / number / array / object.
 */
export function resolveBindingExpression(
  expression: string,
  ctx: BindingContext,
): unknown {
  const trimmed = expression.trim();
  if (trimmed === '') throw new BindingError(expression, 'empty expression');

  const parts = trimmed.split('.').map((p) => p.trim());
  for (const p of parts) {
    if (!IDENT_HEAD.test(p) || !IDENT_RE.test(p)) {
      throw new BindingError(
        expression,
        `invalid path segment '${p}' — only dotted identifier paths are supported`,
      );
    }
  }
  const [ns, ...rest] = parts;

  switch (ns) {
    case 'inputs':
      return readPath(ctx.inputs ?? {}, rest, expression);

    case 'config': {
      if (rest.length !== 1) {
        throw new BindingError(expression, 'config path must be config.<key>');
      }
      if (!ctx.vault || !ctx.appId) {
        throw new BindingError(
          expression,
          'BindingContext.vault and appId required for config.* bindings',
        );
      }
      return ctx.vault.get(ctx.appId, rest[0]);
    }

    case 'db': {
      if (!ctx.dataStore) {
        throw new BindingError(
          expression,
          'BindingContext.dataStore required for db.* bindings',
        );
      }
      if (rest.length === 0) {
        throw new BindingError(expression, 'db path must be db.<collection>');
      }
      const collection = rest[0];
      const tail = rest.slice(1);
      if (tail.length === 0) {
        return ctx.dataStore.query(collection);
      }
      if (tail.length === 1 && tail[0] === 'count') {
        return ctx.dataStore.count(collection);
      }
      throw new BindingError(
        expression,
        `unsupported db method '${tail.join('.')}'; only db.<collection> and db.<collection>.count are supported in M1`,
      );
    }

    case 'user':
      return readPath(ctx.user ?? {}, rest, expression);

    case 'steps': {
      if (rest.length === 0) {
        throw new BindingError(expression, 'steps path must be steps.<id>.output...');
      }
      const stepId = rest[0];
      const tail = rest.slice(1);
      const step = ctx.steps?.[stepId];
      if (!step) return undefined;
      if (tail.length === 0) return step;
      return readPath(step as Record<string, unknown>, tail, expression);
    }

    default:
      throw new BindingError(
        expression,
        `unknown namespace '${ns}'; known: inputs / config / db / user / steps`,
      );
  }
}

function readPath(
  obj: Record<string, unknown>,
  parts: string[],
  expression: string,
): unknown {
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') {
      throw new BindingError(expression, `cannot read '.${p}' on non-object value`);
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Render a template string by replacing every `{{ ... }}` with its
 * resolved value. Non-string values are JSON-stringified except primitives,
 * which are coerced via String(). Use `resolveBindingExpression` directly
 * if you need the raw value.
 */
export function renderTemplate(template: string, ctx: BindingContext): string {
  return template.replace(TOKEN_RE, (_match, expr: string) => {
    const value = resolveBindingExpression(expr, ctx);
    return formatValue(value);
  });
}

/**
 * If the input is `{{ singleExpression }}` (with optional surrounding
 * whitespace), return the raw value of that expression. Otherwise return
 * `undefined` and let the caller fall back to `renderTemplate`.
 *
 * This matters for components that bind to non-string values (table data,
 * counts, etc.) — they need the raw array/number, not its string form.
 */
export function resolveSingleBinding(
  template: string,
  ctx: BindingContext,
): { isSingle: true; value: unknown } | { isSingle: false } {
  const m = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/.exec(template);
  if (!m) return { isSingle: false };
  return { isSingle: true, value: resolveBindingExpression(m[1], ctx) };
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
