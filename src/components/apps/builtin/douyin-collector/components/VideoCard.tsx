'use client';

import * as React from 'react';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  Link2,
  Loader2,
  RotateCcw,
  Star,
  Tag,
  Trash2,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

import { parseVideoChapters, parseVideoTags } from '@/lib/douyin-collector/parsers';

import {
  publishVideoToLibrary,
  patchVideo,
  transcribeVideo,
  type VideoRow,
} from '../use-videos';
import { VideoCover } from './VideoCover';

const SUBTITLE_LABEL: Record<NonNullable<VideoRow['subtitle_source']>, string> = {
  none: '尚无字幕',
  native: '原生字幕',
  'asr-douyin': '抖音 ASR',
  'asr-local': 'ASR 转写',
};

const STATUS_LABEL: Record<NonNullable<VideoRow['library_status']>, string> = {
  unprocessed: '待整理',
  draft: '草稿',
  published: '已入库',
  discarded: '丢弃',
};

type Busy =
  | 'idle'
  | 'transcribe'
  | 'publish'
  | 'discard'
  | 'restore'
  | 'auto';

interface KnowledgeItemPreview {
  id: string;
  collectionId: string;
  collectionName: string;
  title: string;
  sourcePath: string | null;
  tags: string[];
  summary: string;
  content: string;
  processingStatus: string | null;
  processingError: string;
  updatedAt: string | null;
}

interface KnowledgeResponse {
  ok?: boolean;
  items?: KnowledgeItemPreview[];
  error?: string;
}

