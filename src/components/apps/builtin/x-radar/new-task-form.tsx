'use client';

import * as React from 'react';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { RadarKind } from './NewTaskDialog';

export function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function defaultFields(kind: RadarKind): Record<string, string> {
  switch (kind) {
    case 'monitor': return { keywords: '', from_handles: '', exclude_keywords: '', window_hours: '24', min_like: '0', min_retweet: '0', search_mode: 'Latest' };
    case 'topic': return { topic: '', queries: '', max_fetch: '50', thread_extract_count: '20' };
    case 'digest': return { handles: '', window_kind: 'daily', per_handle_count: '10' };
    case 'stats': return { target_kind: 'handle', target: '', sample_days: '14', top_threads_count: '5' };
  }
}

/** 把 task.config_json 反解析成 dialog 表单字段（编辑模式反填用）。 */
export function parseConfigToFields(kind: RadarKind, configJson: string | undefined): Record<string, string> {
  const fallback = defaultFields(kind);
  if (!configJson) return fallback;
  let cfg: Record<string, unknown>;
  try { cfg = JSON.parse(configJson) as Record<string, unknown>; }
  catch { return fallback; }
  const list = (v: unknown): string => Array.isArray(v) ? v.join(', ') : '';
  const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
  if (kind === 'monitor') {
    return {
      keywords: list(cfg.keywords),
      from_handles: list(cfg.from_handles),
      exclude_keywords: list(cfg.exclude_keywords),
      window_hours: str(cfg.window_hours ?? '24'),
      min_like: str(cfg.min_like ?? '0'),
      min_retweet: str(cfg.min_retweet ?? '0'),
      search_mode: cfg.search_mode === 'Top' ? 'Top' : 'Latest',
    };
  }
  if (kind === 'topic') {
    return {
      topic: str(cfg.topic),
      queries: list(cfg.queries),
      max_fetch: str(cfg.max_fetch ?? '50'),
      thread_extract_count: str(cfg.thread_extract_count ?? '20'),
    };
  }
  if (kind === 'digest') {
    return {
      handles: list(cfg.handles),
      window_kind: cfg.window_kind === 'weekly' ? 'weekly' : 'daily',
      per_handle_count: str(cfg.per_handle_count ?? '10'),
    };
  }
  return {
    target_kind: cfg.target_kind === 'topic' ? 'topic' : 'handle',
    target: str(cfg.target),
    sample_days: str(cfg.sample_days ?? '14'),
    top_threads_count: str(cfg.top_threads_count ?? '5'),
  };
}

interface KFProps { kind: RadarKind; fields: Record<string, string>; set: (k: string, v: string) => void; }

export function KindFields({ kind, fields, set }: KFProps): React.ReactElement {
  if (kind === 'monitor') return (
    <>
      <Field label="关键词（逗号分隔；任一匹配即命中）"><Textarea rows={2} value={fields.keywords ?? ''} onChange={(e) => set('keywords', e.target.value)} placeholder="例：AI 应用, Claude, 大模型" /></Field>
      <Field label="或：限定来自 @（逗号分隔，不带 @）"><Input value={fields.from_handles ?? ''} onChange={(e) => set('from_handles', e.target.value)} placeholder="例：OpenAI, AnthropicAI" /></Field>
      <Field label="排除词（命中即丢弃）"><Input value={fields.exclude_keywords ?? ''} onChange={(e) => set('exclude_keywords', e.target.value)} placeholder="可选，例：广告, 抽奖" /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="时间窗（小时）"><Input type="number" value={fields.window_hours ?? '24'} onChange={(e) => set('window_hours', e.target.value)} /></Field>
        <Field label="最低点赞"><Input type="number" value={fields.min_like ?? '0'} onChange={(e) => set('min_like', e.target.value)} /></Field>
        <Field label="最低转推"><Input type="number" value={fields.min_retweet ?? '0'} onChange={(e) => set('min_retweet', e.target.value)} /></Field>
      </div>
      <Field label="搜索模式">
        <Select value={fields.search_mode ?? 'Latest'} onValueChange={(v) => set('search_mode', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Latest">Latest（时间倒序）</SelectItem>
            <SelectItem value="Top">Top（相关性）</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
  if (kind === 'topic') return (
    <>
      <Field label="选题主题"><Input value={fields.topic ?? ''} onChange={(e) => set('topic', e.target.value)} placeholder="例：AI 应用层产品趋势" /></Field>
      <Field label="搜索关键词（逗号分隔，可多个）"><Textarea rows={2} value={fields.queries ?? ''} onChange={(e) => set('queries', e.target.value)} placeholder="例：AI app, Claude 应用, MCP" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="每次抓取上限"><Input type="number" value={fields.max_fetch ?? '50'} onChange={(e) => set('max_fetch', e.target.value)} /></Field>
        <Field label="thread 抽取条数"><Input type="number" value={fields.thread_extract_count ?? '20'} onChange={(e) => set('thread_extract_count', e.target.value)} /></Field>
      </div>
    </>
  );
  if (kind === 'digest') return (
    <>
      <Field label="关注的 @（逗号分隔，不带 @）"><Textarea rows={2} value={fields.handles ?? ''} onChange={(e) => set('handles', e.target.value)} placeholder="例：OpenAI, AnthropicAI, sama" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="摘要窗口">
          <Select value={fields.window_kind ?? 'daily'} onValueChange={(v) => set('window_kind', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">日报（24 小时）</SelectItem>
              <SelectItem value="weekly">周报（7 天）</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="每人最多拉几条"><Input type="number" value={fields.per_handle_count ?? '10'} onChange={(e) => set('per_handle_count', e.target.value)} /></Field>
      </div>
    </>
  );
  return (
    <>
      <Field label="目标类型">
        <Select value={fields.target_kind ?? 'handle'} onValueChange={(v) => set('target_kind', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="handle">账号（@xxx）</SelectItem>
            <SelectItem value="topic">话题 / 关键词</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="目标"><Input value={fields.target ?? ''} onChange={(e) => set('target', e.target.value)} placeholder={fields.target_kind === 'topic' ? '例：AI 应用层趋势' : '例：sama（不带 @）'} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="采样天数"><Input type="number" value={fields.sample_days ?? '14'} onChange={(e) => set('sample_days', e.target.value)} /></Field>
        <Field label="热门 thread 数"><Input type="number" value={fields.top_threads_count ?? '5'} onChange={(e) => set('top_threads_count', e.target.value)} /></Field>
      </div>
    </>
  );
}
