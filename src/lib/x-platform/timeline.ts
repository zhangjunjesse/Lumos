import { gqlGet, gqlPost } from './graphql-client';
import { buildHomeTimeline, buildUserTweets } from './graphql-queries';
import { extractHits, type TimelineResponse } from './timeline-extract';
import type { XSearchResult } from './types';

interface HomeTimelineData {
  home?: {
    home_timeline_urt?: TimelineResponse;
  };
}

interface UserTweetsData {
  user?: {
    result?: {
      timeline_v2?: {
        timeline?: TimelineResponse;
      };
    };
  };
}

export async function readHomeTimeline(
  opts: { count?: number; cursor?: string } = {},
): Promise<XSearchResult> {
  const count = Math.max(1, Math.min(50, opts.count ?? 20));
  const data = await gqlPost<HomeTimelineData>(buildHomeTimeline(count, opts.cursor));
  const timeline = data?.home?.home_timeline_urt;
  const { hits, cursor } = timeline ? extractHits(timeline) : { hits: [], cursor: undefined };
  return { query: '__home__', hits, cursor };
}

export async function readUserTweets(
  userId: string,
  opts: { count?: number; cursor?: string } = {},
): Promise<XSearchResult> {
  if (!userId || !/^\d+$/.test(userId)) {
    throw new Error(`Invalid X user id: ${JSON.stringify(userId)}`);
  }
  const count = Math.max(1, Math.min(50, opts.count ?? 20));
  const data = await gqlGet<UserTweetsData>(buildUserTweets(userId, count, opts.cursor));
  const timeline = data?.user?.result?.timeline_v2?.timeline;
  const { hits, cursor } = timeline ? extractHits(timeline) : { hits: [], cursor: undefined };
  return { query: `__user_${userId}__`, hits, cursor };
}
