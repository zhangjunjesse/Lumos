'use client';

import * as React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileText,
  Star,
} from 'lucide-react';

import type { LibraryBacklogCounts } from '../use-library-backlog';
import type { LibraryBacklogChip } from '../use-videos';

interface ActionDef {
  key: LibraryBacklogChip;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

const ACTIONS: ActionDef[] = [
  {
    key: 'starred',
    label: '已加星',
    hint: '重点回看 / 深度学习清单',
    icon: <Star className="size-4" />,
  },
  {
    key: 'transcribePending',
    label: '待抓字幕',
    hint: '点开「资料库 → 待抓字幕」一次性跑',
    icon: <FileText className="size-4" />,
  },
  {
    key: 'transcribeFailed',
    label: '抓字幕失败',
    hint: '上次失败，逐条看 failure_reason 再决定要不要重试',
    icon: <AlertTriangle className="size-4" />,
  },
  {
    key: 'publishReady',
    label: '可入库',
    hint: '已有字幕，可发布到 knowledge collection',
    icon: <CheckCircle2 className="size-4" />,
  },
  {
    key: 'recent7d',
    label: '本周新增',
    hint: '最近 7 天采集进来的视频',
    icon: <CalendarClock className="size-4" />,
  },
];

/**
 * Concierge-style action grid for the Overview tab. Each card shows a
 * non-zero backlog count and clicking jumps the user to Library with
 * that backlog filter pre-applied. When everything's processed (all
 * counts = 0) the grid hides itself — clean dashboard, no busywork.
 */
export function BacklogActionGrid({
  counts,
  onJump,
}: {
  counts: LibraryBacklogCounts;
  onJump: (key: LibraryBacklogChip) => void;
}): React.ReactElement | null {
  const visible = ACTIONS.filter((a) => counts[a.key] > 0);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">待办</h3>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          一键跳转
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {visible.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => onJump(a.key)}
            className="group flex items-start gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left transition-colors hover:border-foreground/30 hover:bg-foreground/[0.03]"
          >
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/80">
              {a.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums leading-none">
                  {counts[a.key]}
                </span>
                <span className="text-xs text-muted-foreground">{a.label}</span>
              </span>
              <span className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{a.hint}</span>
            </span>
            <ArrowRight className="mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
