import { COLLECTION_TRANSCRIPTS, COLLECTION_VIDEOS } from './constants';
import {
  parseTranscriptText,
  parseVideoChapters,
  parseVideoTags,
} from './parsers';
import { getDouyinCollectorStore } from './storage';

export interface ExportedVideo {
  awemeId: string | null;
  title: string | null;
  creator: string | null;
  durationSeconds: number;
  durationBucket: string | null;
  subtitleSource: string | null;
  libraryStatus: string | null;
  updatedAt: string | null;
  url: string | null;
  summary: string | null;
  tags: string[];
  chapters: Array<{ startSec: number; title: string }>;
  transcript: string | null;
}

interface VideoRecord {
  id: string;
  aweme_id?: string;
  title?: string | null;
  creator_nickname?: string | null;
  duration_seconds?: number;
  duration_bucket?: string;
  subtitle_source?: string;
  summary?: string | null;
  tags?: string | null;
  chapters?: string | null;
  library_status?: string;
  updated_at?: string;
}

interface TranscriptRow {
  video_ref?: string;
  segments?: string;
  source?: string;
}

export interface ExportOptions {
  scope: 'all' | 'published' | 'draft';
  includeTranscript: boolean;
  /**
   * Round 178: optional id whitelist. When set, only videos with ids
   * in this set are considered (in addition to the scope filter).
   * LibraryTab passes the currently-visible row ids when the user
   * has any filter active so the export matches "what I see".
   */
  ids?: string[];
}

function applyIdFilter<T extends { id: string }>(rows: T[], ids?: string[]): T[] {
  if (!ids || ids.length === 0) return rows;
  const set = new Set(ids);
  return rows.filter((r) => set.has(r.id));
}

/**
 * Render selected videos as a single Markdown document. Each video gets a
 * heading, metadata block, AI summary, tags, optional chapters and full
 * transcript. Designed to paste straight into Notion / Obsidian.
 *
 * Honest contract: only includes what's actually in the database. Videos
 * without a transcript are still exported (with a note) — never invents
 * content.
 */
export function exportLibraryAsMarkdown(opts: ExportOptions): string {
  const store = getDouyinCollectorStore();
  let videos = store.query<VideoRecord>(COLLECTION_VIDEOS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 5000,
  });
  if (opts.scope === 'published') {
    videos = videos.filter((v) => v.library_status === 'published');
  } else if (opts.scope === 'draft') {
    videos = videos.filter(
      (v) => v.library_status === 'draft' || v.library_status === 'unprocessed',
    );
  } else {
    videos = videos.filter((v) => v.library_status !== 'discarded');
  }
  videos = applyIdFilter(videos, opts.ids);

  if (videos.length === 0) {
    return '# 抖音采集器导出\n\n（没有匹配的视频。）\n';
  }

  // Pre-fetch transcripts in one batch instead of N+1 queries.
  const transcripts = opts.includeTranscript
    ? store.query<TranscriptRow>(COLLECTION_TRANSCRIPTS, { limit: 5000 })
    : [];
  const transcriptByVideo = new Map<string, TranscriptRow>();
  for (const t of transcripts) {
    if (t.video_ref) transcriptByVideo.set(t.video_ref, t);
  }

  const sections: string[] = [];
  sections.push(
    `# 抖音采集器导出\n`,
    `> 共 ${videos.length} 条视频 · 范围：${scopeLabel(opts.scope)} · 生成于 ${new Date().toLocaleString('zh-CN')}\n`,
    '',
  );

  for (const v of videos) {
    sections.push(renderVideo(v, transcriptByVideo.get(v.id), opts.includeTranscript));
    sections.push('---\n');
  }

  return sections.join('\n');
}

/**
 * Render selected videos as a structured JSON array. Same scope filter as
 * the markdown export. Designed for programmatic backup / migration to
 * other tools (Anki / personal scripts / another vault).
 */
