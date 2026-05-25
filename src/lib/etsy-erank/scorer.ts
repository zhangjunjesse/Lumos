// ⑤ AI 解读 — 调 Anthropic API(Lumos 配置的 Claude provider),按 niche 串行解读
// 对应 scripts/erank-score-niches.mjs 的核心逻辑

import { createHash } from 'node:crypto';
import { getDb } from '../db/connection';
import { getProvider } from '../db/providers';
import { callTextGen, loadTextGenProvider, describeTextGenProvider, type TextGenProviderHandle, type LoadTextGenProviderOptions } from '../llm/text-gen';
import { SCORER_SYSTEM_PROMPT } from './prompts';
import type { ApiProvider } from '@/types';

interface BulkRow {
  seed: string;
  keyword: string;
  searches: string;
  clicks: string;
  ctr: string;
  competition: string;
  kd: string;
  google: string;
  grade: string;
  sources_json: string;
}

interface NicheCandidate {
  keyword: string;
  grade: string;
  sources: string[];
  metrics: {
    searches: string;
    clicks: string;
    ctr: string;
    competition: string;
    kd: string;
    google: string;
  };
}

interface NicheInput {
  seed: string;
  candidates: NicheCandidate[];
}

interface LLMCandidateOutput {
  keyword: string;
  productGuess: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  nextStep: string;
}

interface LLMNicheOutput {
  seed: string;
  niche_summary: string;
  niche_risks: string[];
  candidates: LLMCandidateOutput[];
}

// SYSTEM_PROMPT 抽到 ./prompts.ts 共享,SettingsSheet UI 显示的就是这同一份
const SYSTEM_PROMPT = SCORER_SYSTEM_PROMPT;

// LLM provider 解析 + 调用全部走共享层 src/lib/llm/text-gen.ts。
// 名字保留 loadScoreProvider / describeScoreProvider / ScoreProviderHandle —— 历史调用方多。
export type ScoreProviderHandle = TextGenProviderHandle;
export type LoadProviderOptions = LoadTextGenProviderOptions;

export const loadScoreProvider = loadTextGenProvider;
export const describeScoreProvider = describeTextGenProvider;

// 给外部测试用(避免重复定义)
export function getProviderById(id: string): ApiProvider | undefined {
  return getProvider(id);
}

export function loadNiches(runId: string): NicheInput[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT seed, keyword, sources_json, searches, clicks, ctr, competition, kd, google, grade FROM radar_bulk WHERE run_id = ? AND grade IN ('A','B','C') ORDER BY seed, CASE grade WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END`)
    .all(runId) as BulkRow[];

  const niches = new Map<string, NicheInput>();
  for (const r of rows) {
    if (!niches.has(r.seed)) niches.set(r.seed, { seed: r.seed, candidates: [] });
    niches.get(r.seed)!.candidates.push({
      keyword: r.keyword,
      grade: r.grade,
      sources: JSON.parse(r.sources_json || '[]') as string[],
      metrics: {
        searches: r.searches,
        clicks: r.clicks,
        ctr: r.ctr,
        competition: r.competition,
        kd: r.kd,
        google: r.google,
      },
    });
  }
  return [...niches.values()].sort((a, b) => b.candidates.length - a.candidates.length);
}

function computeInputHash(niche: NicheInput, userDirection: string[]): string {
  const sorted = niche.candidates
    .map((c) => ({ keyword: c.keyword, grade: c.grade, metrics: c.metrics }))
    .sort((a, b) => a.keyword.localeCompare(b.keyword));
  const payload = JSON.stringify({ seed: niche.seed, candidates: sorted, user_direction: [...userDirection].sort() });
  return createHash('sha256').update(payload).digest('hex');
}

function loadCacheHashes(runId: string): Map<string, string> {
  const rows = getDb().prepare(`SELECT seed, input_hash FROM radar_scored_niches WHERE run_id = ?`).all(runId) as Array<{ seed: string; input_hash: string }>;
  return new Map(rows.map((r) => [r.seed, r.input_hash]));
}

async function callLLM(provider: ScoreProviderHandle, system: string, userPrompt: string): Promise<string> {
  return callTextGen(provider, { system, userPrompt, maxTokens: 4096 });
}

function extractJSON(text: string): unknown {
  let t = text.trim();
  if (t.startsWith('```')) t = t.replace(/^```(json)?\n?/, '').replace(/```\s*$/, '').trim();
  return JSON.parse(t);
}

