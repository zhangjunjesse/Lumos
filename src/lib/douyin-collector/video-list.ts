/**
 * 紧凑的「已采集视频清单」查询，给 MCP 工具 douyin_list_videos 用。
 *
 * 为什么不复用 /videos 路由：那条是给库 UI 的重负载（逐条富集知识库发布
 * 状态、kb_items 关联等），AI 侧只需要一个可核对的精简列表。这里直接读
 * douyin-collector 的 AppDataStore，做最小投影 + 过滤 + 分页。
 *
 * 纯只读、与采集管线/风控硬化无耦合（仅 import storage + constants）。
 */

import { getDouyinCollectorStore } from './storage';
import { COLLECTION_VIDEOS } from './constants';

export interface CompactVideo {
  id: string;
  aweme_id: string | null;
  /** 可点开核对的视频地址（有 aweme_id 时）。 */
  url: string | null;
  title: string | null;
  creator: string | null;
  transcript_status: string | null;
  library_status: string | null;
  duration_seconds: number | null;
  tags: string[];
  summary: string | null;
  updated_at: string | null;
}

export interface ListVideosOptions {
  /** 模糊匹配 标题/作者/摘要/标签（不区分大小写）。 */
  query?: string | null;
  /** 精确过滤 library_status（unprocessed/draft/published/discarded）。 */
  libraryStatus?: string | null;
  /** 精确过滤 transcript_status（success/failed/running/...）。 */
  transcriptStatus?: string | null;
  /** 默认 50，硬上限 500。 */
  limit?: number | null;
  offset?: number | null;
}

export interface ListVideosResult {
  /** 过滤后总条数（分页前），便于 AI 判断是否还有更多。 */
  total: number;
  returned: number;
  offset: number;
  limit: number;
  items: CompactVideo[];
}

interface VideoRow {
  id: string;
  aweme_id?: string | null;
  title?: string | null;
  creator_nickname?: string | null;
  summary?: string | null;
  tags?: string | null;
  transcript_status?: string | null;
  library_status?: string | null;
  duration_seconds?: number | null;
  updated_at?: string | null;
}

function parseTags(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    /* 非 JSON：按逗号/空白兜底切分 */
    return raw.split(/[,，\s]+/).filter(Boolean);
  }
  return [];
}

function toCompact(v: VideoRow): CompactVideo {
  const tags = parseTags(v.tags);
  return {
    id: v.id,
    aweme_id: v.aweme_id ?? null,
    url: v.aweme_id ? `https://www.douyin.com/video/${v.aweme_id}` : null,
    title: v.title ?? null,
    creator: v.creator_nickname ?? null,
    transcript_status: v.transcript_status ?? null,
    library_status: v.library_status ?? null,
    duration_seconds: typeof v.duration_seconds === 'number' ? v.duration_seconds : null,
    tags,
    summary: v.summary ?? null,
    updated_at: v.updated_at ?? null,
  };
}

/** 列出已采集视频（精简投影），支持模糊检索 + 状态过滤 + 分页。 */
export function listCollectedVideos(opts: ListVideosOptions = {}): ListVideosResult {
  const store = getDouyinCollectorStore();
  const filter: Record<string, unknown> = {};
  if (opts.libraryStatus) filter.library_status = opts.libraryStatus;
  if (opts.transcriptStatus) filter.transcript_status = opts.transcriptStatus;

  let rows = store.query<VideoRow>(COLLECTION_VIDEOS, {
    filter: Object.keys(filter).length > 0 ? filter : undefined,
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 100_000,
  });

  const q = opts.query?.trim().toLowerCase() ?? '';
  if (q) {
    rows = rows.filter((v) => {
      const hay = [
        v.title ?? '',
        v.creator_nickname ?? '',
        v.summary ?? '',
        parseTags(v.tags).join(' '),
      ]
        .join('\n')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const total = rows.length;
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit ?? 50)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const page = rows.slice(offset, offset + limit).map(toCompact);
  return { total, returned: page.length, offset, limit, items: page };
}
