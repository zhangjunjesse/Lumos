'use client';

import * as React from 'react';

import type {
  TopicRangeSummary,
  TopicScope,
} from '@/lib/wechat-assistant/mirror-store';
import type { TopicProgressEvent } from '@/lib/wechat-assistant/topic-extractor';
import {
  compareBusinessDates,
  defaultTopicDateRange,
  normalizeBusinessDate,
} from '@/lib/wechat-assistant/topic-time';

export interface TopicSummaryView extends TopicRangeSummary {
  inFlight: boolean;
}

export interface TopicProgress {
  phase: 'idle' | 'starting' | 'running' | 'done' | 'error' | 'skipped';
  message: string;
  batchIndex: number;
  batchTotal: number;
  topicsCollected: number;
  reason?: 'whitelist_empty' | 'no_provider' | 'no_model' | 'no_messages' | 'sync_unavailable' | 'in_progress';
}

export interface UseWeChatTopics {
  personal: TopicSummaryView | null;
  group: TopicSummaryView | null;
  dateFrom: string;
  dateTo: string;
  progress: Record<TopicScope, TopicProgress | null>;
  loading: boolean;
  error: string | null;
  setDateRange: (range: { from: string; to: string }) => void;
  refresh: () => Promise<void>;
  runScope: (scope: TopicScope, businessDate?: string) => Promise<void>;
}

const IDLE_PROGRESS: Record<TopicScope, TopicProgress | null> = {
  personal: null,
  group: null,
};
const POLL_WHILE_RUNNING_MS = 5_000;

