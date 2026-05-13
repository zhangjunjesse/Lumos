'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight, Play, Plus, Trash2, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { useCollectSources } from '../../use-collect-sources';
import type { useJobs } from '../../use-jobs';
import type {
  CreatorCadence,
  KeywordTimeWindow,
} from '@/lib/douyin-collector/types';
import { CADENCE_LABELS } from './CreatorSection';
import { QualityPill } from '../../components/QualityPill';

const TIME_WINDOW_LABELS: Record<KeywordTimeWindow, string> = {
  day: '当天',
  week: '一周内',
  month: '一月内',
  all: '全部',
};

export function KeywordSection({
  sources,
  jobs,
  onTagClick,
}: {
  sources: ReturnType<typeof useCollectSources>;
  jobs: ReturnType<typeof useJobs>;
  onTagClick?: (tag: string) => void;
}): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [timeWindow, setTimeWindow] = React.useState<KeywordTimeWindow>('week');
  const [cadence, setCadence] = React.useState<CreatorCadence>('daily');
  const [adding, setAdding] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);

  // Round 169/181: keyword auto-patrol works through the embedded
  // BrowserManager. Douyin now routes keyword discovery through
  // /search/<q>?aid=<uuid>&type=general for both single-word and
  // multi-word queries.
  // Both still need a logged-in douyin cookie (set in Settings → Cookie)
  // to bypass the anonymous SEO-bait page; without cookie the patrol
  // fails honestly with a "set cookie first" pointer.

  async function onAdd() {
    setAddError(null);
    setAdding(true);
    try {
      await sources.addKeyword({
        query: query.trim(),
        time_window: timeWindow,
        cadence,
      });
      setQuery('');
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold tracking-tight">关键词订阅</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        主题调研：关键词会打开抖音搜索页（/search/关键词?type=general）并通过内置浏览器抓取。
        <strong className="font-semibold text-foreground/90">前提是「设置 → Cookie」配置好登录态</strong>
        ；否则 douyin 只渲染匿名 SEO 页，feed 拿不到。
        手动 ingest URL 仍可用作单条精读补充（展开订阅行查看）。
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_140px_auto]">
        <Input
          placeholder="输入关键词，如 AI / DeepSeek v4；# 前缀会自动剥掉"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select value={timeWindow} onValueChange={(v) => setTimeWindow(v as KeywordTimeWindow)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TIME_WINDOW_LABELS) as KeywordTimeWindow[]).map((w) => (
              <SelectItem key={w} value={w}>
                {TIME_WINDOW_LABELS[w]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={cadence}
          onValueChange={(v) => setCadence(v as CreatorCadence)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CADENCE_LABELS) as CreatorCadence[]).map((c) => (
              <SelectItem key={c} value={c}>
                {CADENCE_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={onAdd} disabled={adding || !query.trim()}>
          <Plus className="size-3.5" />
          添加
        </Button>
      </div>
      {query.trim() ? (
        <p className="mt-2 text-xs text-muted-foreground">
          当前会打开 douyin 搜索页：/search/{query.trim()}?aid=自动生成&type=general。
        </p>
      ) : null}
      {addError ? <p className="mt-2 text-xs text-rose-500">{addError}</p> : null}

      <div className="mt-4 divide-y divide-border">
        {sources.keywords.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            还没有关键词订阅。从一个具体的单词或短语开始（如 prompt-caching / DeepSeek v4），
            点「立即采集」让内置浏览器打开抖音搜索页拉视频。
          </p>
        ) : (
          sources.keywords.map((k) => (
            <KeywordRow
              key={k.id}
              keyword={k}
              sources={sources}
              jobs={jobs}
              onTagClick={onTagClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

function KeywordRow({
  keyword: k,
  sources,
  jobs,
  onTagClick,
}: {
  keyword: ReturnType<typeof useCollectSources>['keywords'][number];
  sources: ReturnType<typeof useCollectSources>;
  jobs: ReturnType<typeof useJobs>;
  onTagClick?: (tag: string) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  async function ingest() {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await sources.ingestKeywordUrls(k.id, text);
      setFeedback({
        kind: r.ok || (r.processed ?? 0) > 0 ? 'ok' : 'error',
        text:
          r.message ??
          (r.ok
            ? `已 ingest ${r.succeeded ?? 0}`
            : '失败：未识别任何链接。'),
      });
      if (r.ok) setText('');
    } catch (e) {
      setFeedback({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const stats = sources.keywordStats[k.query.toLowerCase()];
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {onTagClick ? (
              <button
                type="button"
                onClick={() => onTagClick(k.query)}
                className="transition-colors hover:text-foreground/70"
                title={`点击：在资料库筛选「${k.query}」标签`}
              >
                {k.query}
              </button>
            ) : (
              k.query
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              {TIME_WINDOW_LABELS[k.time_window]} · 去重 {k.dedupe_window_days} 天 ·{' '}
              {CADENCE_LABELS[k.cadence]}
            </span>
            {stats ? (
              <span>
                · 已采集 {stats.collected} · 已转写 {stats.transcribed} · 已入库{' '}
                {stats.published}
              </span>
            ) : null}
            {stats ? <QualityPill stats={stats} /> : null}
            {k.last_checked_at ? (
              <span>· 上次 {new Date(k.last_checked_at).toLocaleString('zh-CN')}</span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            手动 ingest
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void jobs.enqueue({ kind: 'keyword', targetRef: k.id })}
          >
            <Play className="size-3.5" />
            立即采集
          </Button>
          <Switch
            checked={k.enabled}
            onCheckedChange={(v) => void sources.toggleKeyword(k.id, v)}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => void sources.deleteKeyword(k.id)}
            aria-label="删除"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            「{k.query}」会走抖音搜索页自动抓取（点行右侧「立即采集」即可）。这里也支持手动
            ingest URL：粘到下面，应用会 scrape 元数据 + 自动打上「{k.query}」标签。
          </p>
          <Textarea
            rows={4}
            placeholder="一行一个 douyin 视频 URL 或 v.douyin.com 短链"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {feedback ? (
            <p
              className={
                feedback.kind === 'ok'
                  ? 'text-xs text-emerald-600 dark:text-emerald-400'
                  : 'text-xs text-rose-500'
              }
            >
              {feedback.text}
            </p>
          ) : null}
          <Button size="sm" disabled={busy || !text.trim()} onClick={() => void ingest()}>
            <Upload className="size-3.5" />
            {busy ? 'Ingesting…' : 'Ingest'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