export function exportLibraryAsJson(opts: ExportOptions): ExportedVideo[] {
  const store = getDouyinCollectorStore();
  let videos = store.query<VideoRecord>(COLLECTION_VIDEOS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 5000,
  });
  if (opts.scope === 'published') {
    videos = videos.filter((v) => v.library_status === 'published');
  } else if (opts.scope === 'draft') {
    videos = videos.filter(
      (v) => v.library_status === 'draft' || v.library_status === 'unprocessed',
    );
  } else {
    videos = videos.filter((v) => v.library_status !== 'discarded');
  }
  videos = applyIdFilter(videos, opts.ids);
  if (videos.length === 0) return [];

  const transcripts = opts.includeTranscript
    ? store.query<TranscriptRow>(COLLECTION_TRANSCRIPTS, { limit: 5000 })
    : [];
  const transcriptByVideo = new Map<string, TranscriptRow>();
  for (const t of transcripts) {
    if (t.video_ref) transcriptByVideo.set(t.video_ref, t);
  }

  return videos.map((v) => ({
    awemeId: v.aweme_id ?? null,
    title: v.title ?? null,
    creator: v.creator_nickname ?? null,
    durationSeconds: v.duration_seconds ?? 0,
    durationBucket: v.duration_bucket ?? null,
    subtitleSource: v.subtitle_source ?? null,
    libraryStatus: v.library_status ?? null,
    updatedAt: v.updated_at ?? null,
    url: v.aweme_id ? `https://www.douyin.com/video/${v.aweme_id}` : null,
    summary: v.summary?.trim() || null,
    tags: parseVideoTags(v.tags),
    chapters: parseVideoChapters(v.chapters),
    transcript: opts.includeTranscript
      ? parseTranscriptText(transcriptByVideo.get(v.id)?.segments) || null
      : null,
  }));
}

/**
 * Render selected videos as Anki-importable TSV: `front\tback\ttags`.
 *
 * - **front**: video title (the "question" — what was this video about?)
 * - **back**: AI summary + chapter list (the "answer" — what to recall)
 * - **tags**: space-joined sanitized tags (Anki's tag syntax)
 *
 * Honest contract:
 *   - Videos without a summary are skipped — Anki cards need both sides
 *     to be useful; an empty back is just visual noise. The header row
 *     still exists so import won't break on a 0-card export.
 *   - Newlines in summary / titles are HTML-escaped to `<br>` so Anki
 *     renders them; tabs in field text are replaced with spaces to keep
 *     TSV parseable.
 *   - Tags get whitespace stripped (Anki separates tags by space).
 *
 * Schema reference: Anki imports plain TSV by default with 3 columns
 * mapped to Front / Back / Tags via the import dialog.
 */
export function exportLibraryAsAnki(opts: ExportOptions): string {
  const store = getDouyinCollectorStore();
  let videos = store.query<VideoRecord>(COLLECTION_VIDEOS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 5000,
  });
  if (opts.scope === 'published') {
    videos = videos.filter((v) => v.library_status === 'published');
  } else if (opts.scope === 'draft') {
    videos = videos.filter(
      (v) => v.library_status === 'draft' || v.library_status === 'unprocessed',
    );
  } else {
    videos = videos.filter((v) => v.library_status !== 'discarded');
  }
  videos = applyIdFilter(videos, opts.ids);
  // Anki cards are useless without a back. Filter early.
  videos = videos.filter((v) => v.summary?.trim());

  const lines: string[] = [];
  // Header — Anki ignores it when "first row is field names" is unchecked
  // but it's a good self-documenting marker for re-import / human review.
  lines.push('#separator:tab');
  lines.push('#html:true');
  lines.push('#columns:Front\tBack\tTags');

  for (const v of videos) {
    const title = (v.title?.trim() || `aweme ${v.aweme_id ?? ''}`).trim();
    const chapters = parseVideoChapters(v.chapters);
    const back = renderAnkiBack(v.summary ?? '', chapters, v.aweme_id);
    const tagText = parseVideoTags(v.tags)
      .map((t) => sanitizeAnkiTag(t))
      .filter(Boolean)
      .join(' ');
    lines.push(`${ankiField(title)}\t${ankiField(back)}\t${tagText}`);
  }

  return lines.join('\n') + '\n';
}

function ankiField(text: string): string {
  // Anki TSV escaping: tabs delimit fields, newlines delimit rows. We
  // keep both literal in the source but render as `<br>` for HTML mode.
  return text.replace(/\t/g, '    ').replace(/\r?\n/g, '<br>');
}

