#!/usr/bin/env node
// ⑤ AI 解读全量跑 — 对齐 docs/etsy-erank-app-design.md §6.2 契约
// 输入: ./tmp/erank-score/score-input.json (50 niche × 217 candidates)
// 输出: ./tmp/erank-score/scored-niches.json + ./tmp/erank-score/state-llm.json
// LLM: provider=Claude, base_url=http://api.miki.zj.cn, model=claude-sonnet-4-6
// cache: input_hash(seed + candidates 字典序 + user_direction)
//   hash 命中 → 跳过, miss → 调 LLM
// 单 niche 失败 → 写 failed_niches, 不阻塞其他

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import os from 'node:os';

const TMP_DIR = path.resolve('./tmp/erank-score');
const SCORE_INPUT = path.join(TMP_DIR, 'score-input.json');
const STATE_FILE = path.join(TMP_DIR, 'state-llm.json');
const SCORED_OUT = path.join(TMP_DIR, 'scored-niches.json');

const MODEL = process.env.MODEL || 'claude-sonnet-4-6';
const MAX_RETRIES = 3;
const CONCURRENCY = 3;
const USER_DIRECTION = []; // blank_slate

function loadProvider() {
  const db = new Database(path.join(os.homedir(), '.lumos/lumos.db'), { readonly: true });
  const row = db.prepare(
    "SELECT api_key, base_url FROM api_providers WHERE name = 'Claude' AND base_url LIKE '%miki%' LIMIT 1",
  ).get();
  db.close();
  if (!row) throw new Error('未找到可用 Claude provider');
  return { apiKey: row.api_key, baseUrl: row.base_url.replace(/\/$/, '') };
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return { niche_outputs: {}, failed_niches: {}, last_run: null };
}

