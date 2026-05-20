import { z } from 'zod';
import {
  callKnowledgeObjectModel,
  getKnowledgeDefaultModel,
  isKnowledgeEnhancementUnavailableError,
} from '@/lib/knowledge/llm';
import { createMemoryV2Entry, getMemoryV2EntryBySource, updateMemoryV2Entry } from './store';
import {
  createMemoryV2ImprovementCandidate,
  getImprovementByFingerprint,
  getMemoryV2ImprovementCandidate,
  updateMemoryV2ImprovementCandidate,
  type MemoryV2ImprovementCandidate,
} from './self-improvement';
import { findDailyReviewSession, type DigestEvent, type DigestInsight } from './daily-review-store';
import type { MemoryV2Entry, MemoryV2Input, MemoryV2Kind, MemoryV2ScopeType } from './types';

// 把"每日复盘"的事件/洞察接到 Lumos 已有系统，按需求/洞察的确定性编号强关联：
// - 事件「不足」→ 进化建议（memory_v2_improvement_candidates，复用能力生成器链路）
// - 事件 → 沉淀经验 / 洞察 → 沉淀（memory_v2_entries）
// 同一编号命中即更新（重新生成覆盖、不产重复）；带 memory-v2 前缀 owner_module 防自噬（底线③）。

export type ActionStatus = 'ok' | 'unavailable' | 'error';

const DAILY_REVIEW_OWNER = 'memory-v2-daily-review';
const DAILY_REVIEW_SOURCE = 'memory_v2_daily_review';

const improvementFp = (sessionId: string, eventId: string) => `daily-review:${sessionId}:${eventId}`;
const experienceSourceId = (sessionId: string, eventId: string) =>
  `daily-review:${sessionId}:${eventId}:experience`;
const insightSourceId = (sessionId: string, insightId: string) =>
  `daily-review:${sessionId}:${insightId}:insight`;

function classify(e: unknown): { status: 'unavailable' | 'error'; reason: string } {
  if (isKnowledgeEnhancementUnavailableError(e)) return { status: 'unavailable', reason: 'llm_unavailable' };
  return { status: 'error', reason: e instanceof Error ? e.message : String(e) };
}

function eventText(ev: DigestEvent): string {
  return [
    `需求：${ev.requirement}`,
    `执行过程：${ev.process || '（无）'}`,
    `结果：${ev.outcome || '（无）'}`,
    `不足：${ev.shortcomings.length ? ev.shortcomings.join('；') : '（无）'}`,
  ].join('\n');
}

// 命中确定性 sourceId 就更新，否则新建（带 owner_module 防自噬）。
function upsertEntry(
  sourceId: string,
  input: Omit<MemoryV2Input, 'sourceType' | 'sourceId' | 'ownerModule'>,
): MemoryV2Entry {
  const existing = getMemoryV2EntryBySource(DAILY_REVIEW_SOURCE, sourceId);
  if (existing) {
    return (
      updateMemoryV2Entry(existing.id, {
        kind: input.kind,
        title: input.title,
        body: input.body,
        summary: input.summary,
        tags: input.tags,
      }) || existing
    );
  }
  return createMemoryV2Entry({
    ...input,
    ownerModule: DAILY_REVIEW_OWNER,
    sourceType: DAILY_REVIEW_SOURCE,
    sourceId,
  });
}

const improvementSchema = z.object({
  candidateType: z.enum(['skill', 'mcp', 'workflow', 'prompt', 'rule']),
  title: z.string().trim().min(2).max(120),
  problem: z.string().trim().min(2).max(800),
  proposedCapability: z.string().trim().min(2).max(1000),
  riskLevel: z.enum(['low', 'medium', 'high']),
});

const IMPROVE_SYSTEM = `你在把 Lumos 一次会话里某个事件的"不足"转成一条可落地的自我进化建议。
- candidateType：skill / mcp / workflow / prompt / rule，选最能根治这个不足的一类。
- title：一句话点明要补什么能力或改什么。
- problem：这次到底哪里不行（只依据给定事实，不脑补）。
- proposedCapability：具体要做什么（补哪个工具/技能、改哪条提示词或规则），要可执行。
- riskLevel：low / medium / high。
只输出 JSON，无任何额外文字：
{"candidateType":"mcp","title":"补微信工作群消息查询 MCP","problem":"缺该工具导致需求无法完成且调错了咸鱼工具","proposedCapability":"实现可按群名+时间范围查询微信工作群消息的 MCP 工具","riskLevel":"medium"}`;