function sanitizeAnkiTag(t: string): string {
  // Anki tags can't contain whitespace and " (delimiter / escape chars).
  return t.replace(/[\s"]/g, '_');
}

function renderAnkiBack(
  summary: string,
  chapters: Array<{ startSec: number; title: string }>,
  awemeId: string | undefined,
): string {
  const parts: string[] = [];
  parts.push(summary.trim());
  if (chapters.length > 0) {
    parts.push(''); // blank line
    parts.push('章节：');
    for (const c of chapters) {
      parts.push(`• ${formatTime(c.startSec)} ${c.title}`);
    }
  }
  if (awemeId) {
    parts.push('');
    parts.push(`原视频: https://www.douyin.com/video/${awemeId}`);
  }
  return parts.join('\n');
}

/**
 * Render selected videos as CSV (RFC 4180 — CRLF line endings, fields
 * with commas/quotes/newlines wrapped in quotes, embedded quotes
 * doubled). Designed for Excel / Numbers / Google Sheets / Notion's
 * "import database from CSV" flow.
 *
 * Columns: aweme_id, title, creator, duration_seconds, library_status,
 * subtitle_source, tags (semicolon-joined), summary, url, updated_at.
 *
 * Honest contract: no transcript column — the multi-line text
 * frequently carries newlines that bloat CSV cells. Users wanting
 * transcripts use the JSON or Markdown export.
 */
export function exportLibraryAsCsv(opts: ExportOptions): string {
  const store = getDouyinCollectorStore();
  let videos = store.query<VideoRecord>(COLLECTION_VIDEOS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 5000,
  });
  if (opts.scope === 'published') {
    videos = videos.filter((v) => v.library_status === 'published');
  } else if (opts.scope === 'draft') {
    videos = videos.filter(
      (v) => v.library_status === 'draft' || v.library_status === 'unprocessed',
    );
  } else {
    videos = videos.filter((v) => v.library_status !== 'discarded');
  }
  videos = applyIdFilter(videos, opts.ids);

  const header = [
    'aweme_id',
    'title',
    'creator',
    'duration_seconds',
    'library_status',
    'subtitle_source',
    'tags',
    'summary',
    'url',
    'updated_at',
  ];
  const rows: string[] = [header.map(csvCell).join(',')];

  for (const v of videos) {
    const tags = parseVideoTags(v.tags).join('; ');
    const url = v.aweme_id ? `https://www.douyin.com/video/${v.aweme_id}` : '';
    rows.push(
      [
        v.aweme_id ?? '',
        v.title ?? '',
        v.creator_nickname ?? '',
        String(v.duration_seconds ?? 0),
        v.library_status ?? '',
        v.subtitle_source ?? '',
        tags,
        (v.summary ?? '').trim(),
        url,
        v.updated_at ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }

  // RFC 4180: lines end with CRLF.
  return rows.join('\r\n') + '\r\n';
}

/**
 * RFC 4180 cell escaping: wrap in double quotes when the value contains
 * a comma / quote / CR / LF; double any embedded quotes.
 */
function csvCell(value: string): string {
  const needsQuote = /[,"\r\n]/.test(value);
  if (!needsQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function scopeLabel(scope: ExportOptions['scope']): string {
  switch (scope) {
    case 'published':
      return '已入库';
    case 'draft':
      return '草稿 + 待整理';
    default:
      return '全部（已丢弃除外）';
  }
}

function renderVideo(
  video: VideoRecord,
  transcript: TranscriptRow | undefined,
  includeTranscript: boolean,
): string {
  const lines: string[] = [];
  const title = video.title?.trim() || `aweme ${video.aweme_id ?? ''}`;
  lines.push(`## ${title}\n`);

  const metaBits: string[] = [];
  if (video.creator_nickname) metaBits.push(`作者：${video.creator_nickname}`);
  if (video.duration_seconds) metaBits.push(`时长：${formatDuration(video.duration_seconds)}`);
  if (video.subtitle_source) metaBits.push(`字幕来源：${video.subtitle_source}`);
  if (video.aweme_id) metaBits.push(`链接：https://www.douyin.com/video/${video.aweme_id}`);
  if (metaBits.length > 0) lines.push(`*${metaBits.join(' · ')}*\n`);

  if (video.summary?.trim()) {
    lines.push('### 摘要\n');
    lines.push(`${video.summary.trim()}\n`);
  }

  const tags = parseVideoTags(video.tags);
  if (tags.length > 0) {
    lines.push(`**标签**：${tags.map((t) => `#${t}`).join(' ')}\n`);
  }

  const chapters = parseVideoChapters(video.chapters);
  if (chapters.length > 0) {
    lines.push('### 章节\n');
    for (const c of chapters) {
      lines.push(`- ${formatTime(c.startSec)} ${c.title}`);
    }
    lines.push('');
  }

  if (includeTranscript) {
    const transcriptText = parseTranscriptText(transcript?.segments);
    if (transcriptText) {
      lines.push('### 字幕原文\n');
      lines.push(transcriptText);
      lines.push('');
    } else {
      lines.push('*尚未抓取字幕。*\n');
    }
  }

  return lines.join('\n');
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m === 0 ? `${s}s` : `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatTime(sec: number): string {
  if (sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
