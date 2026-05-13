'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Star,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { LibraryBacklogCounts } from '../use-library-backlog';
import type { LibraryBacklogChip } from '../use-videos';

interface ChipDef {
  key: LibraryBacklogChip;
  label: string;
  icon: React.ReactNode;
}

const CHIPS: ChipDef[] = [
  { key: 'starred', label: '已加星', icon: <Star className="size-3" /> },
  { key: 'transcribePending', label: '待抓字幕', icon: <FileText className="size-3" /> },
  {
    key: 'transcribeFailed',
    label: '抓字幕失败',
    icon: <AlertTriangle className="size-3" />,
  },
  { key: 'publishReady', label: '可入库', icon: <CheckCircle2 className="size-3" /> },
  { key: 'recent7d', label: '本周新增', icon: <CalendarClock className="size-3" /> },
];

/**
 * Smart-filter chip row above the library cards. Shows only chips with
 * a non-zero count — empty backlog hides the row entirely (no visual
 * noise when everything is processed).
 *
 * Each chip toggles: clicking the active chip clears the filter.
 */
export function BacklogChips({
  counts,
  active,
  onChange,
}: {
  counts: LibraryBacklogCounts;
  active: LibraryBacklogChip | null;
  onChange: (next: LibraryBacklogChip | null) => void;
}): React.ReactElement | null {
  const visible = CHIPS.filter((c) => counts[c.key] > 0);
  if (visible.length === 0 && !active) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((c) => {
        const isActive = active === c.key;
        return (
          <Button
            key={c.key}
            size="sm"
            variant={isActive ? 'default' : 'outline'}
            className="h-7 gap-1 px-2.5 text-xs"
            onClick={() => onChange(isActive ? null : c.key)}
          >
            {c.icon}
            {c.label}
            <span
              className={
                isActive
                  ? 'ml-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-medium'
                  : 'ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground'
              }
            >
              {counts[c.key]}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
