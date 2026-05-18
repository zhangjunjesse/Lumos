import {
  callKnowledgeObjectModel,
  getKnowledgeDefaultModel,
  isKnowledgeEnhancementUnavailableError,
} from '@/lib/knowledge/llm';
import {
  EXTRACT_SYSTEM,
  RECONCILE_SYSTEM,
  decisionSchema,
  extractionSchema,
  type ExtractedFact,
  type ReconcileDecisions,
} from './extraction-schema';
import {
  createMemoryV2Entry,
  listMemoryV2Entries,
  setMemoryV2Embedding,
  setMemoryV2Status,
  updateMemoryV2Entry,
} from './store';
import {
  bufferToVec,
  cosineSimilarity,
  embedMemoryEntryText,
  embedMemoryVector,
  memoryEmbedText,
} from './vector';
import { processMemoryV2ResourceSecrets } from './resource-secrets';
import type { MemoryV2Entry, MemoryV2Kind, MemoryV2ScopeType } from './types';

// 自动行动记忆：用 LLM 做 Mem0 式「抽取 → 逐条 reconcile(ADD/UPDATE/NOOP/DELETE)」，
// 替代原来的正则矿机。没有可用文本模型时一条都不记（绝不回退正则）。

export interface MemoryV2MessageInput {
  role: 'user' | 'assistant';
  text: string;
}

export interface MemoryV2ExtractionContext {
  sessionId: string;
  projectPath: string;
  ownerModule: string;
}

export interface MemoryV2ExtractionOutcome {
  available: boolean;
  reason: string;
  added: MemoryV2Entry[];
  updated: MemoryV2Entry[];
  archivedIds: string[];
  noop: number;
  skipped: number;
}

function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function resolveScope(
  scope: ExtractedFact['scope'],
  ctx: MemoryV2ExtractionContext,
): { scopeType: MemoryV2ScopeType; scopeKey: string } | null {
  if (scope === 'user') return { scopeType: 'user', scopeKey: 'default' };
  if (scope === 'project') {
    if (!ctx.projectPath) return null;
    return { scopeType: 'project', scopeKey: ctx.projectPath };
  }
  return { scopeType: 'session', scopeKey: ctx.sessionId };
}

function buildExtractPrompt(messages: MemoryV2MessageInput[], ctx: MemoryV2ExtractionContext): string {
  const convo = messages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${clip(m.text, 1200)}`)
    .join('\n');
  const scopeHint = ctx.projectPath
    ? `当前对话属于项目：${ctx.projectPath}`
    : '当前对话没有绑定项目（不要产出 project 作用域的事实）。';
  return `${scopeHint}\n\n对话：\n${convo}`;
}

function buildReconcilePrompt(
  facts: ExtractedFact[],
  peersByFact: Map<number, MemoryV2Entry[]>,
): string {
  const blocks = facts.map((fact, index) => {
    const peers = peersByFact.get(index) || [];
    const peerLines = peers.length
      ? peers.map((p) => `  - id=${p.id} | ${clip(p.title, 80)} | ${clip(p.body, 240)}`).join('\n')
      : '  （无同类同作用域的现有记忆）';
    return [
      `# 候选事实 ${index}（kind=${fact.kind} scope=${fact.scope}）`,
      `标题：${fact.title}`,
      `内容：${fact.body}`,
      '同类现有记忆：',
      peerLines,
    ].join('\n');
  });
  return blocks.join('\n\n');
}

function tagsFor(kind: MemoryV2Kind): string[] {
  return ['llm-extracted', kind];
}

async function callExtraction(prompt: string): Promise<ExtractedFact[]> {
  const result = await callKnowledgeObjectModel({
    model: getKnowledgeDefaultModel(),
    system: EXTRACT_SYSTEM,
    prompt,
    schema: extractionSchema,
    maxTokens: 2048,
    timeoutMs: 20000,
  });
  return result.facts.filter((fact) => fact.confidence >= 0.55);
}

async function callReconcile(
  facts: ExtractedFact[],
  peersByFact: Map<number, MemoryV2Entry[]>,
): Promise<ReconcileDecisions> {
  const result = await callKnowledgeObjectModel({
    model: getKnowledgeDefaultModel(),
    system: RECONCILE_SYSTEM,
    prompt: buildReconcilePrompt(facts, peersByFact),
    schema: decisionSchema,
    maxTokens: 2048,
    timeoutMs: 20000,
  });
  return result.decisions;
}

function persistFact(
  fact: ExtractedFact,
  scope: { scopeType: MemoryV2ScopeType; scopeKey: string },
  ctx: MemoryV2ExtractionContext,
  override?: { title?: string; body?: string },
): { title: string; body: string; sensitivity: MemoryV2Entry['sensitivity']; secretRef?: string } {
  const title = clip(override?.title || fact.title, 120);
  const rawBody = clip(override?.body || fact.body, 2000);
  if (fact.kind !== 'resource') {
    return { title, body: rawBody, sensitivity: 'normal' };
  }
  const redacted = processMemoryV2ResourceSecrets(rawBody, {
    scopeType: scope.scopeType,
    scopeKey: scope.scopeKey,
    ownerModule: ctx.ownerModule,
    sessionId: ctx.sessionId,
    projectPath: ctx.projectPath,
    sourceType: 'memory_v2_sleep_auto_summary',
    sourceId: ctx.sessionId,
  });
  return { title, body: redacted.text, sensitivity: redacted.sensitivity, secretRef: redacted.secretRefs[0] };
}

const PEER_SIM_THRESHOLD = 0.45;

