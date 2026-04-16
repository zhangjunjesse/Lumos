interface RefSource {
  id?: string;
  input?: unknown;
  when?: unknown;
}

const STEP_REF_RE = /steps\.([a-zA-Z][\w-]*)\.output/g;

/**
 * Scan a step's inputs (context, condition, template strings, state refs, etc.)
 * for `steps.X.output.*` references and return the set of source step ids.
 * Self-references and unknown ids are filtered out.
 */
export function extractDataRefs(step: RefSource, knownIds: Set<string>): Set<string> {
  const refs = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === 'string') {
      const re = new RegExp(STEP_REF_RE.source, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(v))) {
        const id = m[1];
        if (id !== step.id && knownIds.has(id)) refs.add(id);
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v && typeof v === 'object') {
      for (const val of Object.values(v as Record<string, unknown>)) visit(val);
    }
  };
  visit(step.input);
  visit(step.when);
  return refs;
}