function validateOutput(parsed: unknown, expectedSeed: string): LLMNicheOutput {
  if (!parsed || typeof parsed !== 'object') throw new Error('非对象');
  const obj = parsed as Record<string, unknown>;
  if (obj.seed !== expectedSeed) throw new Error(`seed 不匹配: ${obj.seed} vs ${expectedSeed}`);
  if (typeof obj.niche_summary !== 'string' || obj.niche_summary.length < 50) throw new Error('niche_summary 缺失或太短');
  if (!Array.isArray(obj.niche_risks)) throw new Error('niche_risks 非数组');
  if (!Array.isArray(obj.candidates)) throw new Error('candidates 非数组');
  for (const c of obj.candidates as Array<Record<string, unknown>>) {
    if (!c.keyword || !c.productGuess || !c.rationale || !c.confidence || !c.nextStep) {
      throw new Error(`candidate 字段缺失`);
    }
    if (!['high', 'medium', 'low'].includes(c.confidence as string)) throw new Error(`confidence 非法: ${c.confidence}`);
  }
  return obj as unknown as LLMNicheOutput;
}

interface NicheStats {
  a_count: number;
  b_count: number;
  c_count: number;
  top_a_searches: number;
  top_a_keyword: string;
  risks_count: number;
}

function buildStats(niche: NicheInput, output: LLMNicheOutput): NicheStats {
  const a = niche.candidates.filter((c) => c.grade === 'A');
  const topA = a
    .map((c) => ({ kw: c.keyword, s: parseInt((c.metrics.searches || '0').replace(/,/g, ''), 10) || 0 }))
    .sort((a1, b1) => b1.s - a1.s)[0];
  return {
    a_count: a.length,
    b_count: niche.candidates.filter((c) => c.grade === 'B').length,
    c_count: niche.candidates.filter((c) => c.grade === 'C').length,
    top_a_searches: topA?.s || 0,
    top_a_keyword: topA?.kw || '',
    risks_count: output.niche_risks.length,
  };
}

function saveScored(runId: string, niche: NicheInput, output: LLMNicheOutput, stats: NicheStats, inputHash: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO radar_scored_niches (run_id, seed, niche_summary, niche_risks_json, candidates_json, stats_json, input_hash, scored_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, seed) DO UPDATE SET
      niche_summary = excluded.niche_summary,
      niche_risks_json = excluded.niche_risks_json,
      candidates_json = excluded.candidates_json,
      stats_json = excluded.stats_json,
      input_hash = excluded.input_hash,
      scored_at = excluded.scored_at
  `).run(
    runId,
    niche.seed,
    output.niche_summary,
    JSON.stringify(output.niche_risks),
    JSON.stringify(output.candidates),
    JSON.stringify(stats),
    inputHash,
    Date.now(),
  );
}

export interface ScoreOptions {
  runId: string;
  userDirection?: string[];
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
  reportProgress?: (done: number, total: number) => void;
}

export interface ScoreResult {
  nicheCount: number;
  scored: number;
  cached: number;
  failed: number;
}

export async function scoreNiches(opts: ScoreOptions): Promise<ScoreResult> {
  const { runId, appendLog, isAborted, reportProgress } = opts;
  const userDirection = opts.userDirection ?? [];

  const niches = loadNiches(runId);
  if (niches.length === 0) throw new Error('没有 A/B/C 候选 — 先跑 ④');
  appendLog(`▶ 发现 ${niches.length} 个 niche · 共 ${niches.reduce((s, n) => s + n.candidates.length, 0)} 候选`);

  const provider = loadScoreProvider();
  appendLog(`▶ Provider: ${provider.baseUrl} · model=${provider.model}`);

  const cache = loadCacheHashes(runId);

  let scored = 0;
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < niches.length; i++) {
    if (isAborted()) throw new Error('aborted');
    const niche = niches[i];
    const hash = computeInputHash(niche, userDirection);
    if (cache.get(niche.seed) === hash) {
      cached++;
      reportProgress?.(i + 1, niches.length);
      continue;
    }

    const userPrompt = `user_direction = ${JSON.stringify(userDirection)}\nmarket = { country: 'US', platform: 'Etsy' }\n\nniche:\n${JSON.stringify(niche, null, 2)}\n\n请输出 JSON 对象(单 niche),不要 markdown code fence。`;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const text = await callLLM(provider, SYSTEM_PROMPT, userPrompt);
        const parsed = extractJSON(text);
        const validated = validateOutput(parsed, niche.seed);
        const stats = buildStats(niche, validated);
        saveScored(runId, niche, validated, stats, hash);
        scored++;
        appendLog(`  ✓ ${niche.seed} (${validated.candidates.length} cands · attempt ${attempt})`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (lastErr) {
      failed++;
      appendLog(`  ⚠ ${niche.seed} 3 次失败: ${(lastErr as Error).message.slice(0, 100)}`, 'warn');
    }
    reportProgress?.(i + 1, niches.length);
  }

  return { nicheCount: niches.length, scored, cached, failed };
}
