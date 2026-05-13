import { NextRequest, NextResponse } from 'next/server';

import { COLLECTION_LIBRARY_LINKS, COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';
import { getDouyinCollectorSettings } from '@/lib/douyin-collector/settings';
import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import { getDb } from '@/lib/db';
import { loadFullItemContent } from '@/lib/knowledge/pipeline-support';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VideoRow {
  aweme_id?: string;
}

interface LibraryLinkRow {
  collection_id?: string;
  chunk_id?: string;
  updated_at?: string;
  pushed_at?: string;
}

interface KbItemRow {
  id: string;
  collection_id: string;
  title: string;
  source_type?: string;
  source_path?: string;
  source_key?: string;
  content: string;
  tags?: string;
  summary?: string;
  processing_status?: string;
  processing_error?: string;
  updated_at?: string;
  created_at?: string;
}

interface KbCollectionRow {
  id: string;
  name: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const store = getDouyinCollectorStore();
    const video = store.get<VideoRow>(COLLECTION_VIDEOS, id);
    if (!video) return NextResponse.json({ error: '视频不存在。' }, { status: 404 });

    const links = store.query<LibraryLinkRow>(COLLECTION_LIBRARY_LINKS, {
      filter: { video_ref: id },
      orderBy: { field: 'updated_at', direction: 'desc' },
      limit: 50,
    });
    const items = loadKnowledgeItems(
      video,
      links,
      getDouyinCollectorSettings().libraryCollectionId ?? null,
    );
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function loadKnowledgeItems(
  video: VideoRow,
  links: LibraryLinkRow[],
  currentCollectionId: string | null,
) {
  const db = getDb();
  const collectionIds = [...new Set(links.map((link) => link.collection_id).filter(isString))];
  const collectionNames = loadCollectionNames(collectionIds);
  const rowsById = new Map<string, KbItemRow>();

  for (const link of links) {
    const byChunk = link.chunk_id ? getItemById(link.chunk_id) : null;
    const bySource =
      !byChunk && link.collection_id && video.aweme_id
        ? getItemBySourceKey(link.collection_id, `douyin:${video.aweme_id}`)
        : null;
    const item = byChunk ?? bySource;
    if (!item) continue;
    rowsById.set(item.id, item);
    if (!collectionNames.has(item.collection_id)) {
      const col = db
        .prepare('SELECT id, name FROM kb_collections WHERE id = ?')
        .get(item.collection_id) as KbCollectionRow | undefined;
      if (col) collectionNames.set(col.id, col.name);
    }
  }

  // Some older rows may have lost their library_links pointer. If this video
  // was published with the standard source_key, still surface it in-app.
  if (video.aweme_id) {
    const sourceKey = `douyin:${video.aweme_id}`;
    const rows = db
      .prepare('SELECT * FROM kb_items WHERE source_key = ? ORDER BY updated_at DESC LIMIT 20')
      .all(sourceKey) as KbItemRow[];
    for (const row of rows) rowsById.set(row.id, row);
  }

  const rows = [...rowsById.values()];
  const missingCollectionIds = rows
    .map((row) => row.collection_id)
    .filter((id) => id && !collectionNames.has(id));
  for (const [id, name] of loadCollectionNames(missingCollectionIds)) {
    collectionNames.set(id, name);
  }

  rows.sort((a, b) => {
    if (currentCollectionId) {
      if (a.collection_id === currentCollectionId && b.collection_id !== currentCollectionId) return -1;
      if (b.collection_id === currentCollectionId && a.collection_id !== currentCollectionId) return 1;
    }
    return String(b.updated_at ?? b.created_at ?? '').localeCompare(String(a.updated_at ?? a.created_at ?? ''));
  });

  return rows.map((item) => ({
    id: item.id,
    collectionId: item.collection_id,
    collectionName: collectionNames.get(item.collection_id) ?? item.collection_id,
    title: item.title,
    sourceType: item.source_type ?? null,
    sourcePath: item.source_path ?? null,
    sourceKey: item.source_key ?? null,
    tags: parseTags(item.tags),
    summary: item.summary ?? '',
    content: loadFullItemContent(item.id, item.content),
    processingStatus: item.processing_status ?? null,
    processingError: item.processing_error ?? '',
    updatedAt: item.updated_at ?? null,
    createdAt: item.created_at ?? null,
  }));
}

function getItemById(id: string): KbItemRow | null {
  return (getDb().prepare('SELECT * FROM kb_items WHERE id = ?').get(id) as KbItemRow | undefined) ?? null;
}

function getItemBySourceKey(collectionId: string, sourceKey: string): KbItemRow | null {
  return (
    (getDb()
      .prepare('SELECT * FROM kb_items WHERE collection_id = ? AND source_key = ? LIMIT 1')
      .get(collectionId, sourceKey) as KbItemRow | undefined) ?? null
  );
}

function loadCollectionNames(ids: string[]): Map<string, string> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT id, name FROM kb_collections WHERE id IN (${placeholders})`)
    .all(...unique) as KbCollectionRow[];
  return new Map(rows.map((row) => [row.id, row.name]));
}

function parseTags(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((tag): tag is string => typeof tag === 'string');
    }
  } catch {
    /* ignore */
  }
  return [];
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