const reflectionSchema = z.object({
  title: z.string().trim().min(2).max(80),
  lesson: z.string().trim().min(2).max(800),
});

const REFLECT_SYSTEM = `把这次会话的某个事件提炼成一条可复用的经验/教训——不是复述本次，而是"下次遇到类似情况该怎么做"。
只输出 JSON，无任何额外文字：
{"title":"工具缺失时先承认","lesson":"所需工具不存在时应立刻明确告知做不到并指出缺什么，不要反复编造理由或让用户手工补数据"}`;

// 对「已解析的事件/洞察」执行（不查会话）。autoProcessSessions 每会话只解析一次后直接调这些 core。
async function generateEventImprovementCore(
  sessionId: string,
  ev: DigestEvent,
): Promise<{ status: ActionStatus; candidate?: MemoryV2ImprovementCandidate; error?: string }> {
  try {
    const p = await callKnowledgeObjectModel({
      model: getKnowledgeDefaultModel(),
      system: IMPROVE_SYSTEM,
      prompt: eventText(ev),
      schema: improvementSchema,
      maxTokens: 1024,
      timeoutMs: 45000,
    });
    const fingerprint = improvementFp(sessionId, ev.id);
    const fields = {
      candidateType: p.candidateType,
      title: p.title,
      problem: p.problem,
      proposedCapability: p.proposedCapability,
      riskLevel: p.riskLevel,
      evidence: eventText(ev),
      metadata: { source: 'daily-review-event', sessionId, eventId: ev.id },
    };
    const existing = getImprovementByFingerprint(fingerprint);
    const candidate = existing
      ? updateMemoryV2ImprovementCandidate(existing.id, fields)
        || getMemoryV2ImprovementCandidate(existing.id)
      : createMemoryV2ImprovementCandidate({ ...fields, fingerprint });
    return { status: 'ok', candidate };
  } catch (e) {
    const c = classify(e);
    return { status: c.status, error: c.reason };
  }
}

export async function generateEventImprovement(
  sessionId: string,
  eventIndex: number,
): Promise<{ status: ActionStatus; candidate?: MemoryV2ImprovementCandidate; error?: string }> {
  const ev = findDailyReviewSession(sessionId)?.session.digest?.events[eventIndex];
  if (!ev) return { status: 'error', error: 'event_not_found' };
  return generateEventImprovementCore(sessionId, ev);
}

async function generateEventExperienceCore(
  sessionId: string,
  ev: DigestEvent,
): Promise<{ status: ActionStatus; entry?: MemoryV2Entry; error?: string }> {
  try {
    const r = await callKnowledgeObjectModel({
      model: getKnowledgeDefaultModel(),
      system: REFLECT_SYSTEM,
      prompt: eventText(ev),
      schema: reflectionSchema,
      maxTokens: 1024,
      timeoutMs: 45000,
    });
    const entry = upsertEntry(experienceSourceId(sessionId, ev.id), {
      kind: 'reflection',
      scopeType: 'user',
      scopeKey: 'default',
      title: r.title,
      body: r.lesson,
      summary: r.lesson.slice(0, 200),
      tags: ['daily-review', 'reflection'],
      sessionId,
      importance: 3,
    });
    return { status: 'ok', entry };
  } catch (e) {
    const c = classify(e);
    return { status: c.status, error: c.reason };
  }
}

export async function generateEventExperience(
  sessionId: string,
  eventIndex: number,
): Promise<{ status: ActionStatus; entry?: MemoryV2Entry; error?: string }> {
  const ev = findDailyReviewSession(sessionId)?.session.digest?.events[eventIndex];
  if (!ev) return { status: 'error', error: 'event_not_found' };
  return generateEventExperienceCore(sessionId, ev);
}

