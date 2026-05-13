'use client';

import * as React from 'react';

import { DOUYIN_TAGS_CHANGED } from '@/lib/douyin-collector/events';

export interface TagItem {
  tag: string;
  count: number;
}

/**
 * Pulls the top N most-used tags across the user's library. Used by
 * OrganizeTab as a click-to-add suggestion strip — prevents tag drift
 * (AI / ai / Ai) by encouraging reuse of existing tags. Single fetch
 * per mount; the `version` argument forces a refetch after a mutation.
 */
export function useTopTags(version = 0, limit = 30): {
  tags: TagItem[];
  loading: boolean;
} {
  const [tags, setTags] = React.useState<TagItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  // Internal counter bumped when the global tags-changed event fires —
  // keeps Hot tags / Organize suggestions / etc. in sync after a tag
  // rename without each consumer wiring its own subscription.
  const [eventTick, setEventTick] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setEventTick((n) => n + 1);
    window.addEventListener(DOUYIN_TAGS_CHANGED, handler);
    return () => window.removeEventListener(DOUYIN_TAGS_CHANGED, handler);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/apps/builtin/douyin-collector/library/top-tags?limit=${limit}`, {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: { items?: TagItem[] }) => {
        if (cancelled) return;
        setTags(Array.isArray(json.items) ? json.items : []);
      })
      .catch(() => {
        if (!cancelled) setTags([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version, limit, eventTick]);

  return { tags, loading };
}
