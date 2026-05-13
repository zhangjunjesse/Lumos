'use client';

import * as React from 'react';

import { emitTagsChanged } from '@/lib/douyin-collector/events';

export interface VideoRow {
  id: string;
  aweme_id: string;
  creator_ref?: string | null;
  creator_nickname?: string | null;
  title?: string | null;
  cover?: string | null;
  duration_seconds?: number;
  duration_bucket?: 'short' | 'medium' | 'long';
  language?: string;
  subtitle_source?: 'none' | 'native' | 'asr-douyin' | 'asr-local';
  transcript_status?: 'pending' | 'running' | 'success' | 'failed';
  summary?: string | null;
  tags?: string | null;
  chapters?: string | null;
  library_status?: 'unprocessed' | 'draft' | 'published' | 'discarded';
  library_collection_id?: string | null;
  library_current_collection_id?: string | null;
  library_current_collection_name?: string | null;
  library_current_item_id?: string | null;
  library_current_processing_status?: string | null;
  library_current_chunk_count?: number | null;
  library_current_index_ready?: boolean;
  library_current_enhancement_ready?: boolean;
  library_current_needs_enhancement?: boolean;
  library_current_summary?: string | null;
  library_published_to_current?: boolean;
  library_published_collection_ids?: string[];
  library_published_collection_names?: string[];
  notes?: string | null;
  starred?: boolean;
  // ASR cost transparency: persisted on transcribe success so VideoCard /
  // organize tabs can show "this transcribe cost ¥X" without re-querying
  // cloud billing.
  transcript_charged_amount?: number | null;
  transcript_asr_duration?: number | null;
  failure_reason?: string | null;
  updated_at?: string;
  // Server-attached when transcript-scope search is active. Not persisted.
  transcript_snippet?: string;
}

export type LibraryStatusFilter = 'all' | 'unprocessed' | 'draft' | 'published' | 'discarded';
export type LibrarySort = 'newest' | 'oldest' | 'longest' | 'starred' | 'curated';
export type LibraryBacklogChip =
  | 'transcribePending'
  | 'transcribeFailed'
  | 'publishReady'
  | 'recent7d'
  | 'starred';

export type SearchScope = 'metadata' | 'transcript';

export interface VideoListQuery {
  status?: LibraryStatusFilter;
  search?: string;
  tag?: string;
  sort?: LibrarySort;
  backlog?: LibraryBacklogChip | null;
  searchScope?: SearchScope;
  creatorRef?: string;
}

export function useVideos(filterOrQuery: LibraryStatusFilter | VideoListQuery = 'all') {
  const query: VideoListQuery =
    typeof filterOrQuery === 'string' ? { status: filterOrQuery } : filterOrQuery;
  const status = query.status ?? 'all';
  const search = query.search ?? '';
  const tag = query.tag ?? '';
  const sort = query.sort ?? 'newest';
  const backlog = query.backlog ?? null;
  const searchScope = query.searchScope ?? 'metadata';
  const creatorRef = query.creatorRef ?? '';

  const [videos, setVideos] = React.useState<VideoRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/apps/builtin/douyin-collector/videos', window.location.origin);
      if (status !== 'all') url.searchParams.set('library_status', status);
      if (search) url.searchParams.set('q', search);
      if (tag) url.searchParams.set('tag', tag);
      if (sort) url.searchParams.set('sort', sort);
      if (backlog) url.searchParams.set('backlog', backlog);
      if (creatorRef) url.searchParams.set('creator_ref', creatorRef);
      if (searchScope === 'transcript' && search) {
        url.searchParams.set('search_scope', 'transcript');
      }
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: VideoRow[] };
      setVideos(json.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [status, search, tag, sort, backlog, searchScope, creatorRef]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { videos, loading, error, refresh };
}

export interface BulkResult {
  ok: boolean;
  processed?: number;
  succeeded?: number;
  failed?: number;
  reasons?: string[];
  error?: string;
}

async function postBulk<T>(path: string, input: T): Promise<BulkResult> {
  const res = await fetch(`/api/apps/builtin/douyin-collector/videos/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as BulkResult;
  return {
    ok: !!json.ok,
    processed: json.processed,
    succeeded: json.succeeded,
    failed: json.failed,
    reasons: json.reasons,
    error: json.error,
  };
}

export function bulkTranscribe(input: {
  scope?: 'pending' | 'failed' | 'all';
  limit?: number;
}): Promise<BulkResult> {
  return postBulk('bulk-transcribe', input);
}

export function bulkPublish(input: {
  ids?: string[];
  scope?: 'draft' | 'unprocessed' | 'all';
  limit?: number;
  collectionId?: string;
}): Promise<BulkResult> {
  return postBulk('bulk-publish', input);
}

export interface BulkStatusResult {
  ok: boolean;
  updated?: number;
  skipped?: number;
  error?: string;
}

/**
 * Bulk-set library_status for the given video ids. Server enforces the
 * allowed targets ('discarded' / 'unprocessed') — see route handler.
 */
export async function bulkSetStatus(
  ids: string[],
  target: 'discarded' | 'unprocessed',
): Promise<BulkStatusResult> {
  const res = await fetch('/api/apps/builtin/douyin-collector/videos/bulk-status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids, library_status: target }),
  });
  const json = (await res.json().catch(() => ({}))) as BulkStatusResult;
  return {
    ok: !!json.ok,
    updated: json.updated,
    skipped: json.skipped,
    error: json.error,
  };
}

export async function patchVideo(id: string, patch: Partial<VideoRow>): Promise<VideoRow> {
  const res = await fetch(`/api/apps/builtin/douyin-collector/videos/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const json = (await res.json()) as { video: VideoRow };
  // If tags changed, refresh hot tags / suggestion strips so all
  // panels reflect the new state (Round 110 event pattern).
  if (patch.tags !== undefined) emitTagsChanged();
  return json.video;
}

export async function transcribeVideo(
  id: string,
  opts: { force?: boolean } = {},
): Promise<{
  ok: boolean;
  segmentCount?: number;
  sourceFormat?: string;
  error?: string;
}> {
  const url = opts.force
    ? `/api/apps/builtin/douyin-collector/videos/${id}/transcribe?force=1`
    : `/api/apps/builtin/douyin-collector/videos/${id}/transcribe`;
  const res = await fetch(url, { method: 'POST' });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    segmentCount?: number;
    sourceFormat?: string;
  };
  return {
    ok: !!json.ok,
    segmentCount: json.segmentCount,
    sourceFormat: json.sourceFormat,
    error: json.error,
  };
}

export async function publishVideoToLibrary(
  id: string,
  collectionId?: string,
): Promise<{ ok: boolean; itemId?: string; error?: string }> {
  const res = await fetch(`/api/apps/builtin/douyin-collector/videos/${id}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collectionId }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    itemId?: string;
    error?: string;
  };
  return { ok: !!json.ok, itemId: json.itemId, error: json.error };
}
