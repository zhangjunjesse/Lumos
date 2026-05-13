'use client';

import * as React from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { LibraryStatusFilter, LibraryBacklogChip } from '../../use-videos';

/**
 * Trailing-action bar that surfaces the bulk discard / restore button only
 * when the current filter narrows the view (status='unprocessed'/'draft' or a
 * backlog chip is active). Returns null on the broad `all` view to avoid an
 * accidental "delete everything" button.
 *
 * Extracted from LibraryTab in round 7 to keep the parent under the 300-line
 * hard limit. No behaviour change.
 */
export function BulkStatusBar({
  status,
  backlog,
  videoCount,
  busy,
  onAsk,
}: {
  status: LibraryStatusFilter;
  backlog: LibraryBacklogChip | null;
  videoCount: number;
  busy: boolean;
  onAsk: (kind: 'discard' | 'restore') => void;
}): React.ReactElement | null {
  if (status === 'discarded') {
    return (
      <div className="flex items-center justify-end">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onAsk('restore')}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
          全部恢复 ({videoCount})
        </Button>
      </div>
    );
  }
  const narrowed =
    status === 'unprocessed' || status === 'draft' || backlog !== null;
  if (!narrowed) return null;
  return (
    <div className="flex items-center justify-end">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => onAsk('discard')}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        全部丢弃 ({videoCount})
      </Button>
    </div>
  );
}
