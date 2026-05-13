'use client';

import * as React from 'react';

import {
  STAGE_DESCRIPTION,
  type ResearchBriefRow,
  type ResearchEvidenceRow,
  type ResearchGoalRow,
  type ResearchQuestionRow,
  type ResearchReportRow,
  type ResearchRiskRow,
  type ResearchSourceRow,
  type ResearchStage,
} from '../deep-research-types';
import {
  BriefCard,
  EmptyHint,
  EvidenceList,
  GoalCard,
  QuestionList,
  ReportList,
  RiskList,
  SourceList,
} from './pipeline-panels';

export interface StageData {
  briefs: ResearchBriefRow[];
  goals: ResearchGoalRow[];
  questions: ResearchQuestionRow[];
  risks: ResearchRiskRow[];
  sources: ResearchSourceRow[];
  evidence: ResearchEvidenceRow[];
  reports: ResearchReportRow[];
}

export interface StageDef {
  title: string;
  stageKey: ResearchStage;
  summary: string;
  nextStage: ResearchStage;
  actionLabel: string;
  /** Index this stage occupies in STAGE_ORDER (0 = clarifying). */
  index: number;
  countLabel: (data: StageData) => { count: number; label: string };
  canAdvance: (data: StageData, currentIndex: number) => boolean;
  renderBody: (data: StageData) => React.ReactNode;
}

