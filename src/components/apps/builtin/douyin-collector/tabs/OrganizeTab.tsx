'use client';

import * as React from 'react';
import {
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCcw,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';

import {
  publishVideoToLibrary,
  patchVideo,
  transcribeVideo,
  useVideos,
  type VideoRow,
} from '../use-videos';
import { TranscriptPanel } from '../components/TranscriptPanel';
import { VideoCover } from '../components/VideoCover';
import { RelatedVideos } from '../components/RelatedVideos';
import { useTopTags } from '../use-top-tags';
import { useLibraryBacklog } from '../use-library-backlog';
import { parseVideoChapters, parseVideoTags } from '@/lib/douyin-collector/parsers';
import { appendTag } from '@/lib/douyin-collector/tag-helpers';
import { computeCurationCompleteness } from '@/lib/douyin-collector/curation';

const ORGANIZE_PAGE_SIZE = 20;

export function OrganizeTab(): React.ReactElement {
  const [scope, setScope] = React.useState<'unprocessed' | 'draft'>('unprocessed');
  const [tagsRefreshTick, setTagsRefreshTick] = React.useState(0);
  const [displayLimit, setDisplayLimit] = React.useState(ORGANIZE_PAGE_SIZE);
  const { videos, loading, error, refresh: refreshVideos } = useVideos(scope);
  // Cross-scope counts so the toggle buttons show how much waits in the
  // OTHER bucket (not just current). Round 108 already returns these.
  const { statusCounts } = useLibraryBacklog(tagsRefreshTick);
  // Reset display window when scope flips — user expects to see fresh
  // top-of-list, not "row 21+" of the new scope.
  React.useEffect(() => {
    setDisplayLimit(ORGANIZE_PAGE_SIZE);
  }, [scope]);
  // Lift the top-tags hook to the tab level so all rows share one fetch.
  // Bumping the tick re-pulls after a row saves new tags.
  const { tags: topTags } = useTopTags(tagsRefreshTick, 30);
  const refresh = React.useCallback(async () => {
    await refreshVideos();
    setTagsRefreshTick((n) => n + 1);
  }, [refreshVideos]);

  // Aggregate curation rollup for the subtitle line — gives the user a
  // "X / N 已完整" sense before scanning row-by-row.
  const fullyCurated = videos.filter(
    (v) =>
      computeCurationCompleteness({
        transcript_status: v.transcript_status,
        tags: v.tags ?? '',
        notes: v.notes ?? '',
      }).score === 3,
  ).length;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">整理</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            逐条编辑标签 / 备注 / 状态；确认后入知识库。摘要由入库后的资料库索引生成。
            {videos.length > 0
              ? ` · 完整 ${fullyCurated} / ${videos.length}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={scope === 'unprocessed' ? 'default' : 'ghost'}
            onClick={() => setScope('unprocessed')}
            className="gap-1.5"
          >
            <span>待整理</span>
            {statusCounts.unprocessed > 0 ? (
              <span
                className={
                  scope === 'unprocessed'
                    ? 'rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums'
                    : 'rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground'
                }
              >
                {statusCounts.unprocessed}
              </span>
            ) : null}
          </Button>
          <Button
            size="sm"
            variant={scope === 'draft' ? 'default' : 'ghost'}
            onClick={() => setScope('draft')}
            className="gap-1.5"
          >
            <span>草稿</span>
            {statusCounts.drafts > 0 ? (
              <span
                className={
                  scope === 'draft'
                    ? 'rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-medium tabular-nums'
                    : 'rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground'
                }
              >
                {statusCounts.drafts}
              </span>
            ) : null}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCcw className="size-3.5" />
            刷新
          </Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {videos.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <p className="text-sm font-medium">没有需要整理的视频</p>
          <p className="max-w-md text-xs text-muted-foreground">
            采集任务跑完后，新增视频默认是「待整理」。这里是你打标签 / 写备注 / 决定入库的工作区。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {videos.slice(0, displayLimit).map((v) => (
            <OrganizeRow
              key={v.id}
              initial={v}
              onChanged={refresh}
              suggestedTags={topTags.map((t) => t.tag)}
            />
          ))}
          {videos.length > displayLimit ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <p className="text-[11px] text-muted-foreground">
                已显示 {displayLimit} / {videos.length} 条
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDisplayLimit((n) => Math.min(n + ORGANIZE_PAGE_SIZE, videos.length))
                }
              >
                加载更多 (+{Math.min(ORGANIZE_PAGE_SIZE, videos.length - displayLimit)})
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function OrganizeRow({
  initial,
  onChanged,
  suggestedTags = [],
}: {
  initial: VideoRow;
  onChanged: () => Promise<void> | void;
  suggestedTags?: string[];
}): React.ReactElement {
  const [tags, setTags] = React.useState(parseVideoTags(initial.tags).join(', '));
  const [notes, setNotes] = React.useState(initial.notes ?? '');
  const [saving, setSaving] = React.useState<
    'idle' | 'saving' | 'publishing' | 'discarding' | 'transcribing'
  >('idle');
  const [err, setErr] = React.useState<string | null>(null);
  const [transcriptResult, setTranscriptResult] = React.useState<string | null>(null);

  async function persist(extra: Partial<VideoRow> = {}) {
    setSaving('saving');
    setErr(null);
    try {
      await patchVideo(initial.id, {
        tags: JSON.stringify(parseVideoTags(tags)),
        notes: notes.trim() || null,
        ...extra,
      });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving('idle');
    }
  }

  async function publish() {
    setSaving('publishing');
    setErr(null);
    setTranscriptResult(null);
    try {
      // First, persist the latest tags/notes edits.
      await patchVideo(initial.id, {
        tags: JSON.stringify(parseVideoTags(tags)),
        notes: notes.trim() || null,
      });
      // Then push to knowledge — backend writes kb_items + library_links and
      // updates library_status='published'. We don't set library_status
      // optimistically here so failure stays visible.
      const r = await publishVideoToLibrary(initial.id);
      if (!r.ok) {
        setErr(r.error ?? '入库失败');
        return;
      }
      setTranscriptResult(`已入知识库（item ${r.itemId?.slice(0, 8)}…）`);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving('idle');
    }
  }

  async function discard() {
    setSaving('discarding');
    setErr(null);
    try {
      await patchVideo(initial.id, { library_status: 'discarded' });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving('idle');
    }
  }

  async function transcribe() {
    setSaving('transcribing');
    setErr(null);
    setTranscriptResult(null);
    try {
      const r = await transcribeVideo(initial.id);
      if (r.ok) {
        setTranscriptResult(`已抓取 ${r.segmentCount ?? 0} 段（${r.sourceFormat ?? 'native'}）`);
      } else {
        setErr(r.error ?? '抓字幕失败');
      }
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving('idle');
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        {initial.aweme_id ? (
          <a
            href={`https://www.douyin.com/video/${initial.aweme_id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="在抖音打开原视频"
            className="shrink-0"
          >
            <VideoCover src={initial.cover} size={20} />
          </a>
        ) : (
          <VideoCover src={initial.cover} size={20} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-semibold">
              {initial.aweme_id ? (
                <a
                  href={`https://www.douyin.com/video/${initial.aweme_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="transition-colors hover:text-foreground/70"
                  title="在抖音打开原视频"
                >
                  {initial.title || `aweme ${initial.aweme_id?.slice(0, 12) ?? ''}…`}
                </a>
              ) : (
                initial.title || `aweme ${initial.aweme_id?.slice(0, 12) ?? ''}…`
              )}
            </h3>
            <CurationBadge
              video={{
                transcript_status: initial.transcript_status,
                tags,
                notes,
              }}
            />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {initial.creator_nickname ?? '匿名博主'} · {initial.duration_bucket ?? '—'}
            {initial.subtitle_source && initial.subtitle_source !== 'none'
              ? ` · 字幕：${initial.subtitle_source}`
              : ' · 尚无字幕'}
          </p>
        </div>
      </div>

      {initial.library_current_summary ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
            资料库概述
          </p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
            {initial.library_current_summary}
          </p>
        </div>
      ) : null}

      <div>
        <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">标签</p>
        <Input
          placeholder="逗号分隔；建议 3–8 个具体标签"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <TagSuggestionStrip
          suggestedTags={suggestedTags}
          currentTags={tags}
          onAdd={(t) => setTags(appendTag(tags, t))}
        />
      </div>

      <div>
        <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
          我的备注
        </p>
        <Textarea
          rows={3}
          placeholder="自己的看完想法、和别的视频的关联、要回顾的疑问。"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <TranscriptPanel videoId={initial.id} chapters={parseVideoChapters(initial.chapters)} />
      <RelatedVideos videoId={initial.id} />

      {err ? <p className="text-xs text-rose-500">{err}</p> : null}
      {transcriptResult ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{transcriptResult}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={saving !== 'idle'}
          onClick={() => void transcribe()}
        >
          {saving === 'transcribing' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileText className="size-3.5" />
          )}
          {initial.transcript_status === 'success' ? '重抓字幕' : '抓字幕'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={saving !== 'idle'}
          onClick={() => void persist()}
        >
          保存草稿
        </Button>
        <Button
          size="sm"
          disabled={saving !== 'idle'}
          onClick={() => void publish()}
        >
          <CheckCircle2 className="size-3.5" />
          {saving === 'publishing' ? '入库中…' : '入知识库'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={saving !== 'idle'}
          onClick={() => void discard()}
        >
          <Trash2 className="size-3.5" />
          丢弃
        </Button>
      </div>
    </article>
  );
}

/**
 * "完整度 X/3" pill — drives the user toward filling字幕 /
 * 标签 / 备注 for a given video. Color codes:
 *   - 3/3  → emerald (fully curated)
 *   - 2/3 → amber (in progress)
 *   - 0-1/3 → muted gray (just collected, no work yet)
 *
 * Computed from the LIVE in-edit values (summary/tags/notes state)
 * rather than the persisted row, so the badge updates immediately as
 * the user types — provides "you're getting closer" feedback.
 */
function CurationBadge({
  video,
}: {
  video: { transcript_status?: string; tags: string; notes: string };
}): React.ReactElement {
  const r = computeCurationCompleteness(video);
  const tone =
    r.score === r.total
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
      : r.score >= 2
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-muted text-muted-foreground';
  const tail = r.missing.length > 0 ? ` · 缺 ${r.missing.join(' / ')}` : '';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums ${tone}`}
      title={
        r.score === r.total
          ? '字幕 / 标签 / 备注 都已填写。可入库。'
          : `还差：${r.missing.join(' / ')}`
      }
    >
      完整度 {r.score}/{r.total}
      {tail}
    </span>
  );
}

/**
 * Click-to-add suggestion strip below the tags input. Already-included
 * tags render greyed out (still visible — keeps spatial position stable
 * so users don't lose their place when they add a tag).
 */
function TagSuggestionStrip({
  suggestedTags,
  currentTags,
  onAdd,
}: {
  suggestedTags: string[];
  currentTags: string;
  onAdd: (tag: string) => void;
}): React.ReactElement | null {
  if (suggestedTags.length === 0) return null;
  const includedSet = new Set(parseVideoTags(currentTags).map((t) => t.toLowerCase()));
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        推荐
      </span>
      {suggestedTags.map((t) => {
        const included = includedSet.has(t.toLowerCase());
        return (
          <button
            key={t}
            type="button"
            disabled={included}
            onClick={() => onAdd(t)}
            className={
              included
                ? 'rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground/40 line-through'
                : 'rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground'
            }
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