function sinkInsightCore(
  sessionId: string,
  ins: DigestInsight,
): { status: ActionStatus; entry?: MemoryV2Entry; error?: string } {
  const kind: MemoryV2Kind =
    ins.type === '用户偏好' ? 'people' : ins.type === '能力缺口' ? 'capability' : 'reflection';
  const scopeType: MemoryV2ScopeType = kind === 'capability' ? 'main_agent' : 'user';
  const entry = upsertEntry(insightSourceId(sessionId, ins.id), {
    kind,
    scopeType,
    scopeKey: kind === 'capability' ? 'main' : 'default',
    title: ins.content.slice(0, 40),
    body: ins.content,
    summary: ins.content.slice(0, 200),
    tags: ['daily-review', ins.type],
    sessionId,
    importance: 3,
  });
  return { status: 'ok', entry };
}

export function sinkInsight(
  sessionId: string,
  insightIndex: number,
): { status: ActionStatus; entry?: MemoryV2Entry; error?: string } {
  const ins = findDailyReviewSession(sessionId)?.session.digest?.insights[insightIndex];
  if (!ins) return { status: 'error', error: 'insight_not_found' };
  return sinkInsightCore(sessionId, ins);
}

// 进页面回显：按编号查出每个需求/洞察已生成的进化建议与经验。
export function getSessionLinks(sessionId: string): {
  improvements: Record<string, MemoryV2ImprovementCandidate>;
  experiences: Record<string, MemoryV2Entry>;
  insightEntries: Record<string, MemoryV2Entry>;
} {
  const digest = findDailyReviewSession(sessionId)?.session.digest;
  const improvements: Record<string, MemoryV2ImprovementCandidate> = {};
  const experiences: Record<string, MemoryV2Entry> = {};
  const insightEntries: Record<string, MemoryV2Entry> = {};
  for (const ev of digest?.events || []) {
    const imp = getImprovementByFingerprint(improvementFp(sessionId, ev.id));
    if (imp) improvements[ev.id] = imp;
    const exp = getMemoryV2EntryBySource(DAILY_REVIEW_SOURCE, experienceSourceId(sessionId, ev.id));
    if (exp) experiences[ev.id] = exp;
  }
  for (const ins of digest?.insights || []) {
    const e = getMemoryV2EntryBySource(DAILY_REVIEW_SOURCE, insightSourceId(sessionId, ins.id));
    if (e) insightEntries[ins.id] = e;
  }
  return { improvements, experiences, insightEntries };
}

// 夜间自动化每晚的 LLM 调用上限（刹车，防 OpenClaw 式无界烧）。
// 只数会调 LLM 的动作（进化建议 + 沉淀经验）；沉淀洞察是确定性、不计入。
export const AUTO_ACTION_LLM_BUDGET = 40;

export interface AutoActionsResult {
  improvements: number;
  experiences: number;
  insights: number;
  llmCalls: number;
  stoppedByBudget: boolean;
}

// 夜间自动跑：每会话 → 有不足的事件出进化建议、每事件沉淀经验、每洞察沉淀。
// 全部幂等（命中编号即更新，不产重复）；超预算即停并如实标记。
export async function autoProcessSessions(
  sessionIds: string[],
  llmBudget: number,
): Promise<AutoActionsResult> {
  const r: AutoActionsResult = {
    improvements: 0, experiences: 0, insights: 0, llmCalls: 0, stoppedByBudget: false,
  };
  // 每会话只解析一次（findDailyReviewSession 会全表 JSON.parse），之后直接调 core，
  // 不再每事件/洞察重复解析。
  for (const sid of sessionIds) {
    const digest = findDailyReviewSession(sid)?.session.digest;
    if (!digest) continue;
    for (const ins of digest.insights) {
      if (sinkInsightCore(sid, ins).status === 'ok') r.insights += 1;
    }
    for (const ev of digest.events) {
      if (ev.shortcomings.length > 0) {
        if (r.llmCalls >= llmBudget) { r.stoppedByBudget = true; return r; }
        r.llmCalls += 1;
        if ((await generateEventImprovementCore(sid, ev)).status === 'ok') r.improvements += 1;
      }
      if (r.llmCalls >= llmBudget) { r.stoppedByBudget = true; return r; }
      r.llmCalls += 1;
      if ((await generateEventExperienceCore(sid, ev)).status === 'ok') r.experiences += 1;
    }
  }
  return r;
}