// reconcile 的候选 peers 按语义相似在「同 kind、跨所有作用域」里取——
// 这样 user/session 各存一份的同一资源会被发现，交给 LLM 判 UPDATE/NOOP/DELETE。
async function gatherPeers(
  fact: ExtractedFact,
  scope: { scopeType: MemoryV2ScopeType; scopeKey: string } | null,
): Promise<MemoryV2Entry[]> {
  const sameScope = scope
    ? listMemoryV2Entries({
      status: 'active',
      kind: fact.kind,
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      limit: 12,
    })
    : [];
  const factVec = await embedMemoryVector(memoryEmbedText(fact.title, fact.body));
  if (!factVec) return sameScope;
  const ranked = listMemoryV2Entries({ status: 'active', kind: fact.kind, limit: 100 })
    .map((entry) => {
      const vec = bufferToVec(entry.embedding);
      return { entry, sim: vec ? cosineSimilarity(factVec, vec) : 0 };
    })
    .filter((item) => item.sim >= PEER_SIM_THRESHOLD)
    .sort((a, b) => b.sim - a.sim)
    .map((item) => item.entry);
  const seen = new Set<string>();
  const merged: MemoryV2Entry[] = [];
  for (const entry of [...ranked, ...sameScope]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
    if (merged.length >= 12) break;
  }
  return merged;
}

export async function extractAndReconcileMemoryV2(
  messages: MemoryV2MessageInput[],
  ctx: MemoryV2ExtractionContext,
): Promise<MemoryV2ExtractionOutcome> {
  const empty: MemoryV2ExtractionOutcome = {
    available: true, reason: '', added: [], updated: [], archivedIds: [], noop: 0, skipped: 0,
  };
  if (messages.length === 0) return { ...empty, reason: 'no_messages' };

  let facts: ExtractedFact[];
  try {
    facts = await callExtraction(buildExtractPrompt(messages, ctx));
  } catch (error) {
    if (isKnowledgeEnhancementUnavailableError(error)) {
      return { ...empty, available: false, reason: 'llm_unavailable' };
    }
    return { ...empty, available: false, reason: error instanceof Error ? error.message : 'extract_failed' };
  }
  if (facts.length === 0) return { ...empty, reason: 'no_facts' };

  const scopes = facts.map((fact) => resolveScope(fact.scope, ctx));
  const peersByFact = new Map<number, MemoryV2Entry[]>();
  for (let index = 0; index < facts.length; index += 1) {
    if (!scopes[index]) continue;
    peersByFact.set(index, await gatherPeers(facts[index], scopes[index]));
  }

  let decisions: ReconcileDecisions;
  try {
    decisions = await callReconcile(facts, peersByFact);
  } catch (error) {
    return { ...empty, available: false, reason: error instanceof Error ? error.message : 'reconcile_failed' };
  }

  const outcome: MemoryV2ExtractionOutcome = { ...empty };
  const decisionByFact = new Map(decisions.map((d) => [d.factIndex, d]));

  facts.forEach((fact, index) => {
    const scope = scopes[index];
    if (!scope) { outcome.skipped += 1; return; }
    const peers = peersByFact.get(index) || [];
    const decision = decisionByFact.get(index) || { factIndex: index, op: 'ADD' as const };
    const target = decision.targetId ? peers.find((p) => p.id === decision.targetId) : undefined;

    if (decision.op === 'NOOP') { outcome.noop += 1; return; }

    if (decision.op === 'DELETE') {
      if (target) { setMemoryV2Status(target.id, 'archived'); outcome.archivedIds.push(target.id); }
      else outcome.skipped += 1;
      return;
    }

    if (decision.op === 'UPDATE' && target) {
      const p = persistFact(fact, scope, ctx, { title: decision.title, body: decision.body });
      const updated = updateMemoryV2Entry(target.id, {
        title: p.title,
        body: p.body,
        summary: clip(p.body, 240),
        importance: Math.max(target.importance, fact.importance),
        sensitivity: p.sensitivity,
        secretRef: p.secretRef,
      });
      if (updated) outcome.updated.push(updated);
      return;
    }

    // ADD：全新事实；UPDATE 但 targetId 无效时该事实仍是新的，按 ADD 落库
    const p = persistFact(fact, scope, ctx);
    outcome.added.push(createMemoryV2Entry({
      kind: fact.kind,
      scopeType: scope.scopeType,
      scopeKey: scope.scopeKey,
      ownerModule: ctx.ownerModule,
      status: 'active',
      title: p.title,
      body: p.body,
      summary: clip(p.body, 240),
      tags: tagsFor(fact.kind),
      sourceType: 'memory_v2_sleep_auto_summary',
      sourceId: `${ctx.sessionId}:${fact.kind}:${scope.scopeType}`,
      sessionId: ctx.sessionId,
      projectPath: ctx.projectPath,
      sensitivity: p.sensitivity,
      secretRef: p.secretRef,
      confidence: fact.confidence,
      importance: p.sensitivity !== 'normal' ? 5 : fact.importance,
      evidence: '睡眠 LLM 从新增对话提炼并对账。',
      metadata: { capture: 'sleep-llm-extraction', scope: fact.scope },
    }));
  });

  // 新建/更新的记忆立刻嵌入，新记忆当轮就能被语义召回（不必等睡眠回填）。
  for (const entry of [...outcome.added, ...outcome.updated]) {
    const buf = await embedMemoryEntryText(memoryEmbedText(entry.title, entry.body));
    if (buf) setMemoryV2Embedding(entry.id, buf);
  }

  return outcome;
}
