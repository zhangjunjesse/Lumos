'use client';

import * as React from 'react';

export const APP_ID = 'goofish-assistant';

const dataUrl = (collection: string, params?: Record<string, string>): string => {
  const search = new URLSearchParams({ collection, ...(params ?? {}) });
  return `/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`;
};

export const nativeActionUrl = (integration: string, action: string): string =>
  `/api/apps/${encodeURIComponent(APP_ID)}/native-actions/${integration}/${action}`;

/** Generic typed list-loader for `lumos_app_data` collections. */
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
      try {
        const res = await fetch(dataUrl(collection, { id }), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const json = (await res.json().catch(() => ({}))) as { row?: T; error?: string };
        if (!res.ok || !json.row) throw new Error(json.error ?? '更新失败');
        setRows((prev) => prev.map((r) => (r.id === id ? json.row! : r)));
        setError(null);
        return json.row;
      } catch (err) {
        setError(err instanceof Error ? err.message : '更新失败');
        return null;
      }
    },
    [collection],
  );

  const create = React.useCallback(
    async (data: Partial<T>): Promise<T | null> => {
      try {
        const res = await fetch(dataUrl(collection), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        const json = (await res.json().catch(() => ({}))) as { row?: T; error?: string };
        if (!res.ok || !json.row) throw new Error(json.error ?? '创建失败');
        setRows((prev) => [json.row!, ...prev]);
        return json.row;
      } catch (err) {
        setError(err instanceof Error ? err.message : '创建失败');
        return null;
      }
    },
    [collection],
  );

  return { rows, loading, error, refresh, update, create, setRows };
}

/** Read first row of `app_settings`; create one if missing on save. */
export function useAppSettings<T extends Record<string, unknown>>() {
  const COLLECTION = 'app_settings';
  const [settings, setSettings] = React.useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/apps/${encodeURIComponent(APP_ID)}/data?collection=${COLLECTION}`, {
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? '设置加载失败');
      const list = Array.isArray(json.rows) ? (json.rows as Array<T & { id: string }>) : [];
      setSettings(list[0] ?? null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '设置加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = React.useCallback(
    async (next: T & { id?: string }) => {
      setSaving(true);
      try {
        if (next.id) {
          const res = await fetch(
            `/api/apps/${encodeURIComponent(APP_ID)}/data?collection=${COLLECTION}&id=${encodeURIComponent(next.id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(next),
            },
          );
          const json = (await res.json().catch(() => ({}))) as { row?: T & { id: string }; error?: string };
          if (!res.ok || !json.row) throw new Error(json.error ?? '保存失败');
          setSettings(json.row);
        } else {
          const res = await fetch(`/api/apps/${encodeURIComponent(APP_ID)}/data?collection=${COLLECTION}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          });
          const json = (await res.json().catch(() => ({}))) as { row?: T & { id: string }; error?: string };
          if (!res.ok || !json.row) throw new Error(json.error ?? '保存失败');
          setSettings(json.row);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存失败');
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  /** Debounced setter — updates UI immediately, persists ~500ms later. */
  const update = React.useCallback(
    (patch: Partial<T>) => {
      setSettings((prev) => {
        const next = { ...((prev ?? {}) as T & { id?: string }), ...patch };
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          void save(next);
        }, 500);
        return next as T & { id: string };
      });
    },
    [save],
  );

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { settings, loading, saving, error, refresh, update };
}
