'use client';

import * as React from 'react';

import type { AppSettings, ProviderOption } from './app-settings';

const PUT_DEBOUNCE_MS = 500;

interface FetchResponse {
  settings?: AppSettings;
  providers?: ProviderOption[];
  error?: string;
  message?: string;
}

export interface UseWeChatSettings {
  /** null while initial GET in flight. */
  settings: AppSettings | null;
  providers: ProviderOption[];
  loading: boolean;
  saving: boolean;
  /** Last PUT error (still keeps optimistic local state). */
  error: string | null;
  /** Replace settings locally + debounce-PUT to backend. */
  update: (next: AppSettings | ((prev: AppSettings) => AppSettings)) => void;
  /** Retry the last failed PUT without requiring another settings change. */
  retrySave: () => Promise<void>;
  /** Force a fresh GET — useful after Lumos provider list changes elsewhere. */
  refresh: () => Promise<void>;
}

export function useWeChatSettings(): UseWeChatSettings {
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [providers, setProviders] = React.useState<ProviderOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const pendingPayloadRef = React.useRef<AppSettings | null>(null);
  const failedPayloadRef = React.useRef<AppSettings | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/apps/builtin/wechat/settings', { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as FetchResponse;
      if (!res.ok || !json.settings) {
        throw new Error(json.message ?? json.error ?? '加载失败');
      }
      setSettings(json.settings);
      setProviders(Array.isArray(json.providers) ? json.providers : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const flush = React.useCallback(async () => {
    const payload = pendingPayloadRef.current;
    if (!payload) return;
    pendingPayloadRef.current = null;
    failedPayloadRef.current = null;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSaving(true);
    try {
      const res = await fetch('/api/apps/builtin/wechat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as FetchResponse;
      if (!res.ok || !json.settings) {
        throw new Error(json.message ?? json.error ?? '保存失败');
      }
      // server-canonicalised settings (defaults filled, fields validated)
      // — adopt only if user hasn't typed something newer in the meantime.
      if (!pendingPayloadRef.current) setSettings(json.settings);
      failedPayloadRef.current = null;
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      if (!pendingPayloadRef.current) {
        failedPayloadRef.current = payload;
        setError(err instanceof Error ? err.message : '保存失败');
      }
    } finally {
      setSaving(false);
    }
  }, []);

  const retrySave = React.useCallback<UseWeChatSettings['retrySave']>(async () => {
    const payload = failedPayloadRef.current;
    if (!payload) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingPayloadRef.current = payload;
    failedPayloadRef.current = null;
    setError(null);
    await flush();
  }, [flush]);

  const update = React.useCallback<UseWeChatSettings['update']>(
    (next) => {
      failedPayloadRef.current = null;
      setError(null);
      setSettings((prev) => {
        if (!prev) return prev;
        const value = typeof next === 'function' ? next(prev) : next;
        pendingPayloadRef.current = value;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          void flush();
        }, PUT_DEBOUNCE_MS);
        return value;
      });
    },
    [flush],
  );

  // flush pending writes on unmount
  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      void flush();
    },
    [flush],
  );

  return { settings, providers, loading, saving, error, update, retrySave, refresh };
}
