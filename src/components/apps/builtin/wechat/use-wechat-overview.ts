'use client';

import * as React from 'react';

import type { OverviewData, OverviewReason } from '@/lib/wechat-assistant/overview-types';

export interface UseWeChatOverview {
  data: OverviewData | null;
  ready: boolean;
  reason: OverviewReason | null;
  /** First-load indicator (no data yet). */
  loading: boolean;
  /** True while a manual `refresh()` is in flight. */
  analyzing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface ApiResponse {
  ready: boolean;
  reason?: OverviewReason;
  data?: OverviewData;
  error?: string;
  message?: string;
}

/**
 * Loads the wechat overview snapshot once on mount. `refresh()` re-runs the
 * (expensive) python snapshot. The hook never auto-refreshes on settings
 * changes — UX expects users to hit "重新分析" explicitly.
 */
export function useWeChatOverview(): UseWeChatOverview {
  const [data, setData] = React.useState<OverviewData | null>(null);
  const [ready, setReady] = React.useState(false);
  const [reason, setReason] = React.useState<OverviewReason | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlightRef = React.useRef<AbortController | null>(null);
  const hasLoadedRef = React.useRef(false);

  const fetchOnce = React.useCallback(async () => {
    inFlightRef.current?.abort();
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;
    if (hasLoadedRef.current) setAnalyzing(true);
    try {
      const res = await fetch('/api/apps/builtin/wechat/overview', {
        cache: 'no-store',
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as Partial<ApiResponse>;
      if (!res.ok) {
        throw new Error(json.message ?? json.error ?? '概况加载失败');
      }
      if (json.ready && json.data) {
        setData(json.data);
        setReady(true);
        setReason(null);
        setError(null);
      } else {
        setReady(false);
        setReason(json.reason ?? 'snapshot_failed');
        setError(json.message ?? null);
      }
      hasLoadedRef.current = true;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
        setAnalyzing(false);
      }
    }
  }, []);

  React.useEffect(() => {
    void fetchOnce();
    return () => inFlightRef.current?.abort();
  }, [fetchOnce]);

  return { data, ready, reason, loading, analyzing, error, refresh: fetchOnce };
}
