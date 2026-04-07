/**
 * DSL step reference sanitization utilities.
 * Strips stale/missing step ID references after graph edits.
 */

interface DslStep {
  id: string;
  type: string;
  dependsOn?: string[];
  when?: Record<string, unknown>;
  input?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  metadata?: { position?: { x: number; y: number }; label?: string };
}

interface DslSpec {
  version: string;
  name: string;
  description?: string;
  steps: DslStep[];
}

const STEP_REF_RE = /^steps\.([A-Za-z0-9_-]+)\.output(?:\.(.+))?$/;

export function sanitizeDslStepReferences(spec: DslSpec): DslSpec {
  const ids = new Set(spec.steps.map(s => s.id));
  return {
    ...spec,
    steps: spec.steps.map(step => {
      const deps = (step.dependsOn ?? []).filter(d => d !== step.id && ids.has(d));
      const input = sanitizeControlFlow(step.type, sanitizeObj(step.input, ids), ids);
      const when = hasMissingRef(step.when, ids) ? undefined : step.when;
      return {
        ...step,
        ...(deps.length > 0 ? { dependsOn: deps } : {}),
        ...(deps.length === 0 && step.dependsOn ? { dependsOn: undefined } : {}),
        ...(when ? { when } : step.when ? { when: undefined } : {}),
        ...(input ? { input } : step.input ? { input: undefined } : {}),
      };
    }),
  };
}

function sanitizeControlFlow(
  type: string,
  input: Record<string, unknown> | undefined,
  ids: Set<string>,
): Record<string, unknown> | undefined {
  if (!input) return input;
  if (type === 'if-else') {
    const t = pruneIds(input.then, ids);
    const e = pruneIds(input.else, ids);
    return {
      ...input, then: t,
      ...(e.length > 0 ? { else: e } : {}),
      ...(e.length === 0 && 'else' in input ? { else: undefined } : {}),
    };
  }
  if (type === 'for-each' || type === 'while') {
    return { ...input, body: pruneIds(input.body, ids) };
  }
  return input;
}

function sanitizeObj(
  value: Record<string, unknown> | undefined,
  ids: Set<string>,
): Record<string, unknown> | undefined {
  const s = sanitizeVal(value, ids);
  if (!s || typeof s !== 'object' || Array.isArray(s)) return undefined;
  return s as Record<string, unknown>;
}

function sanitizeVal(value: unknown, ids: Set<string>): unknown {
  if (typeof value === 'string') {
    const m = STEP_REF_RE.exec(value);
    return m && !ids.has(m[1]) ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value.map(e => sanitizeVal(e, ids)).filter(e => e !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce<Record<string, unknown>>((a, [k, v]) => {
    const s = sanitizeVal(v, ids);
    if (s !== undefined) a[k] = s;
    return a;
  }, {});
}

function hasMissingRef(value: unknown, ids: Set<string>): boolean {
  if (typeof value === 'string') {
    const m = STEP_REF_RE.exec(value);
    return Boolean(m && !ids.has(m[1]));
  }
  if (Array.isArray(value)) return value.some(e => hasMissingRef(e, ids));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(e => hasMissingRef(e, ids));
}

function pruneIds(value: unknown, ids: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((e): e is string => typeof e === 'string' && ids.has(e));
}
