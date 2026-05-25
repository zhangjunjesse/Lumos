#!/usr/bin/env node
// ③ 收敛 第 1+2 层真实跑(preFilter + scoreCorePotential)。
// 数据源:src/components/apps/builtin/etsy-erank/mock-data.ts 的 SEEDS(100 行真实抓到的)。
// 第 3 层 AI 调用不在这里跑(它是模型推理),输出保存供下游用。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// 从 mock-data 抽出 SEEDS(简易解析:抓所有 { sourceTool: ... keyword: ... } 行)
const mock = readFileSync('src/components/apps/builtin/etsy-erank/mock-data.ts', 'utf8');
const seedRe = /\{\s*sourceTool:\s*'([^']+)',\s*keyword:\s*'([^']+)',\s*rank:\s*'([^']+)'(?:,\s*change:\s*'([^']+)')?(?:,\s*avgSearches:\s*'([^']+)')?(?:,\s*avgCtr:\s*'([^']+)')?(?:,\s*competition:\s*'([^']+)')?(?:,\s*trendNote:\s*'([^']+)')?[^}]*\}/g;

const SEEDS = [];
let m;
while ((m = seedRe.exec(mock))) {
  const [, sourceTool, keyword, rank, change, avgSearches, avgCtr, competition, trendNote] = m;
  SEEDS.push({
    sourceTool,
    keyword,
    rank: Number(rank),
    change: change || null,
    month_searches: parseSearches(avgSearches),
    ctr: avgCtr === 'Unknown' ? 'Unknown' : avgCtr || null,
    competition: parseCompetition(competition),
    trendNote: trendNote || null,
  });
}

function parseSearches(s) {
  if (!s) return null;
  if (s === 'Unknown') return 'Unknown';
  if (s.startsWith('<')) return '<20';
  return Number(s.replace(/,/g, ''));
}
function parseCompetition(s) {
  if (!s) return null;
  return Number(s.replace(/,/g, ''));
}

console.log(`▶ 读到 ${SEEDS.length} 行 SEEDS`);

// 第 1 层:preFilter
function preFilter(seeds) {
  const seen = new Set();
  const candidates = [];
  const rejected = [];
  for (const s of seeds) {
    const norm = s.keyword.toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
    if (seen.has(norm)) {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'duplicate' });
      continue;
    }
    seen.add(norm);
    if (typeof s.competition === 'number' && s.competition > 100_000) {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'red_ocean', stats: { competition: s.competition } });
      continue;
    }
    if (s.month_searches === 'Unknown' || s.month_searches === '<20') {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'dead_no_search' });
      continue;
    }
    if (s.ctr === 'Unknown') {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'dead_no_click' });
      continue;
    }
    const wc = s.keyword.trim().split(/\s+/).length;
    if (wc === 1 && typeof s.competition === 'number' && s.competition > 1_000_000) {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'too_broad_single_word', stats: { competition: s.competition } });
      continue;
    }
    candidates.push(s);
  }
  return { candidates, rejected };
}

// 第 2 层:scoreCorePotential
function scoreCorePotential(s) {
  const wc = s.keyword.trim().split(/\s+/).length;
  let score = 0;
  if (wc >= 2) score += 50;
  if (wc === 1) score -= 30;
  if (typeof s.competition === 'number') {
    if (s.competition < 1_000) score += 30;
    else if (s.competition < 10_000) score += 15;
    else if (s.competition < 50_000) score += 5;
  }
  if (s.rank && s.rank <= 20) score += 5;
  return score;
}

const { candidates, rejected } = preFilter(SEEDS);
candidates.forEach((c) => (c.core_potential_score = scoreCorePotential(c)));
candidates.sort((a, b) => b.core_potential_score - a.core_potential_score);

console.log(`\n▶ preFilter: ${SEEDS.length} → 候选 ${candidates.length} / 剔除 ${rejected.length}`);

// rejected 按 reason 分桶看
const rejBuckets = {};
for (const r of rejected) rejBuckets[r.reason] = (rejBuckets[r.reason] || 0) + 1;
console.log('  剔除原因:', rejBuckets);

console.log('\n▶ 候选 TOP 20(按 score 降序):');
candidates.slice(0, 20).forEach((c, i) => {
  console.log(
    `  ${(i + 1).toString().padStart(2)}. score=${c.core_potential_score.toString().padStart(3)} | ${c.keyword.padEnd(40)} | comp=${c.competition ?? '-'} | search=${c.month_searches} | ctr=${c.ctr}`,
  );
});

console.log('\n▶ 剔除明细(前 15):');
rejected.slice(0, 15).forEach((r) => {
  console.log(`  ${r.keyword.padEnd(40)} → ${r.reason}${r.stats ? ' ' + JSON.stringify(r.stats) : ''}`);
});

mkdirSync('tmp/erank-converge', { recursive: true });
writeFileSync('tmp/erank-converge/candidates.json', JSON.stringify(candidates, null, 2));
writeFileSync('tmp/erank-converge/rejected.json', JSON.stringify(rejected, null, 2));
console.log('\n✓ 候选+剔除 已写入 tmp/erank-converge/');
