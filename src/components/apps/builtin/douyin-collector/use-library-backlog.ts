'use client';

import * as React from 'react';

export interface LibraryBacklogCounts {
  transcribePending: number;
  transcribeFailed: number;
  publishReady: number;
  recent7d: number;
  starred: number;
}

export interface LibraryStatusCountsClient {
  videos: number;
  unprocessed: number;
  drafts: number;
  published: number;
  discarded: number;
}

const ZERO: LibraryBacklogCounts = {
  transcribePending: 0,
  transcribeFailed: 0,
  publishReady: 0,
  recent7d: 0,
  starred: 0,
};

const ZERO_STATUS: LibraryStatusCountsClient = {
  videos: 0,
  unprocessed: 0,
  drafts: 0,
  published: 0,
  discarded: 0,
};

/**
 * Polls `/library/backlog` to keep both the smart-filter chip counts
 * (Round 79) and the per-status counts (Round 108) honest. Single fetch,
 * two payloads — the Library tab uses both above the cards.
 *
 * Caller passes a `version` int that bumps after any mutation (publish,
 * transcribe, discard) so the counts refresh without a separate hook
 * subscribing to those events.
 */
export function useLibraryBacklog(version = 0): {
  counts: LibraryBacklogCounts;
  statusCounts: LibraryStatusCountsClient;
  loading: boolean;
} {
  const [counts, setCounts] = React.useState<LibraryBacklogCounts>(ZERO);
  const [statusCounts, setStatusCounts] =
    React.useState<LibraryStatusCountsClient>(ZERO_STATUS);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetch('/api/apps/builtin/douyin-collector/library/backlog', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        (json: LibraryBacklogCounts & { statusCounts?: LibraryStatusCountsClient }) => {
          if (cancelled) return;
          setCounts({
            transcribePending: Number(json.transcribePending ?? 0),
            transcribeFailed: Number(json.transcribeFailed ?? 0),
            publishReady: Number(json.publishReady ?? 0),
            recent7d: Number(json.recent7d ?? 0),
            starred: Number(json.starred ?? 0),
          });
          const sc = json.statusCounts;
          setStatusCounts({
            videos: Number(sc?.videos ?? 0),
            unprocessed: Number(sc?.unprocessed ?? 0),
            drafts: Number(sc?.drafts ?? 0),
            published: Number(sc?.published ?? 0),
            discarded: Number(sc?.discarded ?? 0),
          });
        },
      )
      .catch(() => {
        if (!cancelled) {
          setCounts(ZERO);
          setStatusCounts(ZERO_STATUS);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return { counts, statusCounts, loading };
}
