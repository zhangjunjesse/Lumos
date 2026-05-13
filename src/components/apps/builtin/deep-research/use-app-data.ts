'use client';

import * as React from 'react';

import { APP_ID } from './deep-research-types';

const dataUrl = (collection: string, params?: Record<string, string>): string => {
  const search = new URLSearchParams({ collection, ...(params ?? {}) });
  return `/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`;
};

export const nativeActionUrl = (integration: string, action: string): string =>
  `/api/apps/${encodeURIComponent(APP_ID)}/native-actions/${integration}/${action}`;

export function useAppCollection<T extends { id: string }>(
  collection: string,
  options?: { sortKey?: keyof T; sortDir?: 'asc' | 'desc' },
) {
  const [rows, setRows] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(dataUrl(collection), { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? `加载 ${collection} 失败`);
      const list = Array.isArray(json.rows) ? (json.rows as T[]) : [];
      if (options?.sortKey) {
        const dir = options.sortDir === 'asc' ? 1 : -1;
        list.sort((a, b) => {
          const av = String(a[options.sortKey!] ?? '');
          const bv = String(b[options.sortKey!] ?? '');
          return av.localeCompare(bv) * dir;
        });
      }
      setRows(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : `加载 ${collection} 失败`);
    } finally {
      setLoading(false);
    }
  }, [collection, options?.sortDir, options?.sortKey]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = React.useCallback(
    async (body: Partial<T>): Promise<T | null> => {
      const res = await fetch(dataUrl(collection), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: T; error?: string };
      if (!res.ok) throw new Error(json.error ?? `新建 ${collection} 失败`);
      await refresh();
      return json.row ?? null;
    },
    [collection, refresh],
  );

  const update = React.useCallback(
    async (id: string, patch: Partial<T>): Promise<T | null> => {
      const res = await fetch(dataUrl(collection, { id }), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: T; error?: string };
      if (!res.ok) throw new Error(json.error ?? `更新 ${collection} 失败`);
      await refresh();
      return json.row ?? null;
    },
    [collection, refresh],
  );

  const remove = React.useCallback(
    async (id: string): Promise<void> => {
      const res = await fetch(dataUrl(collection, { id }), { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `删除 ${collection} 失败`);
      await refresh();
    },
    [collection, refresh],
  );

  return { rows, loading, error, refresh, create, update, remove };
}

export function useTaskScopedCollection<T extends { id: string; task_ref?: string }>(
  collection: string,
  taskRef: string | null,
) {
  const { rows, loading, error, refresh, create, update, remove } = useAppCollection<T>(
    collection,
  );
  const scoped = React.useMemo(
    () => (taskRef ? rows.filter((row) => row.task_ref === taskRef) : []),
    [rows, taskRef],
  );
  return { rows: scoped, loading, error, refresh, create, update, remove };
}
