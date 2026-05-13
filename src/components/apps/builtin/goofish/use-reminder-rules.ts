'use client';

import * as React from 'react';

const APP_ID = 'goofish-assistant';
const COLLECTION = 'reminder_rules';

export type ReminderRuleType = 'new_message' | 'reply_timeout' | 'keyword_hit' | 'draft_backlog';
export type ReminderChannel = 'in_app' | 'wechat' | 'desktop';

export interface ReminderRule {
  id: string;
  rule_type: ReminderRuleType;
  threshold_minutes: number;
  threshold_count: number;
  keywords: string[];
  channels: ReminderChannel[];
  enabled: boolean;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  updated_at: string;
}

export type ReminderRuleDraft = Omit<ReminderRule, 'id' | 'last_triggered_at' | 'updated_at'>;

export interface UseReminderRules {
  rules: ReminderRule[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (draft: ReminderRuleDraft) => Promise<ReminderRule | null>;
  update: (id: string, patch: Partial<ReminderRuleDraft>) => Promise<ReminderRule | null>;
  remove: (id: string) => Promise<boolean>;
}

const dataUrl = (params?: Record<string, string>): string => {
  const search = new URLSearchParams({ collection: COLLECTION, ...(params ?? {}) });
  return `/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`;
};

export function useReminderRules(): UseReminderRules {
  const [rules, setRules] = React.useState<ReminderRule[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(dataUrl(), { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? '加载提醒规则失败');
      const list = Array.isArray(json.rows) ? json.rows.map(normalizeRule).filter(isReminderRule) : [];
      list.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
      setRules(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载提醒规则失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = React.useCallback<UseReminderRules['create']>(async (draft) => {
    try {
      const res = await fetch(dataUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializeRule(draft)),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: unknown; error?: string };
      const row = normalizeRule(json.row);
      if (!res.ok || !isReminderRule(row)) throw new Error(json.error ?? '创建规则失败');
      setRules((prev) => [row, ...prev]);
      setError(null);
      return row;
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建规则失败');
      return null;
    }
  }, []);

  const update = React.useCallback<UseReminderRules['update']>(async (id, patch) => {
    try {
      const res = await fetch(dataUrl({ id }), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializeRule(patch)),
      });
      const json = (await res.json().catch(() => ({}))) as { row?: unknown; error?: string };
      const row = normalizeRule(json.row);
      if (!res.ok || !isReminderRule(row)) throw new Error(json.error ?? '更新规则失败');
      setRules((prev) => prev.map((r) => (r.id === id ? row : r)));
      setError(null);
      return row;
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新规则失败');
      return null;
    }
  }, []);

  const remove = React.useCallback<UseReminderRules['remove']>(async (id) => {
    try {
      const res = await fetch(dataUrl({ id }), { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? '删除规则失败');
      setRules((prev) => prev.filter((r) => r.id !== id));
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除规则失败');
      return false;
    }
  }, []);

  return { rules, loading, error, refresh, create, update, remove };
}

function serializeRule(rule: Partial<ReminderRuleDraft>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...rule };
  if (Array.isArray(rule.channels)) out.channels = JSON.stringify(rule.channels);
  if (Array.isArray(rule.keywords)) out.keywords = JSON.stringify(rule.keywords);
  return out;
}

function normalizeRule(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const r = value as Record<string, unknown>;
  return {
    ...r,
    channels: parseJsonArray(r.channels) as ReminderChannel[],
    keywords: parseJsonArray(r.keywords) as string[],
    enabled: r.enabled === true || r.enabled === 1,
    threshold_minutes: typeof r.threshold_minutes === 'number' ? r.threshold_minutes : 30,
    threshold_count: typeof r.threshold_count === 'number' ? r.threshold_count : 5,
    cooldown_minutes: typeof r.cooldown_minutes === 'number' ? r.cooldown_minutes : 10,
    last_triggered_at: typeof r.last_triggered_at === 'string' ? r.last_triggered_at : null,
  };
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function isReminderRule(value: unknown): value is ReminderRule {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ReminderRule>;
  return (
    typeof r.id === 'string'
    && (r.rule_type === 'new_message' || r.rule_type === 'reply_timeout' || r.rule_type === 'keyword_hit' || r.rule_type === 'draft_backlog')
    && Array.isArray(r.channels)
    && Array.isArray(r.keywords)
    && typeof r.enabled === 'boolean'
  );
}
