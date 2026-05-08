import type { AppRow } from '@/lib/app/runtime/data-store';

/**
 * Renderer bridge — the surface a PageRenderer talks to for any operation
 * that crosses the renderer-process boundary (DB writes, workflow runs,
 * navigation, dialogs, toasts).
 *
 * Backends:
 *   - Production (Electron + Next.js): a concrete impl that calls
 *     /api/apps/<id>/{run,data,...} routes; wired at AppContainer
 *     mount time.
 *   - Tests / Storybook: createStubRendererBridge() returns an in-memory
 *     impl that records calls and resolves promises immediately, so a
 *     PageRenderer can be exercised without the full Electron pipeline.
 *
 * The bridge itself does NOT enforce permissions. Permission enforcement
 * lives in the backend (where the AppRunContext is rebuilt for each
 * operation and consults the PermissionGate). Renderer-side, the bridge
 * just relays.
 */

export interface ToastOptions {
  title: string;
  description?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
}

export interface DbQueryOptions {
  filter?: Record<string, unknown>;
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export interface RendererBridge {
  // ---- workflow ----
  runWorkflow(
    workflowId: string,
    inputs: Record<string, unknown>,
  ): Promise<{ output: unknown; status: 'success' | 'failed' | 'cancelled'; error?: string }>;

  // ---- db ----
  dbQuery(collection: string, opts?: DbQueryOptions): Promise<AppRow[]>;
  dbGet(collection: string, id: string): Promise<AppRow | null>;
  dbCount(collection: string, filter?: Record<string, unknown>): Promise<number>;
  dbCreate(collection: string, data: Record<string, unknown>): Promise<AppRow>;
  dbUpdate(
    collection: string,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<AppRow | null>;
  dbDelete(collection: string, id: string): Promise<boolean>;

  // ---- config ----
  /** Read a non-secret config value. Secrets are never returned to the renderer. */
  configGet(key: string): Promise<string | null>;

  // ---- IM ----
  sendImNotification(payload: Record<string, unknown>): Promise<unknown>;

  // ---- native integrations ----
  runNativeAction(
    integration: string,
    action: string,
    payload: Record<string, unknown>,
  ): Promise<unknown>;

  // ---- ui side-effects ----
  navigate(menuId: string): void;
  openDialog(dialogId: string, payload?: unknown): void;
  toast(opts: ToastOptions): void;
  confirm(message: string): Promise<boolean>;
}

/**
 * In-memory bridge for tests and Storybook-style previews. Records every
 * call and serves db ops from a Map. Workflow runs return a deterministic
 * stub keyed by workflow id.
 */
export interface StubBridge extends RendererBridge {
  readonly calls: Array<{ method: keyof RendererBridge; args: unknown[] }>;
  /** Inject canned data for a collection (used by previews). */
  seedCollection(collection: string, rows: AppRow[]): void;
  /** Inject a canned workflow result. */
  seedWorkflow(
    workflowId: string,
    result: { output: unknown; status?: 'success' | 'failed' | 'cancelled'; error?: string },
  ): void;
}

export function createStubRendererBridge(): StubBridge {
  const collections = new Map<string, Map<string, AppRow>>();
  const wfResults = new Map<
    string,
    { output: unknown; status: 'success' | 'failed' | 'cancelled'; error?: string }
  >();
  const calls: StubBridge['calls'] = [];
  let idCounter = 0;
  const nextId = () => `stub-${++idCounter}`;

  function track<T extends keyof RendererBridge>(method: T, args: unknown[]): void {
    calls.push({ method, args });
  }
  function getColl(name: string): Map<string, AppRow> {
    let m = collections.get(name);
    if (!m) {
      m = new Map();
      collections.set(name, m);
    }
    return m;
  }

  return {
    calls,
    seedCollection(collection, rows) {
      const m = getColl(collection);
      m.clear();
      for (const r of rows) m.set(r.id, { ...r });
    },
    seedWorkflow(workflowId, result) {
      wfResults.set(workflowId, { status: 'success', ...result });
    },

    async runWorkflow(workflowId, inputs) {
      track('runWorkflow', [workflowId, inputs]);
      return wfResults.get(workflowId) ?? { output: null, status: 'success' };
    },

    async dbQuery(collection, opts) {
      track('dbQuery', [collection, opts]);
      const all = Array.from(getColl(collection).values());
      let result = all.slice();
      if (opts?.filter) {
        result = result.filter((row) =>
          Object.entries(opts.filter!).every(([k, v]) => (row as Record<string, unknown>)[k] === v),
        );
      }
      if (opts?.limit !== undefined) {
        const off = opts.offset ?? 0;
        result = result.slice(off, off + opts.limit);
      }
      return result;
    },
    async dbGet(collection, id) {
      track('dbGet', [collection, id]);
      return getColl(collection).get(id) ?? null;
    },
    async dbCount(collection, filter) {
      track('dbCount', [collection, filter]);
      if (!filter) return getColl(collection).size;
      return Array.from(getColl(collection).values()).filter((r) =>
        Object.entries(filter).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
      ).length;
    },
    async dbCreate(collection, data) {
      track('dbCreate', [collection, data]);
      const id = (data.id as string | undefined) ?? nextId();
      const row = { ...data, id } as AppRow;
      getColl(collection).set(id, row);
      return row;
    },
    async dbUpdate(collection, id, patch) {
      track('dbUpdate', [collection, id, patch]);
      const m = getColl(collection);
      const existing = m.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch, id };
      m.set(id, next);
      return next;
    },
    async dbDelete(collection, id) {
      track('dbDelete', [collection, id]);
      return getColl(collection).delete(id);
    },

    async configGet(key) {
      track('configGet', [key]);
      return null;
    },

    async sendImNotification(payload) {
      track('sendImNotification', [payload]);
      return { ok: true, status: 'sent' };
    },

    async runNativeAction(integration, action, payload) {
      track('runNativeAction', [integration, action, payload]);
      return { ok: true, integration, action };
    },

    navigate(menuId) {
      track('navigate', [menuId]);
    },
    openDialog(dialogId, payload) {
      track('openDialog', [dialogId, payload]);
    },
    toast(opts) {
      track('toast', [opts]);
    },
    async confirm(message) {
      track('confirm', [message]);
      return true;
    },
  };
}
