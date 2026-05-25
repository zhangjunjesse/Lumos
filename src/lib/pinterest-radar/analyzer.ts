// ④ AI 解读 — 每个 trending term 跑一次 LLM,落库 niche/category/audience/创意/风险/分数

import { callTextGen, loadTextGenProvider } from '../llm/text-gen';
import { getDb } from '../db/connection';

export interface AnalyzeOptions {
  runId: string;
  browserContextId?: string;     // 这里没用到,只为统一签名;LLM 不用浏览器
  concurrency?: number;          // 默认 3
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
  reportProgress?: (done: number, total: number) => void;
}

export interface AnalyzeResult {
  total: number;
  succeeded: number;
  failed: number;
  cached: number;
}

interface TermInput {
  term: string;
  preset: string;
  category: string;
  growthRate: number | null;
  wow: number | null;
  mom: number | null;
  yoy: number | null;
  counts: Array<{ date: string; normalizedCount: number }>;
}

const SYSTEM_PROMPT = `你是资深跨境电商选品分析师,擅长把 Pinterest Trends 关键词转成具体的选品判断。

输出要求:
- 用中文,以行业报告口吻(非营销腔,非翻译腔)
- 字段化输出,严格 JSON 格式
- 不编数字,数字必须来源于用户给的输入
- 风险点要具体(不写"竞争激烈"这种废话,要指出"高单价 + 季节性"这种实质风险)`;

function buildUserPrompt(input: TermInput): string {
  // 取 counts 最后 12 周做摘要,避免 token 浪费
  const tail = input.counts.slice(-12);
  const sparkline = tail.map((c) => Math.round(c.normalizedCount)).join(',');
  return `分析以下 Pinterest Trends 关键词。

关键词: ${input.term}
猎场: ${input.preset}
品类(Pinterest 标注): ${input.category || '未标注'}
增长率: WoW=${input.wow ?? 'n/a'}% / MoM=${input.mom ?? 'n/a'}% / YoY=${input.yoy ?? 'n/a'}%
列表展示涨幅: ${input.growthRate ?? 'n/a'}%
最近 12 周归一化搜索量(末尾 = 最新): ${sparkline}

请输出 JSON,字段如下:
{
  "niche": "归属 niche 名称(英文,≤4 词)",
  "category": "判定品类(中文,≤8 字)",
  "audience": "目标人群(中文一句话,≤30 字)",
  "creative_angles": ["3-5 个创意方向(中文,每条 ≤20 字)"],
  "risks": ["2-4 个风险点(中文,每条 ≤25 字,要具体)"],
  "score": 0-100 整数(综合机会分:增长 + 趋势稳定性 + 选品可行性),
  "rationale": "评分理由(中文一段,≤150 字)"
}

只输出 JSON,不要 markdown 围栏。`;
}


interface AnalysisOutput {
  niche: string;
  category: string;
  audience: string;
  creative_angles: string[];
  risks: string[];
  score: number;
  rationale: string;
}

function extractAnalysisJson(text: string): AnalysisOutput {
  // 去 markdown 围栏
  let s = text.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) s = fenced[1].trim();
  // 截到首个 { ... } 块
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error(`找不到 JSON 块: ${s.slice(0, 200)}`);
  const parsed = JSON.parse(s.slice(first, last + 1)) as Partial<AnalysisOutput>;
  return {
    niche: String(parsed.niche ?? '').slice(0, 80),
    category: String(parsed.category ?? '').slice(0, 40),
    audience: String(parsed.audience ?? '').slice(0, 120),
    creative_angles: Array.isArray(parsed.creative_angles) ? parsed.creative_angles.slice(0, 6).map((x) => String(x).slice(0, 60)) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 6).map((x) => String(x).slice(0, 80)) : [],
    score: Number.isFinite(Number(parsed.score)) ? Math.max(0, Math.min(100, Math.round(Number(parsed.score)))) : 0,
    rationale: String(parsed.rationale ?? '').slice(0, 600),
  };
}

