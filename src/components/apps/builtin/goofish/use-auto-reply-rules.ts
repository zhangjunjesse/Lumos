'use client';

import * as React from 'react';

const APP_ID = 'goofish-assistant';
const COLLECTION = 'auto_reply_rules';

export interface AutoReplyRule {
  id: string;
  trigger_pattern: string;
  trigger_type: 'keyword' | 'regex';
  reply_template: string;
  category?: string;
  enabled: boolean;
  status: 'pending' | 'active';
  match_count: number;
  last_matched_at: string | null;
  updated_at: string;
}

export type AutoReplyRuleDraft = Omit<AutoReplyRule, 'id' | 'match_count' | 'last_matched_at' | 'updated_at'>;

export interface UseAutoReplyRules {
  rules: AutoReplyRule[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (draft: AutoReplyRuleDraft) => Promise<AutoReplyRule | null>;
  update: (id: string, patch: Partial<AutoReplyRule>) => Promise<AutoReplyRule | null>;
  remove: (id: string) => Promise<boolean>;
}

const dataUrl = (params?: Record<string, string>): string => {
  const search = new URLSearchParams({ collection: COLLECTION, ...(params ?? {}) });
  return `/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`;
};

export function useAutoReplyRules(): UseAutoReplyRules {
  const [rules, setRules] = React.useState<AutoReplyRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(dataUrl(), { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? '加载话术失败');
      const list = Array.isArray(json.rows) ? json.rows.filter(isAutoReplyRule) : [];
      list.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
      setRules(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载话术失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = React.useCallback<UseAutoReplyRules['create']>(async (draft) => {
    try {
      const res = await fetch(dataUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: unknown; error?: string };
      if (!res.ok || !isAutoReplyRule(json.row)) {
        throw new Error(json.error ?? '创建话术失败');
      }
      setRules((prev) => [json.row as AutoReplyRule, ...prev]);
      setError(null);
      return json.row as AutoReplyRule;
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建话术失败');
      return null;
    }
  }, []);

  const update = React.useCallback<UseAutoReplyRules['update']>(async (id, patch) => {
    try {
      const res = await fetch(dataUrl({ id }), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: unknown; error?: string };
      if (!res.ok || !isAutoReplyRule(json.row)) {
        throw new Error(json.error ?? '更新话术失败');
      }
      const next = json.row as AutoReplyRule;
      setRules((prev) => prev.map((r) => (r.id === id ? next : r)));
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新话术失败');
      return null;
    }
  }, []);

  const remove = React.useCallback<UseAutoReplyRules['remove']>(async (id) => {
    try {
      const res = await fetch(dataUrl({ id }), { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? '删除话术失败');
      setRules((prev) => prev.filter((r) => r.id !== id));
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除话术失败');
      return false;
    }
  }, []);

  return { rules, loading, error, refresh, create, update, remove };
}

function isAutoReplyRule(value: unknown): value is AutoReplyRule {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<AutoReplyRule>;
  return (
    typeof r.id === 'string'
    && typeof r.trigger_pattern === 'string'
    && (r.trigger_type === 'keyword' || r.trigger_type === 'regex')
    && typeof r.reply_template === 'string'
    && typeof r.enabled === 'boolean'
    && (r.status === 'pending' || r.status === 'active')
  );
}
