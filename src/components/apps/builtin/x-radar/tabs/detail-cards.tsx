'use client';

import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface ProductRow {
  id: string;
  task_ref?: string;
  failure_reason?: string;
  author_screen?: string; author_name?: string; tweet_text?: string; tweet_url?: string;
  tweet_created_at?: string; matched_rule?: string;
  like_count?: number; retweet_count?: number; reply_count?: number; view_count?: number;
  status?: string;
  topic?: string; report_md?: string; summary_md?: string; evidence_count?: number;
  window_kind?: string; window_start?: string; window_end?: string;
  account_count?: number; tweet_count?: number;
  target?: string; metrics_json?: string;
  sample_start?: string; sample_end?: string;
  created_at?: string; hit_at?: string; updated_at?: string;
}

export interface RunHistoryRow {
  id: string;
  title?: string;
  status?: string;
  summary?: string;
  failure_reason?: string;
  task_ref?: string;
  started_at?: string;
  ended_at?: string;
}

export interface TweetEvidenceRow {
  id: string;
  author_screen?: string;
  author_name?: string;
  text?: string;
  tweet_created_at?: string;
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  view_count?: number;
  url?: string;
}

const METRIC_LABEL: Record<string, string> = {
  tweet_count: '推文数',
  avg_like: '平均点赞',
  avg_retweet: '平均转推',
  avg_reply: '平均回复',
  engagement_rate: '互动率',
  sample_days: '采样天数',
  sample_truncated: '样本截断',
};

function formatMetric(v: unknown): string {
  // null/undefined → 「—」，避免显示字面 "null"；boolean → 「是 / 否」
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'number') return String(v);
  return String(v);
}

export function fmtDate(s?: string): string {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
}