function loadPendingTerms(runId: string): TermInput[] {
  const db = getDb();
  // term 必须同时有 trending 行 + metrics 行,且尚未在 pinterest_analysis 表
  const rows = db.prepare(`
    SELECT t.term, t.preset, t.category, t.growth_rate,
           m.wow_change, m.mom_change, m.yoy_change, m.counts_json
      FROM pinterest_trending t
      JOIN pinterest_metrics m ON m.run_id = t.run_id AND m.term = t.term
      LEFT JOIN pinterest_analysis a ON a.run_id = t.run_id AND a.term = t.term
     WHERE t.run_id = ? AND a.term IS NULL
     ORDER BY t.rank ASC NULLS LAST, t.id ASC
  `).all(runId) as Array<{
    term: string; preset: string; category: string; growth_rate: number | null;
    wow_change: number | null; mom_change: number | null; yoy_change: number | null;
    counts_json: string;
  }>;
  return rows.map((r) => ({
    term: r.term,
    preset: r.preset,
    category: r.category,
    growthRate: r.growth_rate,
    wow: r.wow_change,
    mom: r.mom_change,
    yoy: r.yoy_change,
    counts: (() => { try { return JSON.parse(r.counts_json || '[]'); } catch { return []; } })(),
  }));
}

export async function analyzeAllTerms(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const { runId, appendLog: log, isAborted, reportProgress } = opts;
  const concurrency = Math.max(1, Math.min(5, opts.concurrency ?? 3));

  const db = getDb();
  // M6 — 空数据保护:metrics 行数太少没意义跑 LLM,直接 fail 让用户先把 ③ 跑通
  const metricsCount = (db.prepare('SELECT COUNT(*) as cnt FROM pinterest_metrics WHERE run_id = ?').get(runId) as { cnt: number }).cnt;
  const MIN_METRICS = 5;
  if (metricsCount < MIN_METRICS) {
    throw new Error(`pinterest_metrics 只有 ${metricsCount} 条(< ${MIN_METRICS}),数据太少,跑 ④ 没意义。请先把 ③ Metrics 跑通。`);
  }

  const provider = loadTextGenProvider();
  log(`▶ LLM provider 就绪 · ${provider.providerName} · model=${provider.model}`);

  const pending = loadPendingTerms(runId);
  const total = pending.length;
  const alreadyDone = (db.prepare('SELECT COUNT(*) as cnt FROM pinterest_analysis WHERE run_id = ?').get(runId) as { cnt: number }).cnt;
  log(`  待解读 ${total} 个 · 已解读 ${alreadyDone} 个(跳过)`);
  if (total === 0) return { total: 0, succeeded: 0, failed: 0, cached: alreadyDone };

  const insertStmt = db.prepare(`
    INSERT INTO pinterest_analysis (run_id, term, niche, category, audience, creative_angles_json, risks_json, score, rationale, model_used, analyzed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, term) DO UPDATE SET
      niche=excluded.niche, category=excluded.category, audience=excluded.audience,
      creative_angles_json=excluded.creative_angles_json, risks_json=excluded.risks_json,
      score=excluded.score, rationale=excluded.rationale, model_used=excluded.model_used,
      analyzed_at=excluded.analyzed_at
  `);

  let done = 0;
  let succeeded = 0;
  let failed = 0;

  // 简单并发池
  const queue = [...pending];
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        if (isAborted()) break;
        const term = queue.shift();
        if (!term) break;
        try {
          const text = await callTextGen(provider, { system: SYSTEM_PROMPT, userPrompt: buildUserPrompt(term), maxTokens: 2048 });
          const parsed = extractAnalysisJson(text);
          insertStmt.run(
            runId,
            term.term,
            parsed.niche,
            parsed.category,
            parsed.audience,
            JSON.stringify(parsed.creative_angles),
            JSON.stringify(parsed.risks),
            parsed.score,
            parsed.rationale,
            provider.model,
            Date.now(),
          );
          succeeded++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`  ✗ ${term.term}: ${msg}`, 'error');
          failed++;
        } finally {
          done++;
          reportProgress?.(done, total);
          if (done % 5 === 0) log(`  进度 ${done}/${total} · 成功 ${succeeded} · 失败 ${failed}`);
        }
      }
    })());
  }
  await Promise.all(workers);

  return { total, succeeded, failed, cached: alreadyDone };
}
