'use client';

import * as React from 'react';

import { CANDIDATES } from '../mock-data';
import type { Grade } from '../etsy-erank-types';

const GRADE: Record<Grade, { label: string; cls: string }> = {
  A: { label: 'A', cls: 'text-emerald-700 bg-emerald-500/10 ring-emerald-500/30' },
  B: { label: 'B', cls: 'text-sky-700 bg-sky-500/10 ring-sky-500/30' },
  C: { label: 'C', cls: 'text-amber-700 bg-amber-500/10 ring-amber-500/30' },
  drop: { label: '✗', cls: 'text-red-700 bg-red-500/10 ring-red-500/30' },
};

const COLS = 'grid-cols-[44px_1fr_repeat(5,52px)_56px]';

/** ⑤ 打分产物:内联在 stepper ⑤ 步骤下。只读真实行,缺数据标证据不足。 */
export function OpportunityTable(): React.ReactElement {
  const [open, setOpen] = React.useState<string | null>('c-lace');
  return (
    <div className="mt-2 overflow-hidden rounded-xl bg-background ring-1 ring-border">
      <div
        className={`grid ${COLS} gap-2 border-b px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground`}
      >
        <span>档</span><span>机会词</span><span>月搜</span><span>竞争</span>
        <span>KD</span><span>CTR</span><span>趋势</span><span />
      </div>
      {CANDIDATES.map((c) => (
        <div key={c.id} className="border-b last:border-0">
          <div className={`grid ${COLS} items-center gap-2 px-3 py-2 text-sm tabular-nums`}>
            <span
              className={`rounded px-1 py-0.5 text-center text-xs ring-1 ${GRADE[c.grade].cls}`}
            >
              {GRADE[c.grade].label}
            </span>
            <span className="truncate font-medium text-foreground">{c.keyword}</span>
            <span className="text-foreground">{c.metric.searches}</span>
            <span className="text-foreground">{c.metric.competition.toLocaleString()}</span>
            <span className="text-foreground">{c.metric.kd}</span>
            <span className="text-foreground">{c.metric.ctr}</span>
            <span className="truncate text-xs">{c.metric.trend}</span>
            <button
              type="button"
              onClick={() => setOpen(open === c.id ? null : c.id)}
              className="text-xs hover:text-foreground"
            >
              {open === c.id ? '收起' : '展开'}
            </button>
          </div>
          {open === c.id && (
            <div className="space-y-1 bg-muted/40 px-3 py-2 text-xs text-foreground">
              <p className="font-mono text-muted-foreground">
                证据链(keyword_metrics 真实行 · source:{c.metric.source}):点击{c.metric.clicks} KD{c.metric.kd} CTR{c.metric.ctr} 趋势{c.metric.trend}
              </p>
              <p>为什么:{c.reason}</p>
              <p>对应产品:{c.productGuess} · 时机:{c.seasonality}</p>
              {!c.evidenceSufficient && (
                <p className="text-red-600">证据不足:不出 A/B/C 结论,不硬立项</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
