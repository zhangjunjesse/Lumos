'use client';

import * as React from 'react';

import type {
  CreatorRecord,
  KeywordRecord,
  CreatorCadence,
  KeywordTimeWindow,
} from '@/lib/douyin-collector/types';

export type CreatorRow = CreatorRecord & { id: string };
export type KeywordRow = KeywordRecord & { id: string };

export interface CreatorStatsMap {
  [creatorRef: string]: {
    creatorRef: string;
    collected: number;
    transcribed: number;
    published: number;
  };
}

export interface KeywordStatsMap {
  [keyLower: string]: {
    query: string;
    collected: number;
    transcribed: number;
    published: number;
  };
}

interface SourcesState {
  creators: CreatorRow[];
  keywords: KeywordRow[];
  creatorStats: CreatorStatsMap;
  keywordStats: KeywordStatsMap;
  loading: boolean;
  error: string | null;
}

interface SourcesActions {
  refresh: () => Promise<void>;
  addCreator: (input: { input: string; nickname?: string; cadence?: CreatorCadence }) => Promise<void>;
  toggleCreator: (id: string, enabled: boolean) => Promise<void>;
  deleteCreator: (id: string) => Promise<void>;
  addKeyword: (input: {
    query: string;
    time_window?: KeywordTimeWindow;
    cadence?: CreatorCadence;
    dedupe_window_days?: number;
  }) => Promise<void>;
  toggleKeyword: (id: string, enabled: boolean) => Promise<void>;
  deleteKeyword: (id: string) => Promise<void>;
  ingestKeywordUrls: (
    id: string,
    text: string,
  ) => Promise<{
    ok: boolean;
    processed?: number;
    succeeded?: number;
    failed?: number;
    message?: string;
    reasons?: string[];
  }>;
}

export function useCollectSources(): SourcesState & SourcesActions {
  const [state, setState] = React.useState<SourcesState>({
    creators: [],
    keywords: [],
    creatorStats: {},
    keywordStats: {},
    loading: true,
    error: null,
  });

  const refresh = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [cRes, kRes, sRes, ksRes] = await Promise.all([
        fetch('/api/apps/builtin/douyin-collector/creators', { cache: 'no-store' }),
        fetch('/api/apps/builtin/douyin-collector/keywords', { cache: 'no-store' }),
        fetch('/api/apps/builtin/douyin-collector/creators/stats', { cache: 'no-store' }),
        fetch('/api/apps/builtin/douyin-collector/keywords/stats', { cache: 'no-store' }),
      ]);
      if (!cRes.ok) throw new Error(`creators HTTP ${cRes.status}`);
      if (!kRes.ok) throw new Error(`keywords HTTP ${kRes.status}`);
      const cJson = (await cRes.json()) as { items: CreatorRow[] };
      const kJson = (await kRes.json()) as { items: KeywordRow[] };
      let creatorStats: CreatorStatsMap = {};
      if (sRes.ok) {
        const sJson = (await sRes.json()) as { stats?: CreatorStatsMap };
        creatorStats = sJson.stats ?? {};
      }
      let keywordStats: KeywordStatsMap = {};
      if (ksRes.ok) {
        const ksJson = (await ksRes.json()) as { stats?: KeywordStatsMap };
        keywordStats = ksJson.stats ?? {};
      }
      setState({
        creators: cJson.items ?? [],
        keywords: kJson.items ?? [],
        creatorStats,
        keywordStats,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState({
        creators: [],
        keywords: [],
        creatorStats: {},
        keywordStats: {},
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const addCreator = React.useCallback<SourcesActions['addCreator']>(async (input) => {
    const res = await fetch('/api/apps/builtin/douyin-collector/creators', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    await refresh();
  }, [refresh]);

  const toggleCreator = React.useCallback<SourcesActions['toggleCreator']>(async (id, enabled) => {
    const res = await fetch(`/api/apps/builtin/douyin-collector/creators/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refresh();
  }, [refresh]);

  const deleteCreator = React.useCallback<SourcesActions['deleteCreator']>(async (id) => {
    const res = await fetch(`/api/apps/builtin/douyin-collector/creators/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refresh();
  }, [refresh]);

  const addKeyword = React.useCallback<SourcesActions['addKeyword']>(async (input) => {
    const res = await fetch('/api/apps/builtin/douyin-collector/keywords', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    await refresh();
  }, [refresh]);

  const toggleKeyword = React.useCallback<SourcesActions['toggleKeyword']>(async (id, enabled) => {
    const res = await fetch(`/api/apps/builtin/douyin-collector/keywords/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refresh();
  }, [refresh]);

  const deleteKeyword = React.useCallback<SourcesActions['deleteKeyword']>(async (id) => {
    const res = await fetch(`/api/apps/builtin/douyin-collector/keywords/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refresh();
  }, [refresh]);

  const ingestKeywordUrls = React.useCallback<SourcesActions['ingestKeywordUrls']>(
    async (id, text) => {
      const res = await fetch(`/api/apps/builtin/douyin-collector/keywords/${id}/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        processed?: number;
        succeeded?: number;
        failed?: number;
        message?: string;
        reasons?: string[];
      };
      if (json.ok || (json.processed ?? 0) > 0) await refresh();
      return {
        ok: !!json.ok,
        processed: json.processed,
        succeeded: json.succeeded,
        failed: json.failed,
        message: json.message,
        reasons: json.reasons,
      };
    },
    [refresh],
  );

  return {
    ...state,
    refresh,
    addCreator,
    toggleCreator,
    deleteCreator,
    addKeyword,
    toggleKeyword,
    deleteKeyword,
    ingestKeywordUrls,
  };
}
