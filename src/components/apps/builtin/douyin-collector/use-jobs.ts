'use client';

import * as React from 'react';

import type { CollectJobRecord, JobKind } from '@/lib/douyin-collector/types';

export type CollectJobRow = CollectJobRecord & { id: string };

interface State {
  jobs: CollectJobRow[];
  loading: boolean;
  error: string | null;
}

interface Actions {
  refresh: () => Promise<void>;
  enqueue: (input: { kind: JobKind; targetRef: string }) => Promise<void>;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
}

export function useJobs(): State & Actions {
  const [state, setState] = React.useState<State>({
    jobs: [],
    loading: true,
    error: null,
  });

  const refresh = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetch('/api/apps/builtin/douyin-collector/jobs', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: CollectJobRow[] };
      setState({ jobs: json.items ?? [], loading: false, error: null });
    } catch (err) {
      setState({
        jobs: [],
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const enqueue = React.useCallback<Actions['enqueue']>(async (input) => {
    const res = await fetch('/api/apps/builtin/douyin-collector/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: input.kind, target_ref: input.targetRef }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    await refresh();
  }, [refresh]);

  const cancel = React.useCallback<Actions['cancel']>(async (id) => {
    const res = await fetch(`/api/apps/builtin/douyin-collector/jobs/${id}?action=cancel`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refresh();
  }, [refresh]);

  const retry = React.useCallback<Actions['retry']>(async (id) => {
    const res = await fetch(`/api/apps/builtin/douyin-collector/jobs/${id}?action=retry`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refresh();
  }, [refresh]);

  return { ...state, refresh, enqueue, cancel, retry };
}
