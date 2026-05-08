// Renderer-side dispatcher adapters that wrap fetch() calls to existing
// Lumos REST endpoints. Used by SandboxIframe.tsx to feed the dispatcher.
//
// Why this layer: the dispatcher itself is environment-agnostic and works
// with any adapter shape. In the renderer we don't have direct SQLite
// access, but we can hit /api/apps/[id]/data which does.

import type { DispatcherAdapters } from './dispatcher';

export interface ApiAdaptersOptions {
  /** App id used in the URL path. Same id as the iframe URL host. */
  appId: string;
  /** Optional fetch override for tests. */
  fetcher?: typeof fetch;
}

export function createApiAdapters(opts: ApiAdaptersOptions): DispatcherAdapters {
  const { appId } = opts;
  const f = opts.fetcher ?? fetch;
  const base = `/api/apps/${encodeURIComponent(appId)}/data`;

  return {
    db: {
      async list(collection, listOpts) {
        const o = (listOpts ?? {}) as { limit?: number; offset?: number; filter?: unknown; sort?: string };
        const url = new URL(base, window.location.origin);
        url.searchParams.set('collection', collection);
        if (typeof o.limit === 'number') url.searchParams.set('limit', String(o.limit));
        if (typeof o.offset === 'number') url.searchParams.set('offset', String(o.offset));
        const res = await f(url.toString());
        const json = (await safeJson(res)) as { rows?: unknown[]; error?: string };
        if (!res.ok) throw new Error(json?.error ?? `db.list ${res.status}`);
        let rows = json.rows ?? [];
        if (o.filter) rows = applyClientFilter(rows, o.filter);
        if (o.sort) rows = applyClientSort(rows, o.sort);
        return rows;
      },
      async get(collection, id) {
        const url = new URL(base, window.location.origin);
        url.searchParams.set('collection', collection);
        url.searchParams.set('id', id);
        const res = await f(url.toString());
        const json = (await safeJson(res)) as { row?: unknown; error?: string };
        if (!res.ok) throw new Error(json?.error ?? `db.get ${res.status}`);
        return json.row ?? null;
      },
      async count(collection, filter) {
        // No /count endpoint; client-side count after list.
        const all = await this.list(collection, { filter });
        return all.length;
      },
      async create(collection, data) {
        const url = new URL(base, window.location.origin);
        url.searchParams.set('collection', collection);
        const res = await f(url.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const json = (await safeJson(res)) as { row?: unknown; error?: string };
        if (!res.ok) throw new Error(json?.error ?? `db.create ${res.status}`);
        return json.row;
      },
      async update(collection, id, patch) {
        const url = new URL(base, window.location.origin);
        url.searchParams.set('collection', collection);
        url.searchParams.set('id', id);
        const res = await f(url.toString(), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.status === 404) return null;
        const json = (await safeJson(res)) as { row?: unknown; error?: string };
        if (!res.ok) throw new Error(json?.error ?? `db.update ${res.status}`);
        return json.row ?? null;
      },
      async delete(collection, id) {
        const url = new URL(base, window.location.origin);
        url.searchParams.set('collection', collection);
        url.searchParams.set('id', id);
        const res = await f(url.toString(), { method: 'DELETE' });
        if (res.status === 404) return false;
        if (!res.ok) throw new Error(`db.delete ${res.status}`);
        return true;
      },
    },
    ai: {
      async complete(prompt, opts) {
        const res = await f(`/api/apps/${encodeURIComponent(appId)}/ai/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, opts }),
        });
        const json = (await safeJson(res)) as { text?: string; error?: string } | null;
        if (!res.ok) throw new Error(json?.error ?? `ai.complete ${res.status}`);
        return json?.text ?? '';
      },
    },
    deepsearch: {
      async start(input) {
        return callDeepSearchTool(f, {
          action: 'start',
          query: input.query,
          ...(input.sites ? { sites: input.sites } : {}),
          ...(input.goal ? { goal: input.goal } : {}),
          ...(input.pageMode ? { pageMode: input.pageMode } : {}),
          ...(input.strictness ? { strictness: input.strictness } : {}),
          ...(input.maxPages ? { maxPages: input.maxPages } : {}),
          ...(input.maxDepth ? { maxDepth: input.maxDepth } : {}),
          ...(typeof input.keepEvidence === 'boolean' ? { keepEvidence: input.keepEvidence } : {}),
          ...(typeof input.keepScreenshots === 'boolean' ? { keepScreenshots: input.keepScreenshots } : {}),
        });
      },
      getResult(runId) {
        return callDeepSearchTool(f, { action: 'get_result', runId });
      },
      pause(runId) {
        return callDeepSearchTool(f, { action: 'pause', runId });
      },
      resume(runId) {
        return callDeepSearchTool(f, { action: 'resume', runId });
      },
      cancel(runId) {
        return callDeepSearchTool(f, { action: 'cancel', runId });
      },
    },
    im: {
      async notify(input) {
        const res = await f(`/api/apps/${encodeURIComponent(appId)}/im/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input ?? {}),
        });
        const json = (await safeJson(res)) as { error?: string } | null;
        if (!res.ok) throw new Error(json?.error ?? `im.notify ${res.status}`);
        return json;
      },
    },
    notify: {
      toast(toastOpts) {
        const o = toastOpts as { title: string; description?: string; level?: string };
        // Browser toast fallback — replace with shadcn useToast hook in
        // a later refactor that wires a host-managed toast system.
        if (typeof window !== 'undefined') {
          console.info('[lumos-app toast]', o.title, o.description ?? '');
        }
      },
      async confirm(message) {
        if (typeof window === 'undefined') return false;
        return window.confirm(message);
      },
    },
    storage: {
      async get(scope, key) {
        if (typeof window === 'undefined') return null;
        const raw = window.localStorage.getItem(storageKey(appId, scope, key));
        return raw == null ? null : (JSON.parse(raw) as unknown);
      },
      async set(scope, key, value) {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(storageKey(appId, scope, key), JSON.stringify(value));
      },
      async remove(scope, key) {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(storageKey(appId, scope, key));
      },
      async clear(scope) {
        if (typeof window === 'undefined') return;
        const prefix = `${storageKey(appId, scope, '')}`;
        for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith(prefix)) window.localStorage.removeItem(k);
        }
      },
    },
    // ai / workflow / secrets / config left unset — dispatcher returns
    // UNSUPPORTED, which surfaces to the iframe as a clear error.
  };
}

