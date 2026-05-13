'use client';

import * as React from 'react';

import type { GoofishAssistantStatus } from './goofish-types';

const APP_ID = 'goofish-assistant';
const RECENT_NOTIFICATION_LIMIT = 5;
const NOTIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_DRAFT_WINDOW_DAYS = 7;

export interface GoofishKpi {
  unreadInboxCount: number;
  pendingReplyCount: number;
  draftsTodayCount: number;
  pendingConfirmCount: number;
  whitelistMatchCount: number;
  recentReminderCount: number;
}

export interface GoofishNotification {
  id: string;
  title?: string;
  text?: string;
  message?: string;
  status?: string;
  createdAt: number;
}

export interface DraftDailyPoint {
  dateLabel: string;
  count: number;
}

export interface UseGoofishOverview {
  status: GoofishAssistantStatus | null;
  statusError: string | null;
  kpi: GoofishKpi | null;
  recentNotifications: GoofishNotification[];
  draftsByDay: DraftDailyPoint[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface ReplyDraftRow extends Record<string, unknown> {
  status?: string;
  channel?: string;
  created_at?: string;
  updated_at?: string;
}

interface BuyerConversationRow extends Record<string, unknown> {
  reply_status?: string;
  unread_count?: number | string;
}

interface AutoReplyRuleRow extends Record<string, unknown> {
  match_count?: number | string;
}

interface AppNotificationRow extends Record<string, unknown> {
  created_at?: string;
  updated_at?: string;
  title?: string;
  text?: string;
  message?: string;
  status?: string;
}

/**
 * Loads goofish status + raw collections, then derives KPI + recent notification
 * cards. Mirrors `use-wechat-overview` in spirit but talks to /api/apps/{id}/data
 * for app-scoped data because goofish doesn't have a precomputed snapshot route.
 */
export function useGoofishOverview(): UseGoofishOverview {
  const [status, setStatus] = React.useState<GoofishAssistantStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [kpi, setKpi] = React.useState<GoofishKpi | null>(null);
  const [recentNotifications, setRecentNotifications] = React.useState<GoofishNotification[]>([]);
  const [draftsByDay, setDraftsByDay] = React.useState<DraftDailyPoint[]>(() => emptyDailySeries());
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlightRef = React.useRef<AbortController | null>(null);
  const hasLoadedRef = React.useRef(false);

  const fetchOnce = React.useCallback(async () => {
    inFlightRef.current?.abort();
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;
    if (hasLoadedRef.current) setRefreshing(true);
    try {
      const [statusJson, drafts, conversations, rules, notifications] = await Promise.all([
        fetchStatus(ctrl.signal),
        fetchCollection<ReplyDraftRow>('reply_drafts', ctrl.signal),
        fetchCollection<BuyerConversationRow>('buyer_conversations', ctrl.signal),
        fetchCollection<AutoReplyRuleRow>('auto_reply_rules', ctrl.signal),
        fetchCollection<AppNotificationRow>('app_notifications', ctrl.signal),
      ]);
      if (ctrl.signal.aborted) return;
      setStatus(statusJson.status);
      setStatusError(statusJson.error);
      setKpi(buildKpi({ drafts, conversations, rules, notifications }));
      setRecentNotifications(buildRecentNotifications(notifications));
      setDraftsByDay(buildDailyDraftSeries(drafts));
      setError(null);
      hasLoadedRef.current = true;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  React.useEffect(() => {
    void fetchOnce();
    return () => inFlightRef.current?.abort();
  }, [fetchOnce]);

  return {
    status,
    statusError,
    kpi,
    recentNotifications,
    draftsByDay,
    loading,
    refreshing,
    error,
    refresh: fetchOnce,
  };
}

async function fetchStatus(signal: AbortSignal): Promise<{
  status: GoofishAssistantStatus | null;
  error: string | null;
}> {
  try {
    const res = await fetch('/api/apps/builtin/goofish/status', {
      cache: 'no-store',
      signal,
    });
    const json = (await res.json().catch(() => ({}))) as Partial<GoofishAssistantStatus> & {
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      return { status: null, error: json.message ?? json.error ?? '状态加载失败' };
    }
    if (!isGoofishStatus(json)) {
      return { status: null, error: '状态字段缺失' };
    }
    return { status: json, error: null };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return { status: null, error: err instanceof Error ? err.message : '状态加载失败' };
  }
}

async function fetchCollection<T extends Record<string, unknown>>(
  collection: string,
  signal: AbortSignal,
): Promise<T[]> {
  try {
    const res = await fetch(
      `/api/apps/${encodeURIComponent(APP_ID)}/data?collection=${encodeURIComponent(collection)}&limit=500`,
      { cache: 'no-store', signal },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { rows?: T[] };
    return Array.isArray(json.rows) ? json.rows : [];
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    return [];
  }
}

function buildKpi(input: {
  drafts: ReplyDraftRow[];
  conversations: BuyerConversationRow[];
  rules: AutoReplyRuleRow[];
  notifications: AppNotificationRow[];
}): GoofishKpi {
  const todayStart = startOfTodayMs();
  const draftsToday = input.drafts.filter((d) => {
    const ts = parseTime(d.created_at) ?? parseTime(d.updated_at);
    return ts !== null && ts >= todayStart;
  }).length;
  const pendingConfirm = input.drafts.filter(
    (d) => d.status === 'pending_confirmation',
  ).length;
  const pendingReply = input.conversations.filter((c) => c.reply_status === '待回复').length;
  const unreadInbox = input.conversations.filter((c) => Number(c.unread_count ?? 0) > 0).length;
  const whitelistMatches = input.rules.reduce(
    (acc, rule) => acc + (Number(rule.match_count ?? 0) || 0),
    0,
  );
  const reminderCutoff = Date.now() - NOTIFICATION_WINDOW_MS;
  const recentReminders = input.notifications.filter((n) => {
    const ts = parseTime(n.created_at) ?? parseTime(n.updated_at);
    return ts !== null && ts >= reminderCutoff;
  }).length;
  return {
    unreadInboxCount: unreadInbox,
    pendingReplyCount: pendingReply,
    draftsTodayCount: draftsToday,
    pendingConfirmCount: pendingConfirm,
    whitelistMatchCount: whitelistMatches,
    recentReminderCount: recentReminders,
  };
}

function buildRecentNotifications(rows: AppNotificationRow[]): GoofishNotification[] {
  const out: GoofishNotification[] = [];
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : '';
    const ts = parseTime(row.created_at) ?? parseTime(row.updated_at);
    if (!id || ts === null) continue;
    out.push({
      id,
      title: typeof row.title === 'string' ? row.title : undefined,
      text: typeof row.text === 'string' ? row.text : undefined,
      message: typeof row.message === 'string' ? row.message : undefined,
      status: typeof row.status === 'string' ? row.status : undefined,
      createdAt: ts,
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, RECENT_NOTIFICATION_LIMIT);
}

function buildDailyDraftSeries(rows: ReplyDraftRow[]): DraftDailyPoint[] {
  const buckets = new Map<string, number>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = DAILY_DRAFT_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(toBucketKey(d), 0);
  }
  for (const row of rows) {
    const ts = parseTime(row.created_at) ?? parseTime(row.updated_at);
    if (ts === null) continue;
    const date = new Date(ts);
    date.setHours(0, 0, 0, 0);
    const key = toBucketKey(date);
    if (!buckets.has(key)) continue;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([key, count]) => ({
    dateLabel: key.slice(5).replace('-', '/'),
    count,
  }));
}

function emptyDailySeries(): DraftDailyPoint[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: DraftDailyPoint[] = [];
  for (let i = DAILY_DRAFT_WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push({
      dateLabel: toBucketKey(d).slice(5).replace('-', '/'),
      count: 0,
    });
  }
  return out;
}

function toBucketKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseTime(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isGoofishStatus(value: unknown): value is GoofishAssistantStatus {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<GoofishAssistantStatus>;
  return (
    !!v.app
    && typeof v.app.id === 'string'
    && !!v.install
    && typeof v.install.installed === 'boolean'
    && !!v.auth
    && typeof v.auth.loggedInCount === 'number'
    && typeof v.ready === 'boolean'
    && typeof v.phase === 'string'
  );
}
