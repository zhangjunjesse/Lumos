'use client';

import * as React from 'react';

export const APP_ID = 'douyin-collector';

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

  return { rows, loading, error, refresh, update };
}
