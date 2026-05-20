'use client';

import * as React from 'react';

import { QUOTA_MONTHLY_CAP } from '../etsy-erank-types';

export function QuotaBadge({
  period,
  used,
}: {
  period: string;
  used: number;
}): React.ReactElement {
  const remaining = QUOTA_MONTHLY_CAP - used;
  const low = remaining < QUOTA_MONTHLY_CAP * 0.2;
  return (
    <div
      className={`rounded-xl px-3 py-2 text-right ring-1 ${
        low ? 'bg-red-500/5 ring-red-500/30' : 'bg-card ring-border/60'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        eRank 配额 {period}
      </p>
      <p className="tabular-nums text-sm font-semibold">
        <span className={low ? 'text-red-600' : 'text-foreground'}>{used}</span>
        <span className="text-muted-foreground"> / {QUOTA_MONTHLY_CAP}</span>
        <span className="ml-2 text-xs font-normal text-muted-foreground">余 {remaining}</span>
      </p>
    </div>
  );
}
