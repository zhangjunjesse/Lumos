'use client';

import * as React from 'react';

import { HUNTGROUND } from '../mock-data';
import { useEtsyErank } from '../use-demo-state';
import { useRadarRunDetail, stepFor } from '../use-radar-runs';
import { VerifyStep } from '../components/VerifyStep';
import { VerifyStepLive } from '../components/VerifyStepLive';
import { ExecutorToggle } from '../components/ExecutorToggle';
import { ScoredNichesTable } from '../components/ScoredNichesTable';
import { ScoreStepLive } from '../components/ScoreStepLive';
import { AnalyzeStep } from '../components/AnalyzeStep';
import { AnalyzeStepLive } from '../components/AnalyzeStepLive';
import { ValidationCards } from '../components/ValidationCards';
import { BriefCard } from '../components/BriefCard';
import { SeedStep } from '../components/SeedStep';
import { ExpandStep } from '../components/ExpandStep';
import { HealthBanner } from '../components/HealthBanner';
import type { RadarStepRow, StepId, StepState } from '@/lib/etsy-erank/types';

const STEP_PILL: Array<{ id: StepId; label: string; name: string }> = [
  { id: 'huntground', label: '①', name: '圈猎场' },
  { id: 'seed', label: '②', name: '市场热词' },
  { id: 'converge', label: '③', name: '扩词' },
  { id: 'verify', label: '④', name: 'Bulk 验真' },
  { id: 'score', label: '⑤', name: 'AI 解读' },
  { id: 'analyze', label: '⑥', name: '商业分析' },
  { id: 'manual', label: '⑦', name: '人工验证' },
];

const STEP_PILL_CLS: Record<StepState, string> = {
  pending: 'text-muted-foreground',
  running: 'text-amber-700 animate-pulse',
  blocked: 'text-stone-600',
  done: 'text-emerald-700',
  failed: 'text-red-700',
  skipped: 'text-muted-foreground',
};

const STEP_DOT_CLS: Record<StepState, string> = {
  pending: 'bg-muted ring-border',
  running: 'bg-amber-500 ring-amber-500/40 animate-pulse',
  blocked: 'bg-stone-400 ring-stone-400/40',
  done: 'bg-emerald-500 ring-emerald-500/40',
  failed: 'bg-red-500 ring-red-500/40',
  skipped: 'bg-muted ring-border',
};