export const STAGE_DEFS: StageDef[] = [
  {
    title: '1. 需求澄清',
    stageKey: 'clarifying',
    summary: STAGE_DESCRIPTION.clarifying,
    nextStage: 'goal_review',
    actionLabel: '标记澄清完成 → 目标确认',
    index: 0,
    countLabel: ({ briefs }) => ({ count: briefs.length, label: '条澄清记录' }),
    canAdvance: ({ briefs }, currentIndex) => currentIndex === 0 && briefs.length > 0,
    renderBody: ({ briefs }) =>
      briefs.length === 0 ? (
        <EmptyHint text="尚未生成澄清记录。在主对话窗口与 AI 多轮对话，把读者 / 用途 / 范围 / 深度 / 长度 / 语气 / 审美样章对齐，然后把对话总结提交到 research_briefs。" />
      ) : (
        briefs.map((b) => <BriefCard key={b.id} brief={b} />)
      ),
  },
  {
    title: '2. 目标确认',
    stageKey: 'goal_review',
    summary: STAGE_DESCRIPTION.goal_review,
    nextStage: 'planning',
    actionLabel: '用户接受目标书 → 任务拆解',
    index: 1,
    countLabel: ({ goals }) => ({ count: goals.length, label: '份目标书' }),
    canAdvance: ({ goals }, currentIndex) => currentIndex === 1 && goals.length > 0,
    renderBody: ({ goals }) =>
      goals.length === 0 ? (
        <EmptyHint text="尚未产出目标书。基于已接受的澄清记录，AI 写出 SMART 目标 + 成功标准 + 明确不做 + 交付物清单，存入 research_goals。" />
      ) : (
        goals.map((g) => <GoalCard key={g.id} goal={g} />)
      ),
  },
  {
    title: '3. 任务拆解（研究问题树）',
    stageKey: 'planning',
    summary: STAGE_DESCRIPTION.planning,
    nextStage: 'risk_review',
    actionLabel: '完成拆解 → 风险分析',
    index: 2,
    countLabel: ({ questions }) => ({ count: questions.length, label: '个研究问题' }),
    canAdvance: ({ questions }, currentIndex) => currentIndex === 2 && questions.length > 0,
    renderBody: ({ questions }) =>
      questions.length === 0 ? (
        <EmptyHint text="尚未拆解研究问题。AI 把目标拆为 ≤8 顶级问题，每题含子问题 / 证据需求 / 验证标准，存入 research_questions。" />
      ) : (
        <QuestionList questions={questions} />
      ),
  },
  {
    title: '4. 难度与风险分析',
    stageKey: 'risk_review',
    summary: STAGE_DESCRIPTION.risk_review,
    nextStage: 'collecting',
    actionLabel: '完成风险评估 → 资料采集',
    index: 3,
    countLabel: ({ risks }) => ({ count: risks.length, label: '项风险' }),
    canAdvance: ({ risks }, currentIndex) => currentIndex === 3 && risks.length >= 3,
    renderBody: ({ risks }) =>
      risks.length === 0 ? (
        <EmptyHint text="尚未识别风险。至少识别 3 项（资料稀缺 / 付费墙 / 敏感话题 / 时效 / 配额耗尽等），并给出降级方案后才能推进。" />
      ) : (
        <RiskList risks={risks} />
      ),
  },
  {
    title: '5. 资料采集',
    stageKey: 'collecting',
    summary: STAGE_DESCRIPTION.collecting,
    nextStage: 'synthesizing',
    actionLabel: '资料就位 → 综合分析',
    index: 4,
    countLabel: ({ evidence }) => ({ count: evidence.length, label: '条证据' }),
    canAdvance: ({ evidence }, currentIndex) => currentIndex === 4 && evidence.length > 0,
    renderBody: ({ sources, evidence }) => (
      <>
        <SourceList sources={sources} />
        {evidence.length > 0 && <EvidenceList evidence={evidence.slice(0, 5)} />}
        {evidence.length === 0 && (
          <EmptyHint text="尚无证据。请在「调研任务 - 主对话」让 AI 用 deepsearch / 抖音 / bilibili / 知识库等并发采集；每条证据必须带 URL、摘要与置信度。" />
        )}
      </>
    ),
  },
  {
    title: '6. 综合分析',
    stageKey: 'synthesizing',
    summary: STAGE_DESCRIPTION.synthesizing,
    nextStage: 'outline_review',
    actionLabel: '完成综合分析 → 报告大纲',
    index: 5,
    countLabel: ({ questions }) => ({
      count: questions.filter((q) => q.status === 'synthesized').length,
      label: '个问题已综合',
    }),
    canAdvance: ({ questions }, currentIndex) =>
      currentIndex === 5 &&
      questions.length > 0 &&
      !questions.some((q) => q.status === 'needs_more_evidence' || q.status === 'collecting'),
    renderBody: () => (
      <EmptyHint text="对每个研究问题汇总证据写出 finding；证据 < 3 条 / 不同来源 时标 needs_more_evidence，绝不冒充完成。" />
    ),
  },
  {
    title: '7. 报告生成',
    stageKey: 'outline_review',
    summary: `${STAGE_DESCRIPTION.outline_review} ${STAGE_DESCRIPTION.drafting}`,
    nextStage: 'qa',
    actionLabel: '终稿就绪 → 自检验收',
    index: 6,
    countLabel: ({ reports }) => ({ count: reports.length, label: '个报告版本' }),
    canAdvance: ({ reports }, currentIndex) =>
      currentIndex >= 6 &&
      currentIndex <= 7 &&
      reports.filter((r) => r.kind === 'final').length > 0,
    renderBody: ({ reports }) =>
      reports.length === 0 ? (
        <EmptyHint text="先生成大纲（章节标题 + 每章对应研究问题 + 关键证据 id），用户接受后再写章节草稿；引用必须能链回 research_evidence。" />
      ) : (
        <ReportList reports={reports} />
      ),
  },
  {
    title: '8. 自检验收',
    stageKey: 'qa',
    summary: STAGE_DESCRIPTION.qa,
    nextStage: 'delivered',
    actionLabel: '用户最终接受 → 交付',
    index: 8,
    countLabel: ({ reports }) => ({
      count: reports.filter((r) => r.status === 'accepted').length,
      label: '个已验收报告',
    }),
    canAdvance: ({ reports }, currentIndex) =>
      currentIndex === 8 && reports.filter((r) => r.kind === 'final').length > 0,
    renderBody: () => (
      <EmptyHint text="跑引用完整性 / 未决问题清单 / 长度 / 问题树覆盖度自检；不通过回到 collecting 或 synthesizing。" />
    ),
  },
];
