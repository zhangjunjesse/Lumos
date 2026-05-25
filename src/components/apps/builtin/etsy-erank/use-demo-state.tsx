'use client';

// demo 状态机(纯前端,无后端)。两级:轮次列表 → 单轮流水线。
// 机会表/验证卡/brief 不是并列页,是流程产出,内联在 stepper 里。
// 配额台账/设置收进右上角抽屉,不占主导航。

import * as React from 'react';

import {
  QUOTA_MONTHLY_CAP,
  type EntryMode,
  type Executor,
  type ManualValidation,
  type RadarRun,
  type StepId,
  type StepState,
  type Verdict,
} from './etsy-erank-types';
import {
  ACTIVE_RUN_ID,
  CONVERGE_COUNT,
  QUOTA_PERIOD,
  QUOTA_USED_BEFORE,
  QUOTA_LEDGER,
  RUNS,
  VALIDATIONS,
} from './mock-data';
import type { QuotaEntry } from './etsy-erank-types';

/** 顶层只有两态:轮次列表 / 单轮工作区。无 tab。 */
export type View = 'runs' | 'current';

interface State {
  view: View;
  activeRunId: string;
  runs: RadarRun[];
  executor: Executor;
  profileConfigured: boolean;
  steps: Record<StepId, StepState>;
  quotaUsed: number;
  ledger: QuotaEntry[];
  candidatesReady: boolean;
  pasteText: string;
  validations: Record<string, ManualValidation>;
  settingsOpen: boolean; // 右上角抽屉(配额台账 + 设置)
  newRunOpen: boolean; // 新开一轮弹窗
}

type Action =
  | { t: 'open-run'; v: string }
  | { t: 'back' }
  | { t: 'executor'; v: Executor }
  | { t: 'profile'; v: boolean }
  | { t: 'paste'; v: string }
  | { t: 'verify' }
  | { t: 'score' }
  | { t: 'save-validation'; id: string; patch: Partial<ManualValidation> }
  | { t: 'toggle-settings'; v: boolean }
  | { t: 'toggle-new-run'; v: boolean }
  | {
      t: 'create-run';
      v: {
        label: string;
        entryMode: EntryMode;
        capabilities?: string[];
      };
    };

const initialValidations: Record<string, ManualValidation> = Object.fromEntries(
  VALIDATIONS.map((v) => [v.candidateId, structuredClone(v)]),
);

const initialState: State = {
  view: 'runs',
  activeRunId: ACTIVE_RUN_ID,
  runs: [...RUNS],
  executor: 'paste',
  profileConfigured: false, // 展示 AdsPower「未配置」缺口
  steps: {
    huntground: 'done', seed: 'done', converge: 'done',
    verify: 'blocked', score: 'pending', analyze: 'pending', manual: 'pending',
  },
  quotaUsed: QUOTA_USED_BEFORE,
  ledger: [...QUOTA_LEDGER],
  candidatesReady: false,
  pasteText: '',
  validations: initialValidations,
  settingsOpen: false,
  newRunOpen: false,
};

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}

function nowStamp(): string {
  const d = new Date();
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case 'open-run':
      return { ...s, activeRunId: a.v, view: 'current' };
    case 'back':
      return { ...s, view: 'runs' };
    case 'executor':
      return { ...s, executor: a.v };
    case 'profile':
      return { ...s, profileConfigured: a.v };
    case 'paste':
      return { ...s, pasteText: a.v };
    case 'verify': {
      // 配额闸:解析后才扣;余额不足保持 blocked(本 demo 余 150 ≥ 112)
      if (QUOTA_MONTHLY_CAP - s.quotaUsed < CONVERGE_COUNT) return s;
      const used = s.quotaUsed + CONVERGE_COUNT;
      return {
        ...s,
        steps: { ...s.steps, verify: 'done' },
        quotaUsed: used,
        ledger: [
          ...s.ledger,
          {
            period: QUOTA_PERIOD,
            step: 'OPP-2026-05 ④验真',
            debited: CONVERGE_COUNT,
            balanceAfter: QUOTA_MONTHLY_CAP - used,
            at: '05-19 10:31',
          },
        ],
      };
    }
    case 'score':
      // ⑤ AI 解读完成后,⑥ 商业分析自动 done(mock 已有数据);⑦ 人工验证 blocked
      return {
        ...s,
        steps: { ...s.steps, score: 'done', analyze: 'done', manual: 'blocked' },
        candidatesReady: true,
      };
    case 'save-validation': {
      const next = { ...s.validations, [a.id]: { ...s.validations[a.id], ...a.patch } };
      const allDone =
        Object.values(next).length > 0 &&
        Object.values(next).every((v) => v.verdict !== null);
      return {
        ...s,
        validations: next,
        steps: { ...s.steps, manual: allDone ? 'done' : 'blocked' },
      };
    }
    case 'toggle-settings':
      return { ...s, settingsOpen: a.v };
    case 'toggle-new-run':
      return { ...s, newRunOpen: a.v };
    case 'create-run': {
      // 生成新 run,加到列表顶部,切到该轮工作区。
      // steps 复用 demo 演示态(同样可走 ④→⑤→⑥);
      // ① 在视图层根据 entryMode 决定 done / skipped,不依赖 steps.huntground 真值。
      const id = `${a.v.label}-${Date.now().toString(36).slice(-4)}`;
      const run: RadarRun = {
        id,
        label: a.v.label,
        status: 'running',
        executor: s.executor, // 沿用当前默认,执行器在 ②④ 步骤卡片里切
        entryMode: a.v.entryMode,
        capabilities: a.v.capabilities,
        startedAt: nowStamp(),
        seedCount: 38,
        convergeCount: CONVERGE_COUNT,
        summary:
          a.v.entryMode === 'with_capability'
            ? `能力:${(a.v.capabilities ?? []).join(' / ')}`
            : '完全没想法 · 跳过 ①,② 抄市场顶部',
      };
      return {
        ...s,
        runs: [run, ...s.runs],
        activeRunId: id,
        view: 'current',
        newRunOpen: false,
      };
    }
    default:
      return s;
  }
}

interface Ctx extends State {
  dispatch: React.Dispatch<Action>;
  remaining: number;
  canScore: boolean;
  currentRun: RadarRun | undefined;
}

const EtsyErankContext = React.createContext<Ctx | null>(null);

export function EtsyErankProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  const value: Ctx = {
    ...state,
    dispatch,
    remaining: QUOTA_MONTHLY_CAP - state.quotaUsed,
    canScore: state.steps.verify === 'done',
    currentRun: state.runs.find((r) => r.id === state.activeRunId),
  };
  return <EtsyErankContext.Provider value={value}>{children}</EtsyErankContext.Provider>;
}

export function useEtsyErank(): Ctx {
  const ctx = React.useContext(EtsyErankContext);
  if (!ctx) throw new Error('useEtsyErank must be used within EtsyErankProvider');
  return ctx;
}

export type { Verdict };