export function CurrentRunTab(): React.ReactElement {
  const { activeRunId, currentRun, steps: demoSteps, canScore, dispatch } = useEtsyErank();

  const { data: detail } = useRadarRunDetail(activeRunId, { pollMs: 2_000 });

  const isRealRun = !!detail?.run;
  const realSteps = detail?.steps ?? null;

  const blankSlate = (isRealRun ? detail!.run.entryMode : currentRun?.entryMode) === 'blank_slate';
  const capabilities = isRealRun ? detail!.run.capabilities : currentRun?.capabilities;

  const getStepState = (id: keyof typeof demoSteps): StepState => {
    if (isRealRun && realSteps) return stepFor(realSteps, id)?.state ?? 'pending';
    return demoSteps[id];
  };

  const huntgroundState: StepState = blankSlate ? 'skipped' : getStepState('huntground');
  const seedState = getStepState('seed');
  const convergeState = getStepState('converge');
  const verifyState = getStepState('verify');
  const scoreState = getStepState('score');
  const analyzeState = getStepState('analyze');
  const manualState = getStepState('manual');

  const stateByStep: Record<StepId, StepState> = {
    huntground: huntgroundState,
    seed: seedState,
    converge: convergeState,
    verify: verifyState,
    score: scoreState,
    analyze: analyzeState,
    manual: manualState,
  };

  // tab 列表(blank_slate 时跳过 ①)
  const visibleSteps = React.useMemo(
    () => STEP_PILL.filter((p) => !(blankSlate && p.id === 'huntground')),
    [blankSlate],
  );

  // 当前选中的 tab,默认第一个未完成的 step
  const firstUnfinished = React.useMemo<StepId>(() => {
    for (const p of visibleSteps) {
      const s = stateByStep[p.id];
      if (s !== 'done' && s !== 'skipped') return p.id;
    }
    return visibleSteps[0]?.id ?? 'seed';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSteps.map((p) => `${p.id}:${stateByStep[p.id]}`).join('|')]);

  const [activeTab, setActiveTab] = React.useState<StepId>(firstUnfinished);
  const [userPickedTab, setUserPickedTab] = React.useState(false);
  // 用户没手动选过 tab 时,跟着 firstUnfinished 自动跳;一旦手动选,就尊重选择
  React.useEffect(() => {
    if (!userPickedTab) setActiveTab(firstUnfinished);
  }, [firstUnfinished, userPickedTab]);

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
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <span className="truncate text-base font-semibold">{detail?.run.label ?? currentRun?.label ?? activeRunId}</span>
          <span className="font-mono text-[10px] text-muted-foreground" title={activeRunId}>
            {activeRunId.slice(0, 24)}{activeRunId.length > 24 ? '…' : ''}
          </span>
          {!isRealRun && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border">
              DEMO 数据
            </span>
          )}
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
            {blankSlate ? '起点:完全没想法' : '起点:有能力/方向'}
          </span>
        </div>
        <ExecutorToggle />
      </div>

      {isRealRun && <HealthBanner />}

      {isRealRun && detail?.run.config && (
        <CascadeBanner cascadeTo={detail.run.config.cascadeTo} steps={realSteps} />
      )}

      {/* Tab bar — sticky 顶部,避免内容滚动时丢失 */}
      <div className="sticky top-0 z-20 -mx-2 overflow-x-auto bg-background/95 px-2 backdrop-blur">
        <div className="flex gap-1 border-b border-border">
          {visibleSteps.map((p) => {
            const s = stateByStep[p.id];
            const active = activeTab === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => { setActiveTab(p.id); setUserPickedTab(true); }}
                className={`relative flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className={`inline-block size-1.5 rounded-full ring-2 ${STEP_DOT_CLS[s]}`} aria-hidden />
                <span className="font-medium">{p.label}</span>
                <span className={`text-xs ${active ? STEP_PILL_CLS[s] : ''}`}>{p.name}</span>
                {active && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-foreground" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="rounded-2xl bg-card p-5 ring-1 ring-border/60">
        {activeTab === 'huntground' && !blankSlate && (
          <StepContent index={1} title="圈猎场(AI)" state={huntgroundState}>
            <ul className="space-y-0.5 text-sm">
              {(capabilities && capabilities.length > 0
                ? capabilities.map((c: string) => ({ dir: c, why: 'AI 据此映射类目方向' }))
                : HUNTGROUND
              ).map((h) => (
                <li key={h.dir}>
                  <span className="text-foreground">{h.dir}</span> — <span className="text-muted-foreground">{h.why}</span>
                </li>
              ))}
            </ul>
          </StepContent>
        )}

        {activeTab === 'seed' && (
          <StepContent index={2} title="市场热词" state={seedState}>
            <SeedStep runId={activeRunId} isRealRun={isRealRun} step={isRealRun && realSteps ? stepFor(realSteps, 'seed') : null} />
          </StepContent>
        )}

        {activeTab === 'converge' && (
          <StepContent index={3} title="扩词" state={convergeState}>
            <ExpandStep runId={activeRunId} isRealRun={isRealRun} step={isRealRun && realSteps ? stepFor(realSteps, 'converge') : null} />
          </StepContent>
        )}

        {activeTab === 'verify' && (
          <StepContent index={4} title="Bulk 验真(配额闸)" state={verifyState}>
            {isRealRun
              ? <VerifyStepLive runId={activeRunId} isRealRun={isRealRun} step={isRealRun && realSteps ? stepFor(realSteps, 'verify') : null} defaultBatches={detail?.run.config.verifyMaxBatches} />
              : <VerifyStep />
            }
          </StepContent>
        )}

        {activeTab === 'score' && (
          <StepContent index={5} title="AI 解读" state={scoreState}>
            {isRealRun ? (
              <ScoreStepLive runId={activeRunId} isRealRun={isRealRun} step={isRealRun && realSteps ? stepFor(realSteps, 'score') : null} />
            ) : scoreState === 'done' ? (
              <ScoredNichesTable />
            ) : canScore ? (
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">grade 由 ④ code 已算定,⑤ LLM 只做翻译:keyword → 产品建议 + 机会/风险解读</p>
                <button
                  type="button"
                  onClick={() => dispatch({ t: 'score' })}
                  className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                >
                  跑 AI 解读(demo)
                </button>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">待跑 · 依赖 ④ 回灌真实数据</span>
            )}
          </StepContent>
        )}

        {activeTab === 'analyze' && (
          <StepContent index={6} title="商业分析(EHunt 深度)" state={analyzeState}>
            {isRealRun ? (
              <AnalyzeStepLive runId={activeRunId} isRealRun={isRealRun} step={isRealRun && realSteps ? stepFor(realSteps, 'analyze') : null} />
            ) : scoreState === 'done' ? (
              <AnalyzeStep />
            ) : (
              <span className="text-sm text-muted-foreground">待跑 · 依赖 ⑤ AI 解读 完成</span>
            )}
          </StepContent>
        )}

        {activeTab === 'manual' && (
          <StepContent index={7} title="人工验证(人工闸)" state={manualState}>
            {scoreState === 'done' ? (
              <ValidationCards />
            ) : (
              <span className="text-sm text-muted-foreground">待跑 · 依赖 ⑥ 商业分析</span>
            )}
            {manualState === 'done' && (
              <div className="mt-6 space-y-2 border-t pt-4">
                <h3 className="text-sm font-semibold text-muted-foreground">立项产出</h3>
                <BriefCard />
              </div>
            )}
          </StepContent>
        )}
      </div>
    </div>
  );
}

const STATE_LABEL: Record<StepState, string> = {
  pending: '待跑',
  running: '运行中',
  blocked: '阻塞',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const STATE_BADGE_CLS: Record<StepState, string> = {
  pending: 'bg-muted text-muted-foreground ring-border',
  running: 'bg-amber-500/15 text-amber-700 ring-amber-500/40 animate-pulse',
  blocked: 'bg-stone-500/10 text-stone-700 ring-stone-500/30',
  done: 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/40',
  failed: 'bg-red-500/15 text-red-700 ring-red-500/40',
  skipped: 'bg-muted/50 text-muted-foreground ring-border',
};

function StepContent({ index, title, state, children }: { index: number; title: string; state: StepState; children: React.ReactNode }): React.ReactElement {
  const numChar = ['①', '②', '③', '④', '⑤', '⑥', '⑦'][index - 1] ?? `${index}`;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold">{numChar} {title}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${STATE_BADGE_CLS[state]}`}>
          {STATE_LABEL[state]}
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}

const CASCADE_LABEL: Record<string, string> = {
  none: '不自动跑(全手动)',
  seed: '只跑 ②',
  converge: '② → ③',
  verify: '② → ③ → ④',
  score: '② → ③ → ④ → ⑤',
  analyze: '② → ③ → ④ → ⑤ → ⑥',
};

function CascadeBanner({ cascadeTo, steps }: { cascadeTo: string; steps: RadarStepRow[] | null }): React.ReactElement {
  const anyRunning = steps?.some((s) => s.state === 'running') ?? false;
  const targetSteps: Record<string, string[]> = {
    seed: ['seed'],
    converge: ['seed', 'converge'],
    verify: ['seed', 'converge', 'verify'],
    score: ['seed', 'converge', 'verify', 'score'],
    analyze: ['seed', 'converge', 'verify', 'score', 'analyze'],
  };
  const cascadeDone = !anyRunning && cascadeTo !== 'none' &&
    (targetSteps[cascadeTo] ?? []).every((id) => {
      const s = steps?.find((x) => x.stepId === id);
      return s?.state === 'done' || s?.state === 'failed' || s?.state === 'skipped';
    });

  return (
    <div className="rounded-lg border border-sky-500/30 bg-sky-50/40 px-3 py-2 text-[11px] text-sky-800 dark:bg-sky-950/20">
      创建时设置:<span className="font-semibold">自动跑 {CASCADE_LABEL[cascadeTo] ?? cascadeTo}</span>。
      {cascadeTo === 'none' && '所有 step 都等你手动点&ldquo;跑&rdquo;。'}
      {cascadeTo !== 'none' && cascadeDone && (
        <> · <span className="text-emerald-700">自动级联段已完成</span>,后续 step 点对应&ldquo;跑&rdquo;按钮手动启动(手动启的不会再自动级联,避免烧资源)。</>
      )}
      {cascadeTo !== 'none' && anyRunning && ' · 自动级联进行中…'}
    </div>
  );
}
