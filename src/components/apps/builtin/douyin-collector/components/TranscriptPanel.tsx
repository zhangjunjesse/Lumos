'use client';

import * as React from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Copy, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface TranscriptResponse {
  ok: boolean;
  transcript?: {
    id: string;
    source: string | null;
    lang: string | null;
    wordCount: number;
    segments: Array<{ startSec: number; endSec: number; text: string }>;
    updatedAt: string | null;
  };
  error?: string;
}

export function TranscriptPanel({
  videoId,
  chapters,
}: {
  videoId: string;
  chapters: Array<{ startSec: number; title: string }>;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<TranscriptResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [panelQuery, setPanelQuery] = React.useState('');

  React.useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/apps/builtin/douyin-collector/videos/${videoId}/transcript`,
          { cache: 'no-store' },
        );
        const json = (await res.json()) as TranscriptResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setData({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, data, videoId]);

  const segments = data?.transcript?.segments ?? [];
  const fullText = segments.map((s) => s.text).join('\n');
  const transcriptLabel = getTranscriptLabel(data?.transcript?.source);

  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);
  async function copyAll() {
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs"
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span>{transcriptLabel}</span>
          {data?.transcript ? (
            <span className="text-muted-foreground">
              · {data.transcript.source} · {data.transcript.wordCount} 字
            </span>
          ) : null}
        </span>
        {open && fullText ? (
          <Button
            size="sm"
            variant="ghost"
            className={
              copied
                ? 'h-6 px-2 text-[10px] text-emerald-600 dark:text-emerald-400'
                : 'h-6 px-2 text-[10px]'
            }
            onClick={(e) => {
              e.stopPropagation();
              void copyAll();
            }}
          >
            {copied ? <CheckCircle2 className="size-3" /> : <Copy className="size-3" />}
            {copied ? '已复制' : '复制全文'}
          </Button>
        ) : null}
      </button>

      {open ? (
        <div className="border-t border-border px-3 py-2">
          {loading ? (
            <p className="text-xs text-muted-foreground">加载中…</p>
          ) : data?.ok && data.transcript ? (
            <>
              {segments.length > 8 ? (
                <PanelSearchBar query={panelQuery} onChange={setPanelQuery} />
              ) : null}
              <SegmentList
                segments={segments}
                chapters={chapters}
                query={panelQuery}
              />
              {data.transcript.source === 'asr-local' ? (
                <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                  这是 Lumos 云端 ASR 从视频音轨转写的文本，不是抖音原生字幕；时间点为按视频时长估算，可能存在漏字、错字或片尾水印。
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-rose-500">
              {data?.error ?? '没有 transcript。先点「抓字幕」试试。'}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function getTranscriptLabel(source: string | null | undefined): string {
  switch (source) {
    case 'native':
      return '原生字幕原文';
    case 'asr-douyin':
      return '抖音 ASR 字幕';
    case 'asr-local':
      return 'ASR 转写文本';
    default:
      return '字幕 / 转写文本';
  }
}

function PanelSearchBar({
  query,
  onChange,
}: {
  query: string;
  onChange: (next: string) => void;
}): React.ReactElement {
  return (
    <div className="relative mb-2">
      <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="在字幕内查找…（仅过滤当前视频）"
        className="h-7 pl-7 pr-7 text-[11px]"
      />
      {query ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清空搜索"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-foreground/10"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

function SegmentList({
  segments,
  chapters,
  query = '',
}: {
  segments: Array<{ startSec: number; endSec: number; text: string }>;
  chapters: Array<{ startSec: number; title: string }>;
  query?: string;
}): React.ReactElement {
  const q = query.trim();
  const ql = q.toLowerCase();
  const filterActive = q.length >= 2;
  const filtered = filterActive
    ? segments.filter((s) => s.text.toLowerCase().includes(ql))
    : segments;

  // Group segments under their chapter (if any). Chapters are sorted by
  // startSec; each segment goes under the latest chapter whose start <= seg.start.
  const chapterStarts = chapters.map((c) => c.startSec).sort((a, b) => a - b);
  const groups = new Map<number, typeof segments>();
  for (const seg of filtered) {
    const chapterStart = pickChapterStart(seg.startSec, chapterStarts);
    const list = groups.get(chapterStart) ?? [];
    list.push(seg);
    groups.set(chapterStart, list);
  }

  if (filterActive && filtered.length === 0) {
    return (
      <p className="py-2 text-[11px] text-muted-foreground">
        没有命中「{q}」的段落。
      </p>
    );
  }

  if (chapters.length === 0) {
    return (
      <ul className="max-h-72 space-y-1 overflow-y-auto text-[11px] leading-snug text-foreground/80">
        {filtered.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatTime(s.startSec)}
            </span>
            <span className="min-w-0">{renderHighlighted(s.text, q)}</span>
          </li>
        ))}
      </ul>
    );
  }

  // When filtered, chapters with no surviving segments are dropped — keeps
  // the list dense and avoids dangling section headers.
  const visibleChapters = filterActive
    ? chapters.filter((c) => (groups.get(c.startSec)?.length ?? 0) > 0)
    : chapters;

  return (
    <div className="max-h-72 space-y-3 overflow-y-auto">
      {visibleChapters.map((c) => (
        <section key={c.startSec}>
          <h4 className="text-xs font-semibold tracking-tight">
            <span className="mr-1.5 tabular-nums text-muted-foreground">
              {formatTime(c.startSec)}
            </span>
            {c.title}
          </h4>
          <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-foreground/80">
            {(groups.get(c.startSec) ?? []).map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatTime(s.startSec)}
                </span>
                <span className="min-w-0">{renderHighlighted(s.text, q)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Pure: render `text` with case-insensitive `<mark>`-wrapped highlights
 * of `query`. No-op (returns plain string) when query is too short.
 * Kept inline in this file because it's tiny and the equivalent helper
 * in VideoCard.tsx isn't exported — duplicating one short function is
 * cleaner than introducing a barrel.
 */
function renderHighlighted(text: string, query: string): React.ReactNode {
  if (!query || query.trim().length < 2) return text;
  const q = query.trim();
  const ql = q.toLowerCase();
  const tl = text.toLowerCase();
  const out: React.ReactNode[] = [];
  let cursor = 0;
  let idx = tl.indexOf(ql);
  let key = 0;
  while (idx >= 0) {
    if (idx > cursor) out.push(text.slice(cursor, idx));
    out.push(
      <mark
        key={key++}
        className="rounded bg-amber-200/80 px-0.5 text-foreground dark:bg-amber-400/30"
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
    idx = tl.indexOf(ql, cursor);
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function pickChapterStart(segStart: number, chapterStarts: number[]): number {
  let last = chapterStarts[0] ?? 0;
  for (const start of chapterStarts) {
    if (start <= segStart) last = start;
    else break;
  }
  return last;
}

function formatTime(sec: number): string {
  if (sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