function saveState(state) {
  state.last_run = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function inputHash(seed, candidates, userDirection) {
  const sorted = candidates
    .map((c) => ({ keyword: c.keyword, grade: c.grade, metrics: c.metrics }))
    .sort((a, b) => a.keyword.localeCompare(b.keyword));
  const payload = JSON.stringify({ seed, candidates: sorted, user_direction: [...userDirection].sort() });
  return createHash('sha256').update(payload).digest('hex');
}

const SYSTEM_PROMPT = `角色:Etsy 选品分析师助手。
上下文:用户已经跑完 ②抓种子 + ③Etsy 真实扩词 + ④Bulk 验真,现在要从产物里挑 2-3 个 niche 上货。
任务:帮用户解读每个 niche 的机会、风险、产品方向 + 给立项建议。

# 你做(且只做)6 件事(niche 级 2 件 + candidate 级 4 件)

## niche 级(每 niche 输出 1 次)

1. niche_summary(100-150 字)
   - 战略总结:这 niche 是什么 + 整体机会 + 主要风险
   - 引用 stats(A 级数 / 顶 A 月搜)作证据

2. niche_risks(数组,字符串)
   - 客观陈述事实 + 风险条件 + 破局建议
   - 例: "monster high 是 Mattel IP,做衍生需先确认授权或仅做 fan art 边缘款"
   - 不写"不要做" / "避免做" 这种祈使句,决策权在用户

## candidate 级(niche 内每条 candidate 各输出 1 次)

3. productGuess(中文,简短)
   - 对应做什么具体产品
   - **不重复 niche_summary 已说的**,只写差异化补充
   - 例: ita bag(niche 主词)→ "主词 / 透明窗口痛包"
        ita bag accessories → "配件:链条/挂饰/扣环"

4. rationale(50-80 字)
   - 同时含机会 + 主要风险(不让用户漏看 risks 数组)
   - 引用 metrics 真实数字(允许变单位但不丢精度)
   - 例: "月搜 29,998 + KD 1 + 竞争 3,977 — 顶级金矿;痛包文化全球扩散,Etsy 供给严重不足"

5. confidence(enum: high / medium / low)
   - high:LLM 训练数据里有这词(autism pin / ita bag / frutiger aero)
   - medium:半懂(katana 知道但 Etsy 销售形态不熟)
   - low:完全陌生(vantastiks / oxalis 这种小众词)

6. nextStep(中文,简短建议)
   - 例: "立即进 ⑥ 人工验证" / "先查 IP 授权" / "2-4 周内必须上 listing" / "仅做标题副词"

# 死守边界(违反一条算失败)

- 不重算 grade / 不创新等级(grade 由 ④ code 算定)
- 不输出 niche_priority / 排序 / 评分
- rationale 不臆造数字(用户给的 metrics 是 ground truth)
- productGuess 不重复 niche 主词
- niche_risks 不写"不要做"/"避免",写"条件 + 破局"
- 输入 Unknown / < 20 metrics 不能臆造数字,rationale 标"数据缺失需 ⑥ 严格验证"

# 语言

- productGuess / rationale / niche_summary / niche_risks / nextStep → **中文**
- keyword / seed → **英文原文保留**(SEO 用,不翻译)

# 输出格式

直接返回 JSON 对象,不要 markdown code fence,不要 JSON 外的任何文字。
顶层结构: { "seed": "...", "niche_summary": "...", "niche_risks": [...], "candidates": [{...}, ...] }`;

function buildUserPrompt(niche, userDirection) {
  const dirText = userDirection.length > 0
    ? `user_direction = ${JSON.stringify(userDirection)}`
    : 'user_direction = []  // blank_slate, 纯按数据 + 全局意义判断';
  return `${dirText}

market = { country: 'US', platform: 'Etsy' }

niche:
${JSON.stringify(niche, null, 2)}

请输出 JSON 对象(单 niche),不要 markdown code fence。`;
}

async function callLLM(provider, system, userPrompt, attempt = 1) {
  const body = {
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  };
  const res = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  if (!text) throw new Error(`LLM 空响应: ${JSON.stringify(json).slice(0, 300)}`);
  return { text, usage: json.usage };
}

function extractJSON(text) {
  // 兼容 markdown code fence
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(json)?\n?/, '').replace(/```\s*$/, '').trim();
  }
  return JSON.parse(t);
}

function validateOutput(parsed, expectedSeed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('非对象');
  if (parsed.seed !== expectedSeed) throw new Error(`seed 不匹配: ${parsed.seed} vs ${expectedSeed}`);
  if (typeof parsed.niche_summary !== 'string' || parsed.niche_summary.length < 50) {
    throw new Error('niche_summary 缺失或太短');
  }
  if (!Array.isArray(parsed.niche_risks)) throw new Error('niche_risks 非数组');
  if (!Array.isArray(parsed.candidates)) throw new Error('candidates 非数组');
  for (const c of parsed.candidates) {
    if (!c.keyword || !c.productGuess || !c.rationale || !c.confidence || !c.nextStep) {
      throw new Error(`candidate 字段缺失: ${JSON.stringify(c).slice(0, 200)}`);
    }
    if (!['high', 'medium', 'low'].includes(c.confidence)) {
      throw new Error(`confidence 非法: ${c.confidence}`);
    }
  }
  return parsed;
}

function buildNicheStats(input, output) {
  const inputCands = input.candidates;
  const aList = inputCands.filter((c) => c.grade === 'A');
  const topA = aList
    .map((c) => ({ kw: c.keyword, s: parseInt((c.metrics.searches || '0').replace(/,/g, '')) || 0 }))
    .sort((a, b) => b.s - a.s)[0];
  return {
    a_count: aList.length,
    b_count: inputCands.filter((c) => c.grade === 'B').length,
    c_count: inputCands.filter((c) => c.grade === 'C').length,
    top_a_searches: topA?.s || 0,
    top_a_keyword: topA?.kw || '',
    risks_count: output.niche_risks.length,
  };
}

async function processNiche(niche, provider, state, totals) {
  const hash = inputHash(niche.seed, niche.candidates, USER_DIRECTION);

  if (state.niche_outputs[niche.seed]?.input_hash === hash) {
    totals.cached++;
    return state.niche_outputs[niche.seed];
  }

  const userPrompt = buildUserPrompt(niche, USER_DIRECTION);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { text, usage } = await callLLM(provider, SYSTEM_PROMPT, userPrompt, attempt);
      const parsed = extractJSON(text);
      const validated = validateOutput(parsed, niche.seed);
      validated.stats = buildNicheStats(niche, validated);
      validated.input_hash = hash;
      validated.ranAt = new Date().toISOString();

      state.niche_outputs[niche.seed] = validated;
      delete state.failed_niches[niche.seed];
      totals.in += usage?.input_tokens || 0;
      totals.out += usage?.output_tokens || 0;
      totals.ok++;
      console.log(`  ✓ ${niche.seed} (${validated.candidates.length} cands · ${usage?.input_tokens}+${usage?.output_tokens} tok · attempt ${attempt})`);
      saveState(state);
      return validated;
    } catch (e) {
      console.log(`  ⚠ ${niche.seed} attempt ${attempt}/${MAX_RETRIES}: ${e.message.slice(0, 200)}`);
      if (attempt === MAX_RETRIES) {
        const prev = state.failed_niches[niche.seed] || { retryCount: 0 };
        state.failed_niches[niche.seed] = {
          lastErrorAt: new Date().toISOString(),
          errorMessage: e.message.slice(0, 500),
          retryCount: prev.retryCount + 1,
        };
        totals.failed++;
        saveState(state);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

async function runAll() {
  const provider = loadProvider();
  const niches = JSON.parse(fs.readFileSync(SCORE_INPUT, 'utf8'));
  const state = loadState();
  const totals = { ok: 0, cached: 0, failed: 0, in: 0, out: 0 };

  console.log(`▶ ⑤ 全量解读: ${niches.length} niche · model=${MODEL} · concurrency=${CONCURRENCY}`);
  console.log(`  base_url=${provider.baseUrl}\n`);

  // 并发分批
  for (let i = 0; i < niches.length; i += CONCURRENCY) {
    const slice = niches.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map((n) => processNiche(n, provider, state, totals)));
  }

  // 汇总输出
  const scored = Object.values(state.niche_outputs).map((n) => ({
    seed: n.seed,
    niche_summary: n.niche_summary,
    niche_risks: n.niche_risks,
    candidates: n.candidates,
    stats: n.stats,
  }));
  fs.writeFileSync(SCORED_OUT, JSON.stringify(scored, null, 2));

  console.log('\n=== 汇总 ===');
  console.log(`✓ 成功: ${totals.ok}  cache 命中: ${totals.cached}  失败: ${totals.failed}`);
  console.log(`✓ token: in=${totals.in.toLocaleString()} out=${totals.out.toLocaleString()}`);
  console.log(`✓ 输出: ${SCORED_OUT} (${scored.length} niche)`);
  if (Object.keys(state.failed_niches).length > 0) {
    console.log(`⚠ 待重试: ${Object.keys(state.failed_niches).join(', ')}`);
  }
}

runAll().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
