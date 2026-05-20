'use client';

import * as React from 'react';

import { BRIEF } from '../mock-data';

const ROWS: [string, keyof typeof BRIEF][] = [
  ['目标人群', 'target'],
  ['使用场景', 'useCase'],
  ['价值主张', 'valueProp'],
  ['成本(待补)', 'costNote'],
  ['利润(初步)', 'profitNote'],
  ['下一步', 'action'],
];

/** 流程终点产物:A/B 级人工验证全判定后才出立项卡。 */
export function BriefCard(): React.ReactElement {
  return (
    <div className="rounded-2xl bg-card p-5 ring-1 ring-border/60">
      <div className="flex items-center gap-2">
        <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-500/30">
          {BRIEF.grade} 档立项
        </span>
        <span className="font-semibold">{BRIEF.keyword}</span>
      </div>
      <dl className="mt-4 space-y-2 text-sm">
        {ROWS.map(([label, key]) => (
          <div key={key} className="grid grid-cols-[88px_1fr] gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{BRIEF[key]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        范围止于立项 brief:供应链确认 / 定价定稿 / listing 文案 / 上新排期 不在本应用闭环。
      </p>
    </div>
  );
}
