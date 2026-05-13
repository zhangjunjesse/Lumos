import { NextRequest, NextResponse } from 'next/server';

import {
  findTranscriptSnippets,
  findVideoIdsByTranscriptContent,
  getDouyinCollectorStore,
  matchesBacklog,
  type LibraryBacklogKey,
} from '@/lib/douyin-collector/storage';
import { COLLECTION_LIBRARY_LINKS, COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';
import { parseVideoSort, sortVideos } from '@/lib/douyin-collector/sort-helpers';
import { getDouyinCollectorSettings } from '@/lib/douyin-collector/settings';
import {
  isKnowledgeItemEnhancementReady,
  isKnowledgeItemIndexReady,
  needsKnowledgeItemEnhancement,
} from '@/lib/douyin-collector/knowledge-readiness';
import { getDb } from '@/lib/db';

const BACKLOG_KEYS: ReadonlyArray<LibraryBacklogKey> = [
  'transcribePending',
  'transcribeFailed',
  'publishReady',
  'recent7d',
  'starred',
];

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VideoQuery {
  library_status?: string;
  creator_ref?: string;
  duration_bucket?: string;
}

interface VideoRowForFilter {
  id: string;
  title?: string | null;
  creator_nickname?: string | null;
  summary?: string | null;
  tags?: string | null;
  notes?: string | null;
  starred?: boolean;
  aweme_id?: string;
  transcript_status?: string;
  library_status?: string;
  created_at?: string;
  updated_at?: string;
  duration_seconds?: number;
}

interface LibraryLinkRow {
  id?: string;
  video_ref?: string;
  collection_id?: string;
  chunk_id?: string;
}

interface KbItemIndexRow {
  id: string;
  collection_id: string;
  source_key?: string;
  processing_status?: string;
  chunk_count?: number | null;
  processing_detail?: string | null;
  summary?: string | null;
  key_points?: string | null;
  tags?: string | null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const filter: VideoQuery = {};
    const status = url.searchParams.get('library_status');
    if (status) filter.library_status = status;
    const creator = url.searchParams.get('creator_ref');
    if (creator) filter.creator_ref = creator;
    const bucket = url.searchParams.get('duration_bucket');
    if (bucket) filter.duration_bucket = bucket;

    const q = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    const tag = url.searchParams.get('tag')?.trim().toLowerCase() ?? '';
    const sort = url.searchParams.get('sort') ?? 'newest';
    const limit = Number(url.searchParams.get('limit') ?? '200');

    const store = getDouyinCollectorStore();
    let items = store.query<VideoRowForFilter>(COLLECTION_VIDEOS, {
      filter: filter as Record<string, unknown>,
      orderBy: { field: 'updated_at', direction: 'desc' },
      limit: 1000,
    });

    const searchTranscript = url.searchParams.get('search_scope') === 'transcript';
    if (q) {
      const transcriptHits = searchTranscript
        ? findVideoIdsByTranscriptContent(q, store)
        : null;
      items = items.filter((v) => {
        // Notes is included so users can find videos by their own
        // annotations ("我去年标注过 KV cache 的视频") — same metadata
        // scope, just one more text field. Notes is private to the
        // user; no risk of leaking external content.
        const haystack = [
          v.title ?? '',
          v.creator_nickname ?? '',
          v.summary ?? '',
          v.notes ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (haystack.includes(q)) return true;
        // Transcript scope is additive (union with metadata): expanding
        // the toggle never hides a video whose title already matched.
        if (transcriptHits && transcriptHits.has(v.id)) return true;
        return false;
      });
    }
    if (tag) {
      items = items.filter((v) => parseTags(v.tags).some((t) => t.toLowerCase() === tag));
    }
    const backlogParam = url.searchParams.get('backlog');
    if (backlogParam && (BACKLOG_KEYS as readonly string[]).includes(backlogParam)) {
      const key = backlogParam as LibraryBacklogKey;
      const now = new Date();
      items = items.filter((v) => matchesBacklog(v, key, now));
    }

    items = sortVideos(items, parseVideoSort(sort));
    const limited = enrichLibraryPublishState(items.slice(0, limit), store);
    // Attach transcript snippet to each item that matched via the
    // transcript-scope search. Computed only when both the toggle is on
    // and the query is set, so default browsing has zero overhead.
    if (searchTranscript && q && q.length >= 2) {
      const snippets = findTranscriptSnippets(q, store);
      const enriched = limited.map((v) => {
        const s = snippets.get(v.id);
        return s ? { ...v, transcript_snippet: s } : v;
      });
      return NextResponse.json({ items: enriched, transcript_query: q });
    }
    return NextResponse.json({ items: limited });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function enrichLibraryPublishState<T extends {
  id: string;
  aweme_id?: string | null;
  library_status?: string;
}>(
  videos: T[],
  store: ReturnType<typeof getDouyinCollectorStore>,
): Array<T & {
  library_current_collection_id: string | null;
  library_current_collection_name: string | null;
  library_current_item_id: string | null;
  library_current_processing_status: string | null;
  library_current_chunk_count: number | null;
  library_current_index_ready: boolean;
  library_current_enhancement_ready: boolean;
  library_current_needs_enhancement: boolean;
  library_current_summary: string | null;
  library_published_to_current: boolean;
  library_published_collection_ids: string[];
  library_published_collection_names: string[];
}> {
  const currentCollectionId = getDouyinCollectorSettings().libraryCollectionId ?? null;
  const videoIds = new Set(videos.map((video) => video.id));
  const links = store
    .query<LibraryLinkRow>(COLLECTION_LIBRARY_LINKS, { limit: 10000 })
    .filter((link) => !!link.video_ref && !!link.collection_id && videoIds.has(link.video_ref));

  const collectionIds = new Set<string>();
  if (currentCollectionId) collectionIds.add(currentCollectionId);
  for (const link of links) {
    if (link.collection_id) collectionIds.add(link.collection_id);
  }
  const collectionNames = loadCollectionNames([...collectionIds]);
  const byVideo = new Map<string, Set<string>>();
  const currentLinkedItemIdByVideo = new Map<string, string>();
  for (const link of links) {
    if (!link.video_ref || !link.collection_id) continue;
    const set = byVideo.get(link.video_ref) ?? new Set<string>();
    set.add(link.collection_id);
    byVideo.set(link.video_ref, set);
    if (currentCollectionId && link.collection_id === currentCollectionId && link.chunk_id) {
      currentLinkedItemIdByVideo.set(link.video_ref, link.chunk_id);
    }
  }

  const linkedItemsById = loadKnowledgeItemsByIds([...currentLinkedItemIdByVideo.values()]);
  const sourceKeys = currentCollectionId ? videos.map((video) => sourceKeyForVideo(video)) : [];
  const itemsBySourceKey = currentCollectionId
    ? loadKnowledgeItemsBySourceKeys(currentCollectionId, sourceKeys)
    : new Map<string, KbItemIndexRow>();

  return videos.map((video) => {
    const idsSet = new Set(byVideo.get(video.id) ?? new Set<string>());
    const linkedItemId = currentLinkedItemIdByVideo.get(video.id);
    const linkedItem = linkedItemId ? linkedItemsById.get(linkedItemId) ?? null : null;
    const sourceItem = currentCollectionId
      ? itemsBySourceKey.get(sourceKeyForVideo(video)) ?? null
      : null;
    const currentItem = linkedItem ?? sourceItem;
    if (currentCollectionId && (linkedItemId || currentItem)) idsSet.add(currentCollectionId);
    const ids = [...idsSet];
    return {
      ...video,
      library_current_collection_id: currentCollectionId,
      library_current_collection_name: currentCollectionId
        ? collectionNames.get(currentCollectionId) ?? currentCollectionId
        : null,
      library_current_item_id: currentItem?.id ?? null,
      library_current_processing_status: currentItem?.processing_status ?? null,
      library_current_chunk_count: typeof currentItem?.chunk_count === 'number'
        ? currentItem.chunk_count
        : null,
      library_current_index_ready: isKnowledgeItemIndexReady(currentItem),
      library_current_enhancement_ready: isKnowledgeItemEnhancementReady(currentItem),
      library_current_needs_enhancement: needsKnowledgeItemEnhancement(currentItem),
      library_current_summary: currentItem?.summary?.trim() || null,
      library_published_to_current: !!currentCollectionId && ids.includes(currentCollectionId),
      library_published_collection_ids: ids,
      library_published_collection_names: ids.map((id) => collectionNames.get(id) ?? id),
    };
  });
}

function sourceKeyForVideo(video: { id: string; aweme_id?: string | null }): string {
  return `douyin:${video.aweme_id || video.id}`;
}

function loadKnowledgeItemsByIds(ids: string[]): Map<string, KbItemIndexRow> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  try {
    const placeholders = unique.map(() => '?').join(',');
    const rows = getDb()
      .prepare(
        `SELECT id, collection_id, source_key, processing_status, chunk_count,
                processing_detail, summary, key_points, tags
         FROM kb_items
         WHERE id IN (${placeholders})`,
      )
      .all(...unique) as KbItemIndexRow[];
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return new Map();
  }
}

function loadKnowledgeItemsBySourceKeys(
  collectionId: string,
  sourceKeys: string[],
): Map<string, KbItemIndexRow> {
  const unique = [...new Set(sourceKeys.filter(Boolean))];
  if (unique.length === 0) return new Map();
  try {
    const placeholders = unique.map(() => '?').join(',');
    const rows = getDb()
      .prepare(
        `SELECT id, collection_id, source_key, processing_status, chunk_count, processing_detail, summary, key_points, tags
         FROM kb_items
         WHERE collection_id = ? AND source_key IN (${placeholders})`,
      )
      .all(collectionId, ...unique) as KbItemIndexRow[];
    return new Map(rows.map((row) => [row.source_key ?? '', row]));
  } catch {
    return new Map();
  }
}

function loadCollectionNames(ids: string[]): Map<string, string> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  try {
    const placeholders = unique.map(() => '?').join(',');
    const rows = getDb()
      .prepare(`SELECT id, name FROM kb_collections WHERE id IN (${placeholders})`)
      .all(...unique) as Array<{ id: string; name: string }>;
    return new Map(rows.map((row) => [row.id, row.name]));
  } catch {
    return new Map();
  }
}

function parseTags(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string');
    }
  } catch {
    /* ignore */
  }
  return [];
}