export function useWeChatTopics(): UseWeChatTopics {
  const [personal, setPersonal] = React.useState<TopicSummaryView | null>(null);
  const [group, setGroup] = React.useState<TopicSummaryView | null>(null);
  const [range, setRange] = React.useState(() => defaultTopicDateRange());
  const [progress, setProgress] = React.useState<Record<TopicScope, TopicProgress | null>>(IDLE_PROGRESS);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const inFlightRef = React.useRef<Map<TopicScope, AbortController>>(new Map());

  const refresh = React.useCallback(async () => {
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      const res = await fetch(`/api/apps/builtin/wechat/topics?${params.toString()}`, { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as {
        dateFrom?: string;
        dateTo?: string;
        personal?: TopicSummaryView;
        group?: TopicSummaryView;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.personal || !json.group) {
        throw new Error(json.message ?? json.error ?? '近期话题加载失败');
      }
      setPersonal(json.personal);
      setGroup(json.group);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const shouldPoll = Boolean(
    personal?.inFlight
    || group?.inFlight
    || isActiveProgress(progress.personal)
    || isActiveProgress(progress.group),
  );
  React.useEffect(() => {
    if (!shouldPoll) return;
    const id = window.setInterval(() => {
      void refresh();
    }, POLL_WHILE_RUNNING_MS);
    return () => window.clearInterval(id);
  }, [refresh, shouldPoll]);

  const runScope = React.useCallback<UseWeChatTopics['runScope']>(async (scope, businessDate = range.to) => {
    const backendInFlight = scope === 'personal' ? personal?.inFlight : group?.inFlight;
    if (inFlightRef.current.has(scope) || backendInFlight) return;
    const ctrl = new AbortController();
    inFlightRef.current.set(scope, ctrl);
    setProgress((prev) => ({
      ...prev,
      [scope]: {
        phase: 'starting',
        message: '正在启动…',
        batchIndex: 0,
        batchTotal: 0,
        topicsCollected: 0,
      },
    }));
    setError(null);

    try {
      const res = await fetch('/api/apps/builtin/wechat/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, businessDate }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(await readErrorMessage(res, '近期话题启动失败'));
      }
      await consumeStream(res.body, (event) => {
        setProgress((prev) => ({ ...prev, [scope]: applyEvent(prev[scope], event) }));
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const message = err instanceof Error ? err.message : '生成失败';
      setError(message);
      setProgress((prev) => ({
        ...prev,
        [scope]: {
          phase: 'error',
          message,
          batchIndex: prev[scope]?.batchIndex ?? 0,
          batchTotal: prev[scope]?.batchTotal ?? 0,
          topicsCollected: prev[scope]?.topicsCollected ?? 0,
        },
      }));
    } finally {
      inFlightRef.current.delete(scope);
      void refresh();
    }
  }, [group?.inFlight, personal?.inFlight, range.to, refresh]);

  const setDateRange = React.useCallback((next: { from: string; to: string }) => {
    const fallback = defaultTopicDateRange();
    let from = normalizeBusinessDate(next.from) ?? normalizeBusinessDate(range.from) ?? fallback.from;
    let to = normalizeBusinessDate(next.to) ?? normalizeBusinessDate(range.to) ?? fallback.to;
    if (compareBusinessDates(from, to) > 0) [from, to] = [to, from];
    setRange({ from, to });
    setLoading(true);
  }, [range.from, range.to]);

  return {
    personal,
    group,
    dateFrom: range.from,
    dateTo: range.to,
    progress,
    loading,
    error,
    setDateRange,
    refresh,
    runScope,
  };
}

function isActiveProgress(progress: TopicProgress | null): boolean {
  return progress?.phase === 'starting' || progress?.phase === 'running';
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: TopicProgressEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nlIdx = buf.indexOf('\n');
    while (nlIdx !== -1) {
      const line = buf.slice(0, nlIdx).trim();
      buf = buf.slice(nlIdx + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as TopicProgressEvent);
        } catch { /* skip */ }
      }
      nlIdx = buf.indexOf('\n');
    }
  }
  if (buf.trim()) {
    try { onEvent(JSON.parse(buf.trim()) as TopicProgressEvent); } catch { /* ignore */ }
  }
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    return json.message ?? json.error ?? `${fallback}：${res.status}`;
  }
  const text = await res.text().catch(() => '');
  return text.trim() || `${fallback}：${res.status}`;
}

function applyEvent(prev: TopicProgress | null, event: TopicProgressEvent): TopicProgress {
  const base: TopicProgress = prev ?? {
    phase: 'idle',
    message: '',
    batchIndex: 0,
    batchTotal: 0,
    topicsCollected: 0,
  };
  switch (event.type) {
    case 'sync':
      return {
        phase: 'running',
        message: event.message,
        batchIndex: 0,
        batchTotal: 0,
        topicsCollected: base.topicsCollected,
      };
    case 'start':
      return {
        phase: 'running',
        message: `分析中 · ${event.chatCount} 个会话 · ${event.batchCount} 批`,
        batchIndex: 0,
        batchTotal: event.batchCount,
        topicsCollected: 0,
      };
    case 'batch':
      return {
        phase: 'running',
        message: `第 ${event.batchIndex + 1} / ${event.batchTotal} 批 · ${event.chat}`,
        batchIndex: event.batchIndex,
        batchTotal: event.batchTotal,
        topicsCollected: base.topicsCollected,
      };
    case 'batch_done':
      return {
        phase: 'running',
        message: `已完成 ${event.batchIndex + 1} / ${base.batchTotal} 批`,
        batchIndex: event.batchIndex + 1,
        batchTotal: base.batchTotal,
        topicsCollected: base.topicsCollected + event.topicsFound,
      };
    case 'done':
      return {
        phase: 'done',
        message: `完成 · 提取出 ${event.topics.length} 个话题`,
        batchIndex: base.batchTotal,
        batchTotal: base.batchTotal,
        topicsCollected: event.topics.length,
      };
    case 'skipped':
      return {
        phase: 'skipped',
        message: skippedHint(event.reason),
        batchIndex: 0,
        batchTotal: 0,
        topicsCollected: 0,
        reason: event.reason,
      };
    case 'error':
      return {
        phase: 'error',
        message: event.message,
        batchIndex: base.batchIndex,
        batchTotal: base.batchTotal,
        topicsCollected: base.topicsCollected,
      };
    default:
      return base;
  }
}

function skippedHint(
  reason: 'whitelist_empty' | 'no_provider' | 'no_model' | 'no_messages' | 'sync_unavailable' | 'in_progress',
): string {
  switch (reason) {
    case 'whitelist_empty':
      return '尚未选择要分析的对话';
    case 'no_provider':
      return '尚未配置 AI 服务商';
    case 'no_model':
      return '当前 AI 服务商没有可用模型';
    case 'no_messages':
      return '窗口内没有足够消息';
    case 'sync_unavailable':
      return '微信消息尚未同步成功';
    case 'in_progress':
      return '已在分析中';
  }
}