async function callDeepSearchTool(fetcher: typeof fetch, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetcher('/api/deepsearch/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await safeJson(res)) as { result?: unknown; error?: string } | null;
  if (!res.ok) {
    throw new Error(json?.error ?? `deepsearch.${String(payload.action ?? 'request')} ${res.status}`);
  }
  return json?.result;
}

function storageKey(appId: string, scope: string, key: string): string {
  return `lumos-app:${appId}:${scope}:${key}`;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Reuse the same filter/sort semantics as the SQLite adapter so the iframe
// gets identical behaviour regardless of which adapter is wired.

function applyClientFilter(rows: unknown[], filter: unknown): unknown[] {
  if (!filter || typeof filter !== 'object') return rows;
  const f = filter as Record<string, unknown>;
  return rows.filter((row) => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Record<string, unknown>;
    for (const [field, condition] of Object.entries(f)) {
      const value = r[field];
      if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
        const c = condition as Record<string, unknown>;
        if ('eq' in c && value !== c.eq) return false;
        if ('neq' in c && value === c.neq) return false;
        if ('gt' in c && !(typeof value === 'number' && value > (c.gt as number))) return false;
        if ('gte' in c && !(typeof value === 'number' && value >= (c.gte as number))) return false;
        if ('lt' in c && !(typeof value === 'number' && value < (c.lt as number))) return false;
        if ('lte' in c && !(typeof value === 'number' && value <= (c.lte as number))) return false;
        if ('contains' in c && !(typeof value === 'string' && value.includes(String(c.contains)))) return false;
        if ('in' in c && Array.isArray(c.in) && !(c.in as unknown[]).includes(value)) return false;
      } else if (value !== condition) {
        return false;
      }
    }
    return true;
  });
}

function applyClientSort(rows: unknown[], sort: string): unknown[] {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)?.[field];
    const bv = (b as Record<string, unknown>)?.[field];
    if (av === bv) return 0;
    if (av == null) return desc ? 1 : -1;
    if (bv == null) return desc ? -1 : 1;
    if ((av as number | string) < (bv as number | string)) return desc ? 1 : -1;
    return desc ? -1 : 1;
  });
}
