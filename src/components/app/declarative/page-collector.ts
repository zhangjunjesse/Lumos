import type { AppPage } from '@/lib/app/manifest/types';

/**
 * Walk a page JSON and pull out every `db.<collection>` referenced in
 * binding expressions. The page renderer uses this to pre-fetch all
 * required collections before mount, so the first render is binding-ready.
 *
 * Pure function on the AST — no React, no DOM.
 */

const DB_REF_RE = /\{\{\s*db\.([a-z][a-z0-9_]*)\b/g;

export function collectReferencedCollections(page: AppPage): string[] {
  const found = new Set<string>();
  walk(page, (s) => {
    let m: RegExpExecArray | null;
    const re = new RegExp(DB_REF_RE.source, DB_REF_RE.flags);
    while ((m = re.exec(s)) !== null) found.add(m[1]);
  });
  return Array.from(found).sort();
}

function walk(value: unknown, cb: (s: string) => void): void {
  if (typeof value === 'string') {
    cb(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) walk(v, cb);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) walk(v, cb);
  }
}