export function VideoCard({
  video,
  onChanged,
  onTagClick,
  onCreatorClick,
  highlightQuery,
}: {
  video: VideoRow;
  onChanged?: () => Promise<void> | void;
  onTagClick?: (tag: string) => void;
  onCreatorClick?: (creatorRef: string, label: string) => void;
  highlightQuery?: string;
}): React.ReactElement {
  const [busy, setBusy] = React.useState<Busy>('idle');
  const [feedback, setFeedback] = React.useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);
  const [knowledgeOpen, setKnowledgeOpen] = React.useState(false);
  const [knowledgeLoading, setKnowledgeLoading] = React.useState(false);
  const [knowledgeData, setKnowledgeData] = React.useState<KnowledgeResponse | null>(null);

  const tags = parseVideoTags(video.tags);
  const chapters = parseVideoChapters(video.chapters);
  const status = video.library_status ?? 'unprocessed';
  const transcribed = video.transcript_status === 'success';
  const librarySummary = video.library_current_summary?.trim() ?? '';
  const publishedToCurrent = status === 'published' && (video.library_published_to_current ?? true);
  const publishedElsewhere = status === 'published' && video.library_published_to_current === false;
  const needsCurrentIndexRepair =
    publishedToCurrent && video.library_current_index_ready !== true;
  const needsCurrentEnhancementRepair =
    publishedToCurrent &&
    !needsCurrentIndexRepair &&
    video.library_current_needs_enhancement === true;
  const needsCurrentLibraryRepair = needsCurrentIndexRepair || needsCurrentEnhancementRepair;
  const publishedCollectionNames = video.library_published_collection_names ?? [];
  const basePublishStatusLabel = publishedElsewhere
    ? `已入库到 ${publishedCollectionNames.length > 0 ? publishedCollectionNames.join('、') : '其它资料库'}`
    : STATUS_LABEL[status];
  const publishStatusLabel = needsCurrentIndexRepair
    ? `${basePublishStatusLabel} · 待补索引`
    : needsCurrentEnhancementRepair
      ? `${basePublishStatusLabel} · 待补概述`
      : basePublishStatusLabel;
  const publishStatusTitle = needsCurrentIndexRepair
    ? `当前知识库条目索引未完成（状态：${
        video.library_current_processing_status ?? 'unknown'
      }，chunk ${video.library_current_chunk_count ?? 0}）。点击「补资料库」或顶部「批量入库/补资料库」可重建索引。`
    : needsCurrentEnhancementRepair
      ? '当前知识库条目已能检索，但全局资料库里还缺「索引概述 / 关键要点」。点击「补资料库」或顶部批量按钮可补生成。'
    : publishedElsewhere
      ? `这条视频之前入库到了 ${publishedCollectionNames.length > 0 ? publishedCollectionNames.join('、') : '其它资料库'}；当前默认入库目标是 ${
          video.library_current_collection_name ?? '未选择'
        }。`
      : undefined;
  const subtitleLabel =
    transcribed && (video.subtitle_source ?? 'none') === 'none'
      ? '已有字幕'
      : SUBTITLE_LABEL[video.subtitle_source ?? 'none'];
  const hasPublishedKnowledge =
    status === 'published' || (video.library_published_collection_ids?.length ?? 0) > 0;

  React.useEffect(() => {
    if (!knowledgeOpen || knowledgeData) return;
    let cancelled = false;
    setKnowledgeLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/apps/builtin/douyin-collector/videos/${video.id}/knowledge`,
          { cache: 'no-store' },
        );
        const json = (await res.json().catch(() => ({}))) as KnowledgeResponse;
        if (!cancelled) {
          setKnowledgeData(res.ok ? json : { ok: false, error: json.error ?? `HTTP ${res.status}` });
        }
      } catch (err) {
        if (!cancelled) {
          setKnowledgeData({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!cancelled) setKnowledgeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [knowledgeData, knowledgeOpen, video.id]);

  async function run(action: Busy, fn: () => Promise<{ ok: boolean; error?: string; extra?: string }>) {
    if (busy !== 'idle') return;
    setBusy(action);
    setFeedback(null);
    try {
      const r = await fn();
      setFeedback({
        kind: r.ok ? 'ok' : 'error',
        text: r.ok ? r.extra ?? '完成' : r.error ?? '失败',
      });
      if (r.ok) await onChanged?.();
    } catch (e) {
      setFeedback({
        kind: 'error',
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy('idle');
    }
  }

  const douyinUrl = video.aweme_id
    ? `https://www.douyin.com/video/${video.aweme_id}`
    : null;
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(id);
  }, [copied]);
  async function copyUrl() {
    if (!douyinUrl) return;
    try {
      await navigator.clipboard.writeText(douyinUrl);
      setCopied(true);
    } catch {
      /* clipboard may be blocked in some embedded contexts */
    }
  }

  return (
    <article
      className={
        // Starred cards get an amber-tinted border so they stand out at
        // grid scale; the corner star icon alone is too subtle in a wall
        // of cards. Same accent palette as the star fill.
        video.starred
          ? 'flex flex-col gap-3 rounded-xl border border-amber-300/50 bg-card p-4 dark:border-amber-300/30'
          : 'flex flex-col gap-3 rounded-xl border border-border bg-card p-4'
      }
    >
      <div className="flex items-start gap-3">
        {douyinUrl ? (
          <a
            href={douyinUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="在抖音打开原视频"
            className="shrink-0"
          >
            <VideoCover src={video.cover} size={16} />
          </a>
        ) : (
          <VideoCover src={video.cover} size={16} />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">
            {douyinUrl ? (
              <a
                href={douyinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-foreground/70"
                title="在抖音打开原视频"
              >
                {video.title || `aweme ${video.aweme_id?.slice(0, 12) ?? ''}…`}
              </a>
            ) : (
              video.title || `aweme ${video.aweme_id?.slice(0, 12) ?? ''}…`
            )}
          </h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {video.creator_ref && onCreatorClick ? (
              <button
                type="button"
                onClick={() =>
                  onCreatorClick(
                    video.creator_ref ?? '',
                    video.creator_nickname ?? '匿名博主',
                  )
                }
                className="transition-colors hover:text-foreground"
                title="只看这位博主的视频"
              >
                {video.creator_nickname ?? '匿名博主'}
              </button>
            ) : (
              video.creator_nickname ?? '匿名博主'
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {douyinUrl ? (
            <button
              type="button"
              onClick={() => void copyUrl()}
              title={copied ? '已复制链接' : '复制原视频链接'}
              className={
                copied
                  ? 'rounded p-1 text-emerald-600 transition-colors dark:text-emerald-400'
                  : 'rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10'
              }
            >
              {copied ? <CheckCircle2 className="size-4" /> : <Link2 className="size-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() =>
              void (async () => {
                const next = !video.starred;
                await patchVideo(video.id, { starred: next });
                await onChanged?.();
              })()
            }
            title={video.starred ? '取消加星' : '加星 / 重点回看'}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/10"
          >
            <Star
              className={`size-4 ${video.starred ? 'fill-amber-400 text-amber-500' : ''}`}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Clock className="size-3" />
          {formatDuration(video.duration_seconds ?? 0)}
        </span>
        <span className="inline-flex items-center gap-1">
          <FileText className="size-3" />
          {subtitleLabel}
        </span>
        {/* Round 5: ASR cost transparency. Show only for ASR-sourced
            transcripts where we actually paid; native subtitles are free
            so the badge would be noise. */}
        {video.subtitle_source === 'asr-local' && video.transcript_charged_amount != null ? (
          <span
            className="inline-flex items-center tabular-nums text-muted-foreground"
            title={
              video.transcript_asr_duration != null
                ? `转写计费 ¥${video.transcript_charged_amount.toFixed(4)} · ASR 计 ${video.transcript_asr_duration.toFixed(1)}s`
                : `转写计费 ¥${video.transcript_charged_amount.toFixed(4)}`
            }
          >
            ¥{video.transcript_charged_amount.toFixed(4)}
          </span>
        ) : null}
        {chapters.length > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Layers className="size-3" />
            {chapters.length} 章
          </span>
        ) : null}
        <span
          title={publishStatusTitle}
          className={
            publishedToCurrent
              ? needsCurrentIndexRepair
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-emerald-600 dark:text-emerald-400'
              : publishedElsewhere
                ? 'text-amber-600 dark:text-amber-400'
              : status === 'discarded'
                ? 'line-through'
                : ''
          }
        >
          {publishStatusLabel}
        </span>
      </div>

      {video.transcript_status === 'failed' && video.failure_reason ? (
        <p
          className="line-clamp-2 rounded-md border border-rose-300/40 bg-rose-50/60 px-2 py-1.5 text-[11px] leading-relaxed text-rose-700 dark:border-rose-300/20 dark:bg-rose-950/20 dark:text-rose-300"
          title="字幕抓取失败原因。查看后可点「重抓」再试，或丢弃。"
        >
          <span className="mr-1 text-[9px] uppercase tracking-[0.18em]">字幕失败</span>
          {video.failure_reason}
        </p>
      ) : null}

      {librarySummary ? (
        <p className="line-clamp-3 text-xs text-foreground/80">{librarySummary}</p>
      ) : null}

      {video.transcript_snippet ? (
        <p className="line-clamp-2 rounded-md border border-amber-300/40 bg-amber-50/60 px-2 py-1.5 text-[11px] leading-relaxed text-foreground/80 dark:border-amber-300/20 dark:bg-amber-950/20">
          <span className="mr-1 text-[9px] uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
            字幕命中
          </span>
          {renderHighlighted(video.transcript_snippet, highlightQuery)}
        </p>
      ) : null}

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 6).map((t) =>
            onTagClick ? (
              <button
                type="button"
                key={t}
                onClick={() => onTagClick(t)}
                className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <Tag className="size-2.5" />
                {t}
              </button>
            ) : (
              <span
                key={t}
                className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                <Tag className="size-2.5" />
                {t}
              </span>
            ),
          )}
        </div>
      ) : null}

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

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <CardAction
          icon={busy === 'auto' ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
          label={
            needsCurrentLibraryRepair
              ? '补资料库'
              : publishedToCurrent
                ? '已入库 ✓'
                : publishedElsewhere
                  ? '入当前库'
                  : '一键入库'
          }
          disabled={busy !== 'idle' || (publishedToCurrent && !needsCurrentLibraryRepair)}
          onClick={() =>
            run('auto', async () => {
              // Pipeline: transcribe → publish. The knowledge pipeline
              // generates the index summary; the app displays that result.
              // Stop at first failure and surface the reason.
              if (!transcribed) {
                const t = await transcribeVideo(video.id);
                if (!t.ok) return { ok: false, error: t.error ?? '抓字幕失败' };
              }
              const p = await publishVideoToLibrary(video.id);
              if (!p.ok) return { ok: false, error: p.error ?? '入库失败' };
              return {
                ok: true,
                extra: needsCurrentLibraryRepair ? '已补资料库' : '抓字幕 → 已入库',
              };
            })
          }
        />
        <CardAction
          icon={busy === 'transcribe' ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />}
          label={transcribed ? '重抓' : '抓字幕'}
          // Round 11: when already transcribed, "重抓" must explicitly opt
          // into force=true OR it's a no-op (Round 10 idempotency gate
          // returns the cached transcript without doing any work). Without
          // the confirm + force flag, clicking "重抓" looks broken.
          // ASR isn't free — confirm before re-charging.
          title={
            transcribed
              ? '已有字幕。点这个会强制重新转写（再次走 ASR，会再扣一次费）；如果只是想看字幕，点上面的卡片即可。'
              : '尚未抓取字幕'
          }
          disabled={busy !== 'idle'}
          onClick={() => {
            if (transcribed) {
              const sourceLabel = video.subtitle_source === 'asr-local' ? '云端 ASR' : '原生字幕';
              const lastCost = video.transcript_charged_amount;
              const costNote = lastCost != null ? `（上次计费 ¥${lastCost.toFixed(4)}）` : '';
              const ok = window.confirm(
                `这条视频已有字幕（来源：${sourceLabel}${costNote}）。强制重转会再走一次 ASR 并产生新的费用。继续吗？`,
              );
              if (!ok) return;
            }
            void run('transcribe', async () => {
              const r = await transcribeVideo(video.id, { force: transcribed });
              return {
                ok: r.ok,
                error: r.error,
                extra: r.ok ? `已抓取 ${r.segmentCount ?? 0} 段` : undefined,
              };
            });
          }}
        />
        <CardAction
          icon={busy === 'publish' ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
          label={
            needsCurrentLibraryRepair
              ? '补资料库'
              : publishedToCurrent
                ? '更新入库'
                : publishedElsewhere
                  ? '入当前知识库'
                  : '入知识库'
          }
          disabled={busy !== 'idle' || !transcribed}
          onClick={() =>
            run('publish', async () => {
              const r = await publishVideoToLibrary(video.id);
              return {
                ok: r.ok,
                error: r.error,
                extra: r.ok ? (needsCurrentLibraryRepair ? '已补资料库' : '已入库') : undefined,
              };
            })
          }
        />
        {hasPublishedKnowledge ? (
          <CardAction
            icon={<BookOpen className="size-3" />}
            label="查看入库内容"
            disabled={busy !== 'idle'}
            onClick={() => setKnowledgeOpen(true)}
          />
        ) : null}
        {status !== 'discarded' ? (
          <CardAction
            icon={
              busy === 'discard' ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />
            }
            label="丢弃"
            ghost
            disabled={busy !== 'idle'}
            onClick={() =>
              run('discard', async () => {
                await patchVideo(video.id, { library_status: 'discarded' });
                return { ok: true, extra: '已丢弃' };
              })
            }
          />
        ) : (
          // Discarded videos need a path back: restoring sets status to
          // unprocessed. The user's transcript / summary / tags / notes /
          // starred all stay (we never deleted them on discard).
          <CardAction
            icon={
              busy === 'restore' ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />
            }
            label="恢复"
            ghost
            disabled={busy !== 'idle'}
            onClick={() =>
              run('restore', async () => {
                await patchVideo(video.id, { library_status: 'unprocessed' });
                return { ok: true, extra: '已恢复到「待整理」' };
              })
            }
          />
        )}
      </div>
      <KnowledgeContentDialog
        open={knowledgeOpen}
        onOpenChange={setKnowledgeOpen}
        loading={knowledgeLoading}
        data={knowledgeData}
      />
    </article>
  );
}

function KnowledgeContentDialog({
  open,
  onOpenChange,
  loading,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  data: KnowledgeResponse | null;
}): React.ReactElement {
  const items = data?.items ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] gap-3 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>入库内容</DialogTitle>
          <DialogDescription>
            这里展示抖音采集器写入知识库的正文，不需要再切到资料库页面查找。
          </DialogDescription>
        </DialogHeader>
        <div className="px-5 pb-5">
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载入库内容…
            </div>
          ) : data?.ok === false ? (
            <p className="rounded-md border border-rose-300/40 bg-rose-50/60 px-3 py-2 text-sm text-rose-700 dark:border-rose-300/20 dark:bg-rose-950/20 dark:text-rose-300">
              {data.error ?? '读取入库内容失败'}
            </p>
          ) : items.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              没有找到对应的知识库条目。可能是旧入库链接残留，或条目已在知识库中删除。
            </p>
          ) : (
            <div className="space-y-4">
              {items.map((item) => (
                <KnowledgeItemBlock key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KnowledgeItemBlock({ item }: { item: KnowledgeItemPreview }): React.ReactElement {
  const updated = item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '';
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5">{item.collectionName}</span>
          {item.processingStatus ? <span>{item.processingStatus}</span> : null}
          {updated ? <span>{updated}</span> : null}
        </div>
        <h3 className="mt-1 line-clamp-2 text-sm font-semibold tracking-tight">{item.title}</h3>
        {item.sourcePath ? (
          <a
            href={item.sourcePath}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block truncate text-[11px] text-muted-foreground hover:text-foreground"
          >
            {item.sourcePath}
          </a>
        ) : null}
        {item.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.slice(0, 12).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {item.processingError ? (
        <p className="mx-3 mt-2 rounded-md border border-amber-300/40 bg-amber-50/60 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-300/20 dark:bg-amber-950/20 dark:text-amber-300">
          {item.processingError}
        </p>
      ) : null}
      <ScrollArea className="h-[54vh] px-3 py-3">
        <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground/85">
          {item.content || item.summary || '这条知识库记录没有正文。'}
        </pre>
      </ScrollArea>
    </section>
  );
}

function CardAction({
  icon,
  label,
  onClick,
  disabled,
  ghost,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  ghost?: boolean;
  title?: string;
}): React.ReactElement {
  return (
    <Button
      size="sm"
      variant={ghost ? 'ghost' : 'outline'}
      className="h-7 px-2 text-xs"
      disabled={disabled}
      onClick={onClick}
      title={title}
    >
      {icon}
      {label}
    </Button>
  );
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}m ${s.toString().padStart(2, '0')}s`;
}

/**
 * Render a snippet with case-insensitive highlights of `query`. Pure
 * helper — no DOM, just React fragments. Returns plain text if no query
 * or no match. Mirrors the substring semantics the server used to find
 * the snippet so what's bolded matches what was searched.
 */
function renderHighlighted(text: string, query?: string): React.ReactNode {
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
