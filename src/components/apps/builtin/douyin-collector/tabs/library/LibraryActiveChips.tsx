'use client';

import * as React from 'react';
import { Tag as TagIcon, User as UserIcon, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Currently-active tag / creator filter chips above the video grid. Each
 * chip has its own clear button. Hidden entirely when neither filter is
 * set, so the row doesn't reserve vertical space when empty.
 *
 * Extracted from LibraryTab in round 9.
 */
export function LibraryActiveChips({
  tag,
  creatorRef,
  creatorLabel,
  onClearTag,
  onClearCreator,
}: {
  tag: string;
  creatorRef: string;
  creatorLabel: string;
  onClearTag: () => void;
  onClearCreator: () => void;
}): React.ReactElement | null {
  if (!tag && !creatorRef) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {tag ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2.5 py-1 text-foreground">
            <TagIcon className="size-3" />
            {tag}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={onClearTag}
          >
            <X className="size-3" />
            清除标签
          </Button>
        </>
      ) : null}
      {creatorRef ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2.5 py-1 text-foreground">
            <UserIcon className="size-3" />
            {creatorLabel || creatorRef.slice(0, 12) + '…'}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px]"
            onClick={onClearCreator}
          >
            <X className="size-3" />
            清除博主
          </Button>
        </>
      ) : null}
    </div>
  );
}
