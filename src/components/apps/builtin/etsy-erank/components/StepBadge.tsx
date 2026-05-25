'use client';

import * as React from 'react';

import type { StepState } from '../etsy-erank-types';

const MAP: Record<StepState, { dot: string; text: string; cls: string }> = {
  done: { dot: '✓', text: '完成', cls: 'text-emerald-600 ring-emerald-500/30 bg-emerald-500/10' },
  running: { dot: '●', text: '运行中', cls: 'text-sky-600 ring-sky-500/30 bg-sky-500/10' },
  blocked: { dot: '●', text: '卡住·闸门', cls: 'text-amber-600 ring-amber-500/30 bg-amber-500/10' },
  pending: { dot: '○', text: '待跑', cls: 'text-muted-foreground ring-border bg-muted/40' },
  failed: { dot: '✗', text: '失败', cls: 'text-red-600 ring-red-500/30 bg-red-500/10' },
  skipped: { dot: '⊝', text: '跳过', cls: 'text-muted-foreground ring-border bg-muted/30' },
};

export function StepBadge({ state }: { state: StepState }): React.ReactElement {
  const m = MAP[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${m.cls}`}
    >
      <span aria-hidden>{m.dot}</span>
      {m.text}
    </span>
  );
}
