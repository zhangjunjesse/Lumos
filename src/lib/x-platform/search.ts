import { gqlGet } from './graphql-client';
import { buildSearchTimeline } from './graphql-queries';
import { extractHits, type TimelineResponse } from './timeline-extract';
import type { XSearchResult } from './types';

interface SearchTimelineData {
  search_by_raw_query?: {
    search_timeline?: {
      timeline?: TimelineResponse;
    };
  };
}

export async function searchTweets(
  query: string,
  opts: { count?: number; cursor?: string } = {},
): Promise<XSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { query: trimmed, hits: [] };
  const count = Math.max(1, Math.min(50, opts.count ?? 20));
  const data = await gqlGet<SearchTimelineData>(buildSearchTimeline(trimmed, count, opts.cursor));
  const timeline = data?.search_by_raw_query?.search_timeline?.timeline;
  const { hits, cursor } = timeline ? extractHits(timeline) : { hits: [], cursor: undefined };
  return { query: trimmed, hits, cursor };
}
