'use client';

// demo 状态机(纯前端,无后端)。两级:轮次列表 → 单轮流水线。
// 机会表/验证卡/brief 不是并列页,是流程产出,内联在 stepper 里。
// 配额台账/设置收进右上角抽屉,不占主导航。

import * as React from 'react';

import {
  QUOTA_MONTHLY_CAP,
  type Executor,
  type ManualValidation,
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
  VALIDATIONS,
} from './mock-data';
import type { QuotaEntry } from './etsy-erank-types';

/** 顶层只有两态:轮次列表 / 单轮工作区。无 tab。 */
export type View = 'runs' | 'current';

interface State {
  view: View;
  activeRunId: string;
  executor: Executor;
  profileConfigured: boolean;
  steps: Record<StepId, StepState>;
  quotaUsed: number;
  ledger: QuotaEntry[];
  candidatesReady: boolean;
  pasteText: string;
  validations: Record<string, ManualValidation>;
  settingsOpen: boolean; // 右上角抽屉(配额台账 + 设置)
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
  | { t: 'toggle-settings'; v: boolean };

const initialValidations: Record<string, ManualValidation> = Object.fromEntries(
  VALIDATIONS.map((v) => [v.candidateId, structuredClone(v)]),
);

const initialState: State = {
  view: 'runs',
  activeRunId: ACTIVE_RUN_ID,
  executor: 'paste',
  profileConfigured: false, // 展示 AdsPower「未配置」缺口
  steps: {
    huntground: 'done', seed: 'done', converge: 'done',
    verify: 'blocked', score: 'pending', manual: 'pending',
  },
  quotaUsed: QUOTA_USED_BEFORE,
  ledger: [...QUOTA_LEDGER],
  candidatesReady: false,
  pasteText: '',
  validations: initialValidations,
  settingsOpen: false,
};

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
      // 不跳页:机会表内联在 ⑤ 步骤下,流程顺着往下走
      return {
        ...s,
        steps: { ...s.steps, score: 'done', manual: 'blocked' },
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
    default:
      return s;
  }
}

interface Ctx extends State {
  dispatch: React.Dispatch<Action>;
  remaining: number;
  canScore: boolean;
}

const EtsyErankContext = React.createContext<Ctx | null>(null);

export function EtsyErankProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, initialState);
  const value: Ctx = {
    ...state,
    dispatch,
    remaining: QUOTA_MONTHLY_CAP - state.quotaUsed,
    canScore: state.steps.verify === 'done',
  };
  return <EtsyErankContext.Provider value={value}>{children}</EtsyErankContext.Provider>;
}

export function useEtsyErank(): Ctx {
  const ctx = React.useContext(EtsyErankContext);
  if (!ctx) throw new Error('useEtsyErank must be used within EtsyErankProvider');
  return ctx;
}

export type { Verdict };
