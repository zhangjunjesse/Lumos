'use client';

import * as React from 'react';

export interface ActivityDigest {
  windowHours: number;
  windowStart: string;
  newVideos: number;
  uniqueCreators: number;
  newTags: string[];
  publishedInWindow: number;
  starredInWindow: number;
  failedRuns: number;
}

const ZERO: ActivityDigest = {
  windowHours: 24,
  windowStart: new Date(0).toISOString(),
  newVideos: 0,
  uniqueCreators: 0,
  newTags: [],
  publishedInWindow: 0,
  starredInWindow: 0,
  failedRuns: 0,
};

/**
 * Time-bounded activity digest for the Overview tab. `version` bumps on
 * mutations (publish, transcribe etc.) so the panel re-fetches without
 * subscribing to every event.
 */
export function useActivityDigest(
  hours = 24,
  version = 0,
): { digest: ActivityDigest; loading: boolean } {
  const [digest, setDigest] = React.useState<ActivityDigest>({ ...ZERO, windowHours: hours });
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch(`/api/apps/builtin/douyin-collector/library/digest?hours=${hours}`, {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json: ActivityDigest) => {
        if (cancelled) return;
        setDigest({
          windowHours: Number(json.windowHours ?? hours),
          windowStart: String(json.windowStart ?? ''),
          newVideos: Number(json.newVideos ?? 0),
          uniqueCreators: Number(json.uniqueCreators ?? 0),
          newTags: Array.isArray(json.newTags) ? json.newTags : [],
          publishedInWindow: Number(json.publishedInWindow ?? 0),
          starredInWindow: Number(json.starredInWindow ?? 0),
          failedRuns: Number(json.failedRuns ?? 0),
        });
      })
      .catch(() => {
        if (!cancelled) setDigest({ ...ZERO, windowHours: hours });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hours, version]);

  return { digest, loading };
}
