'use client';

import * as React from 'react';

import type {
  DouyinCollectorSettings,
  TranscribePrefer,
} from '@/lib/douyin-collector/settings';

export interface ClientCollectorSettings extends Omit<DouyinCollectorSettings, 'cookie'> {
  cookie: string;
  cookieConfigured: boolean;
  cookiePreview: string | null;
}

interface State {
  settings: ClientCollectorSettings | null;
  loading: boolean;
  error: string | null;
}

interface Actions {
  refresh: () => Promise<void>;
  save: (patch: Partial<DouyinCollectorSettings>) => Promise<void>;
}

export type { TranscribePrefer };

export function useCollectorSettings(): State & Actions {
  const [state, setState] = React.useState<State>({ settings: null, loading: true, error: null });

  const refresh = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch('/api/apps/builtin/douyin-collector/settings', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { settings: ClientCollectorSettings };
      setState({ settings: json.settings, loading: false, error: null });
    } catch (err) {
      setState({
        settings: null,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const save = React.useCallback<Actions['save']>(
    async (patch) => {
      const res = await fetch('/api/apps/builtin/douyin-collector/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { settings: ClientCollectorSettings };
      setState((s) => ({ ...s, settings: json.settings, error: null }));
    },
    [],
  );

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh, save };
}
