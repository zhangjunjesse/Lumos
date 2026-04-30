'use client';

import type { RendererBridge, ToastOptions, DbQueryOptions } from './bridge';
import type { AppRow } from '@/lib/app/runtime/data-store';

/**
 * Production RendererBridge backed by the /api/apps/<id>/* HTTP routes.
 *
 * Side-effect handlers (navigate / openDialog / toast / confirm) are
 * supplied by the caller (typically the AppContainer mount) since they
 * involve UI state that lives outside the bridge.
 */

export interface ApiBridgeUiAdapter {
  navigate(menuId: string): void;
  openDialog(dialogId: string, payload?: unknown): void;
  toast(opts: ToastOptions): void;
  confirm(message: string): Promise<boolean>;
}

export function createApiRendererBridge(
  appId: string,
  ui: ApiBridgeUiAdapter,
): RendererBridge {
  const base = `/api/apps/${encodeURIComponent(appId)}`;

  async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
    const res = await fetch(input, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!res.ok) {
      const msg = (json.message ?? json.error ?? `HTTP ${res.status}`) as string;
      throw new Error(msg);
    }
    return json;
  }

  return {
    async runWorkflow(workflowId, inputs) {
      const res = await fetch(`${base}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, inputs }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        output?: unknown;
        status?: 'success' | 'failed' | 'cancelled';
      };
      if (res.status === 503) {
        return { output: null, status: 'failed', error: json.message ?? 'Workflow runtime not ready' };
      }
      if (!res.ok || json.ok === false) {
        return {
          output: json.output ?? null,
          status: json.status ?? 'failed',
          error: json.message ?? json.error ?? `HTTP ${res.status}`,
        };
      }
      return {
        output: json.output ?? null,
        status: json.status ?? 'success',
      };
    },

    async dbQuery(collection, opts?: DbQueryOptions) {
      const params = new URLSearchParams({ collection });
      if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts?.offset !== undefined) params.set('offset', String(opts.offset));
      const json = await fetchJson<{ rows: AppRow[] }>(`${base}/data?${params}`);
      return json.rows;
    },

    async dbGet(collection, id) {
      const params = new URLSearchParams({ collection, id });
      const json = await fetchJson<{ row: AppRow | null }>(`${base}/data?${params}`);
      return json.row;
    },

    async dbCount(collection) {
      // No dedicated count endpoint yet — derive from query length.
      const json = await fetchJson<{ rows: AppRow[] }>(
        `${base}/data?${new URLSearchParams({ collection })}`,
      );
      return json.rows.length;
    },

    async dbCreate(collection, data) {
      const json = await fetchJson<{ row: AppRow }>(
        `${base}/data?${new URLSearchParams({ collection })}`,
        { method: 'POST', body: JSON.stringify(data) },
      );
      return json.row;
    },

    async dbUpdate(collection, id, patch) {
      const json = await fetchJson<{ row: AppRow | null }>(
        `${base}/data?${new URLSearchParams({ collection, id })}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      );
      return json.row;
    },

    async dbDelete(collection, id) {
      const res = await fetch(
        `${base}/data?${new URLSearchParams({ collection, id })}`,
        { method: 'DELETE' },
      );
      if (res.status === 404) return false;
      return res.ok;
    },

    async configGet(key) {
      const json = await fetchJson<{
        entries: Array<{ key: string; isSecret: boolean; value: string | null }>;
      }>(`${base}/config`);
      const entry = json.entries.find((e) => e.key === key);
      return entry?.isSecret ? null : entry?.value ?? null;
    },

    navigate: ui.navigate,
    openDialog: ui.openDialog,
    toast: ui.toast,
    confirm: ui.confirm,
  };
}