export function MdBody({ content }: { content: string }): React.ReactElement {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5">{children}<ExternalLink className="size-3 inline" /></a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const RUN_STATUS_LABEL: Record<string, string> = { success: '成功', failed: '失败', running: '运行中', cancelled: '已取消' };

export function RunHistoryItem({ row }: { row: RunHistoryRow }): React.ReactElement {
  const status = row.status ?? 'unknown';
  const statusColor =
    status === 'success' ? 'text-emerald-600 dark:text-emerald-400'
    : status === 'failed' ? 'text-red-600 dark:text-red-400'
    : status === 'running' ? 'text-blue-600 dark:text-blue-400'
    : 'text-muted-foreground';
  const started = row.started_at
    ? new Date(row.started_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
  const durationMs = row.started_at && row.ended_at
    ? Date.parse(row.ended_at) - Date.parse(row.started_at)
    : null;
  const duration = durationMs !== null && Number.isFinite(durationMs)
    ? durationMs < 1000 ? `${durationMs}ms` : durationMs < 60_000 ? `${(durationMs / 1000).toFixed(1)}s` : `${Math.round(durationMs / 60_000)}m`
    : '';
  return (
    <div className="px-4 py-2.5 space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className={`font-medium ${statusColor}`}>{RUN_STATUS_LABEL[status] ?? status}</span>
        <span className="text-muted-foreground">· {started}</span>
        {duration && <span className="text-muted-foreground">· 耗时 {duration}</span>}
      </div>
      {row.summary && <div className="text-xs text-muted-foreground line-clamp-2">{row.summary}</div>}
      {row.failure_reason && status === 'failed' && (
        <div className="text-xs text-red-600 line-clamp-2">{row.failure_reason}</div>
      )}
    </div>
  );
}

export function EvidenceItem({ row, matchedAt }: { row: TweetEvidenceRow; matchedAt?: string }): React.ReactElement {
  return (
    <div className="px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="font-semibold">@{row.author_screen}</span>
        {row.author_name && <span className="text-muted-foreground">{row.author_name}</span>}
        <span className="text-muted-foreground">· 发推 {fmtDate(row.tweet_created_at)}</span>
        {matchedAt && <span className="text-muted-foreground">· 抓取 {fmtDate(matchedAt)}</span>}
        {row.url && (
          <a href={row.url} target="_blank" rel="noreferrer" className="ml-auto text-blue-600 hover:underline inline-flex items-center gap-0.5 text-xs">
            原推 <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{row.text}</p>
      <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
        <span>❤ {row.like_count ?? 0}</span>
        <span>🔁 {row.retweet_count ?? 0}</span>
        <span>💬 {row.reply_count ?? 0}</span>
        <span>👁 {row.view_count ?? 0}</span>
      </div>
    </div>
  );
}

export function AlertCard({ row }: { row: ProductRow }): React.ReactElement {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="font-semibold">@{row.author_screen}</span>
        {row.author_name && <span className="text-muted-foreground">{row.author_name}</span>}
        <Badge variant="outline" className="text-[10px]">{row.matched_rule ?? 'matched'}</Badge>
        {row.status === 'notified' && <Badge variant="secondary" className="text-[10px]">已推送</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{fmtDate(row.tweet_created_at)}</span>
      </div>
      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">{row.tweet_text}</p>
      <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
        <span>❤ {row.like_count ?? 0}</span>
        <span>🔁 {row.retweet_count ?? 0}</span>
        <span>💬 {row.reply_count ?? 0}</span>
        <span>👁 {row.view_count ?? 0}</span>
        {row.tweet_url && (
          <a href={row.tweet_url} target="_blank" rel="noreferrer" className="ml-auto text-blue-600 hover:underline inline-flex items-center gap-0.5">
            原推 <ExternalLink className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export function ReportCard({ row }: { row: ProductRow }): React.ReactElement {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="text-base font-semibold">{row.topic || '未命名'}</h4>
        <Badge variant="outline" className="text-[10px]">{row.evidence_count ?? 0} 条证据</Badge>
        <span className="ml-auto text-xs text-muted-foreground">{fmtDate(row.created_at)}</span>
      </div>
      {row.failure_reason && <Alert variant="destructive"><AlertDescription className="text-xs">{row.failure_reason}</AlertDescription></Alert>}
      {row.report_md ? <MdBody content={row.report_md} /> : <p className="text-xs text-muted-foreground italic">报告未生成</p>}
    </div>
  );
}

export function DigestCardItem({ row }: { row: ProductRow }): React.ReactElement {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <Badge variant="secondary">{row.window_kind === 'weekly' ? '周报' : '日报'}</Badge>
        <span className="text-muted-foreground">{fmtDate(row.window_start)} → {fmtDate(row.window_end)}</span>
        <Badge variant="outline" className="text-[10px]">{row.account_count ?? 0} 账号 · {row.tweet_count ?? 0} 推</Badge>
      </div>
      {row.failure_reason && <Alert variant="destructive"><AlertDescription className="text-xs">{row.failure_reason}</AlertDescription></Alert>}
      {row.summary_md ? <MdBody content={row.summary_md} /> : <p className="text-xs text-muted-foreground italic">简报未生成</p>}
    </div>
  );
}

export function StatsCardItem({ row }: { row: ProductRow }): React.ReactElement {
  let metrics: Record<string, unknown> | null = null;
  if (row.metrics_json) { try { metrics = JSON.parse(row.metrics_json) as Record<string, unknown>; } catch { /* ignore */ } }
  return (
    <div className="rounded-lg border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <h4 className="text-base font-semibold">{row.target || '未命名'}</h4>
        <span className="text-muted-foreground text-xs">{fmtDate(row.sample_start)} → {fmtDate(row.sample_end)}</span>
      </div>
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(metrics).slice(0, 8).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-muted px-3 py-2">
              <div className="text-[10px] text-muted-foreground truncate">{METRIC_LABEL[k] ?? k}</div>
              <div className="font-mono text-base tabular-nums">{formatMetric(v)}</div>
            </div>
          ))}
        </div>
      )}
      {row.failure_reason && <Alert variant="destructive"><AlertDescription className="text-xs">{row.failure_reason}</AlertDescription></Alert>}
      {row.report_md && <MdBody content={row.report_md} />}
    </div>
  );
}
