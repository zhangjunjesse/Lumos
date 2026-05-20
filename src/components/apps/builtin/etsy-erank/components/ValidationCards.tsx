'use client';

import * as React from 'react';

import { CANDIDATES } from '../mock-data';
import type { ManualValidation, Verdict } from '../etsy-erank-types';
import { useEtsyErank } from '../use-demo-state';

const VERDICTS: { v: Exclude<Verdict, null>; label: string }[] = [
  { v: 'pass', label: '过' },
  { v: 'reject', label: '否' },
  { v: 'insufficient', label: '证据不足' },
];

function ValidationCard({
  mv,
  keyword,
  grade,
}: {
  mv: ManualValidation;
  keyword: string;
  grade: string;
}): React.ReactElement {
  const { dispatch } = useEtsyErank();
  const save = (patch: Partial<ManualValidation>) =>
    dispatch({ t: 'save-validation', id: mv.candidateId, patch });

  return (
    <div className="space-y-3 rounded-xl bg-background p-3 ring-1 ring-border text-foreground">
      <div className="flex items-center gap-2">
        <span className="rounded px-1.5 py-0.5 text-xs ring-1 ring-border">{grade}</span>
        <span className="font-semibold">{keyword}</span>
        <span className="text-xs text-muted-foreground">
          {mv.verdict ? '已判定' : '待人工验证'}
        </span>
      </div>

      <div className="space-y-1.5">
        {mv.checks.map((c, i) => (
          <div key={c.key} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <span className="font-medium">{c.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">{c.focus}</span>
            </div>
            <div className="flex shrink-0 gap-1">
              {(['pass', 'fail'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    const checks = mv.checks.map((x, j) =>
                      j === i ? { ...x, result: x.result === r ? null : r } : x,
                    );
                    save({ checks });
                  }}
                  className={`rounded px-2 py-0.5 text-xs ring-1 ${
                    c.result === r
                      ? r === 'pass'
                        ? 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/30'
                        : 'bg-red-500/15 text-red-700 ring-red-500/30'
                      : 'ring-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {r === 'pass' ? '过' : '否'}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          value={mv.competitorRef}
          onChange={(e) => save({ competitorRef: e.target.value })}
          placeholder="竞品 ID / 链接"
          className="rounded-lg border bg-background px-2 py-1.5 text-xs"
        />
        <input
          value={mv.priceBand}
          onChange={(e) => save({ priceBand: e.target.value })}
          placeholder="价格带"
          className="rounded-lg border bg-background px-2 py-1.5 text-xs"
        />
      </div>
      <textarea
        value={mv.notes}
        onChange={(e) => save({ notes: e.target.value })}
        placeholder="备注(评论痛点 / 风险 / 利润观察)"
        className="h-14 w-full rounded-lg border bg-background p-2 text-xs"
      />

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">结论:</span>
        {VERDICTS.map((x) => (
          <button
            key={x.v}
            type="button"
            onClick={() => save({ verdict: x.v })}
            className={`rounded-lg px-3 py-1 text-xs font-medium ring-1 ${
              mv.verdict === x.v
                ? 'bg-foreground text-background ring-transparent'
                : 'ring-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ⑥ 人工闸产物:内联在 stepper ⑥ 步骤下。AI 不可代填。 */
export function ValidationCards(): React.ReactElement {
  const { validations, steps } = useEtsyErank();
  const targets = CANDIDATES.filter((c) => c.grade === 'A' || c.grade === 'B');
  return (
    <div className="mt-2 space-y-2">
      <div className="rounded-lg bg-amber-500/5 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-500/20">
        AI 不可代填 verdict。任一卡未判定 → ⑥ 维持卡住,不生成产品 brief。当前 ⑥:
        {steps.manual === 'done' ? '已完成' : '卡住·等人工'}
      </div>
      {targets.map((c) => (
        <ValidationCard
          key={c.id}
          mv={validations[c.id]}
          keyword={c.keyword}
          grade={c.grade}
        />
      ))}
    </div>
  );
}
