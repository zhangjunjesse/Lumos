'use client';

import * as React from 'react';

import type { DouyinCollectorStatus } from './douyin-types';

interface UseDouyinStatusResult {
  status: DouyinCollectorStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDouyinStatus(): UseDouyinStatusResult {
  const [status, setStatus] = React.useState<DouyinCollectorStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/apps/builtin/douyin-collector/status', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DouyinCollectorStatus;
      setStatus(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, error, refresh };
}
