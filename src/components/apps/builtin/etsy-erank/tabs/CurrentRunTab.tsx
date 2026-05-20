'use client';

import * as React from 'react';

import { CONVERGE_COUNT, CONVERGE_PREVIEW, HUNTGROUND, SEEDS } from '../mock-data';
import { useEtsyErank } from '../use-demo-state';
import { StepRow } from '../components/StepRow';
import { VerifyStep } from '../components/VerifyStep';
import { ExecutorToggle } from '../components/ExecutorToggle';
import { OpportunityTable } from '../components/OpportunityTable';
import { ValidationCards } from '../components/ValidationCards';
import { BriefCard } from '../components/BriefCard';

function seedBySource() {
  const m = new Map<string, number>();
  for (const s of SEEDS) m.set(s.sourceTool, (m.get(s.sourceTool) ?? 0) + 1);
  return [...m.entries()].map(([k, v]) => `${k} ${v}`).join(' · ');
}

/** 单轮工作区 = 一条纵向流水线。产物跟着步骤内联长出来,不跳页。 */
export function CurrentRunTab(): React.ReactElement {
  const { activeRunId, steps, canScore, dispatch } = useEtsyErank();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => dispatch({ t: 'back' })}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 雷达轮次
        </button>
        <span className="font-semibold tabular-nums">{activeRunId}</span>
        <ExecutorToggle />
      </div>

      <div className="rounded-2xl bg-card p-5 ring-1 ring-border/60">
        <StepRow index={1} title="① 圈猎场(AI)" state={steps.huntground}>
          <ul className="space-y-0.5">
            {HUNTGROUND.map((h) => (
              <li key={h.dir}>
                <span className="text-foreground">{h.dir}</span> — {h.why}
              </li>
            ))}
          </ul>
        </StepRow>

        <StepRow index={2} title="② 采种子(零配额)" state={steps.seed}>
          {SEEDS.length} 类原始种子,来源:{seedBySource()}(免费区抄,不动脑)
        </StepRow>

        <StepRow index={3} title="③ AI 收敛" state={steps.converge}>
          <p>
            {CONVERGE_COUNT} 词 <span className="text-emerald-600">≤120 ✓</span> · 可直贴
            Bulk(不含编造搜索量)
          </p>
          <p className="mt-1 truncate font-mono text-xs">
            {CONVERGE_PREVIEW.join(', ')} … 共 {CONVERGE_COUNT} 词
          </p>
        </StepRow>

        <StepRow index={4} title="④ Bulk 验真(配额闸)" state={steps.verify}>
          <VerifyStep />
        </StepRow>

        <StepRow index={5} title="⑤ AI 打分" state={steps.score}>
          {steps.score === 'done' ? (
            <OpportunityTable />
          ) : canScore ? (
            <div className="space-y-2">
              <p>只用 ④ 表里真实数字,缺数据降级不补数。</p>
              <button
                type="button"
                onClick={() => dispatch({ t: 'score' })}
                className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
              >
                运行 AI 打分(A/B/C)
              </button>
            </div>
          ) : (
            <span className="text-muted-foreground">待跑 · 依赖 ④ 回灌真实数据</span>
          )}
        </StepRow>

        <StepRow index={6} title="⑥ 人工验证(人工闸)" state={steps.manual} last>
          {steps.score === 'done' ? (
            <ValidationCards />
          ) : (
            <span className="text-muted-foreground">待跑 · 依赖 ⑤ 打分</span>
          )}
        </StepRow>
      </div>

      {steps.manual === 'done' && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground">立项产出</h2>
          <BriefCard />
        </div>
      )}
    </div>
  );
}
