'use client';

import * as React from 'react';
import type { RadarStepRow } from '@/lib/etsy-erank/types';

interface EmptyStepStateProps {
  step: RadarStepRow | null;
  /** 这一步未跑时的提示语,如"等待 ⑤ AI 解读跑完" */
  pendingHint: string;
  /** 这一步在跑时的提示语,如"正在抓 eRank 种子,请等待…" */
  runningHint?: string;
}

export function EmptyStepState({ step, pendingHint, runningHint }: EmptyStepStateProps): React.ReactElement {
  const state = step?.state ?? 'pending';

  if (state === 'running') {
    return (
      <div className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-50/40 p-6 text-center text-xs text-amber-800 dark:bg-amber-950/20">
        <div className="font-medium">运行中…</div>
        <p className="mt-1">{runningHint ?? '正在跑,完成后会自动刷新数据。'}</p>
        {step && step.progressTotal > 0 && (
          <div className="mt-2 text-[10px] tabular-nums">{step.progressDone} / {step.progressTotal}</div>
        )}
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="rounded-2xl border border-dashed border-red-500/40 bg-red-50/40 p-6 text-center text-xs text-red-800 dark:bg-red-950/20">
        <div className="font-medium">这一步失败了</div>
        {step?.errorMessage && <p className="mt-1 break-all opacity-90">{step.errorMessage.slice(0, 240)}</p>}
        <p className="mt-2 text-[10px] opacity-80">点上面&ldquo;重跑&rdquo;按钮重试,或检查 AdsPower / LLM 是否就绪。</p>
      </div>
    );
  }

  if (state === 'skipped') {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-6 text-center text-xs text-muted-foreground">
        已跳过(本轮 entryMode 决定的)
      </div>
    );
  }

  // pending / blocked / done(数据为空)
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
      <div className="font-medium text-foreground">还没数据</div>
      <p className="mt-1">{pendingHint}</p>
    </div>
  );
}
