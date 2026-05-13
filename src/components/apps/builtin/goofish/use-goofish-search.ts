'use client';

import * as React from 'react';

const APP_ID = 'goofish-assistant';

export type SearchScope = 'market' | 'shop' | 'history' | 'buyer';

export interface SearchResultItem {
  scope: SearchScope;
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  meta?: Record<string, string | number>;
  link?: { type: 'conversation' | 'item' | 'buyer'; id: string };
}

export interface SearchResult {
  scope: SearchScope;
  query: string;
  items: SearchResultItem[];
  total: number;
  reachable: boolean;
  notReachableReason?: string;
  errors: string[];
}

export interface RunSearchInput {
  scope: SearchScope;
  query: string;
  limit?: number;
}

export interface UseGoofishSearch {
  result: SearchResult | null;
  loading: boolean;
  error: string | null;
  run: (input: RunSearchInput) => Promise<SearchResult | null>;
  reset: () => void;
}

export function useGoofishSearch(): UseGoofishSearch {
  const [result, setResult] = React.useState<SearchResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlightRef = React.useRef(false);

  const run = React.useCallback<UseGoofishSearch['run']>(async (input) => {
    const query = input.query.trim();
    if (!query) {
      setError('请输入搜索关键词');
      return null;
    }
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/apps/${encodeURIComponent(APP_ID)}/native-actions/goofish/search`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: input.scope,
            query,
            limit: typeof input.limit === 'number' ? input.limit : 10,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as Partial<SearchResult> & {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      if (!isSearchResult(json)) {
        throw new Error(json.message ?? json.error ?? '搜索失败');
      }
      setResult(json);
      if (!json.reachable && json.notReachableReason) setError(json.notReachableReason);
      return json;
    } catch (err) {
      const message = err instanceof Error ? err.message : '搜索失败';
      setError(message);
      setResult(null);
      return null;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  const reset = React.useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { result, loading, error, run, reset };
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<SearchResult>;
  return (
    typeof r.scope === 'string'
    && typeof r.query === 'string'
    && Array.isArray(r.items)
    && typeof r.reachable === 'boolean'
  );
}
