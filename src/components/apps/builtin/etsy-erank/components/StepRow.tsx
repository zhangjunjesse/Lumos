'use client';

import * as React from 'react';

import type { StepState } from '../etsy-erank-types';
import { StepBadge } from './StepBadge';

interface Props {
  index: number;
  title: string;
  state: StepState;
  last?: boolean;
  children?: React.ReactNode;
}

/** 纵向 stepper 单步:左序号+连接线,右标题+状态徽章+展开内容 */
export function StepRow({ index, title, state, last, children }: Props): React.ReactElement {
  const blocked = state === 'blocked';
  const failed = state === 'failed';
  const skipped = state === 'skipped';
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${
            state === 'done'
              ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30'
              : blocked
                ? 'bg-amber-500/10 text-amber-600 ring-amber-500/40'
                : failed
                  ? 'bg-red-500/10 text-red-600 ring-red-500/40'
                  : skipped
                    ? 'bg-muted/30 text-muted-foreground ring-border line-through'
                    : 'bg-muted/50 text-muted-foreground ring-border'
          }`}
        >
          {index}
        </div>
        {!last && <div className="my-1 w-px flex-1 bg-border" />}
      </div>
      <div className={`flex-1 pb-6 ${last ? 'pb-0' : ''}`}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <StepBadge state={state} />
        </div>
        {children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
