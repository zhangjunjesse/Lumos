'use client';

import * as React from 'react';

import type { BulkResult } from '../../use-videos';

export type BulkBusy = 'idle' | 'transcribe' | 'retry' | 'publish';
export type BulkKind = Exclude<BulkBusy, 'idle'>;
export type BulkFeedback = { kind: 'ok' | 'error'; text: string } | null;

/**
 * Bulk-action state machine + feedback toast for the Library top toolbar.
 *
 * Owns: `bulkBusy` (which button is currently spinning), `bulkFeedback`
 *       (success/error banner with auto-dismiss), and the shared
 *       `runBulk(kind, label, fn)` helper that wraps a mutation in the
 *       Round 157 contract (ok⇔all succeeded; partial → amber breakdown).
 *
 * Returns:
 *   - `bulkBusy` / `bulkFeedback`         — render bindings
 *   - `setBulkFeedback`                   — escape hatch for validation
 *                                           messages before a bulk action
 *   - `runBulk(kind, label, fn)`          — standard wrapper for the four
 *                                           normal mutations
 *
 * Caller passes `refresh` once at hook-time; `runBulk` auto-refreshes
 * the videos list after every successful mutation. Auto-dismiss after 8s
 * matches OverviewTab.patrolFeedback.
 *
 * Extracted from LibraryTab in round 15.
 */
export function useLibraryBulkActions(refresh: () => Promise<void> | void): {
  bulkBusy: BulkBusy;
  bulkFeedback: BulkFeedback;
  setBulkFeedback: React.Dispatch<React.SetStateAction<BulkFeedback>>;
  runBulk: (kind: BulkKind, label: string, fn: () => Promise<BulkResult>) => Promise<void>;
} {
  const [bulkBusy, setBulkBusy] = React.useState<BulkBusy>('idle');
  const [bulkFeedback, setBulkFeedback] = React.useState<BulkFeedback>(null);

  // Auto-dismiss after 8s — long enough to read, short enough that it
  // doesn't litter the UI when the user moves on.
  React.useEffect(() => {
    if (!bulkFeedback) return;
    const id = setTimeout(() => setBulkFeedback(null), 8000);
    return () => clearTimeout(id);
  }, [bulkFeedback]);

  const runBulk = React.useCallback(
    async (kind: BulkKind, label: string, fn: () => Promise<BulkResult>) => {
      setBulkBusy(kind);
      setBulkFeedback(null);
      try {
        const r = await fn();
        // Round 157 contract:
        //   ok=true                  → all succeeded → green
        //   ok=false + processed>0   → partial / all-fail → amber breakdown
        //   ok=false + no processed  → top-level error (e.g. missing collection)
        const hasBreakdown = (r.processed ?? 0) > 0;
        if (r.ok) {
          setBulkFeedback({
            kind: 'ok',
            text: `${label}：处理 ${r.processed ?? 0} · 成功 ${r.succeeded ?? 0} · 失败 ${r.failed ?? 0}`,
          });
        } else if (hasBreakdown) {
          setBulkFeedback({
            kind: 'error',
            text: `${label}：处理 ${r.processed} · 成功 ${r.succeeded ?? 0} · 失败 ${r.failed ?? 0}${
              (r.reasons ?? []).length > 0 ? `（${r.reasons!.join('；')}）` : ''
            }`,
          });
        } else {
          setBulkFeedback({ kind: 'error', text: r.error ?? `${label}失败` });
        }
        await refresh();
      } catch (e) {
        setBulkFeedback({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      } finally {
        setBulkBusy('idle');
      }
    },
    [refresh],
  );

  return { bulkBusy, bulkFeedback, setBulkFeedback, runBulk };
}
