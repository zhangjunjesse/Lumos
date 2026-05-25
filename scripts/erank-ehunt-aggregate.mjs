#!/usr/bin/env node
// ⑥ 商业分析 — 聚合 raw 数据 + LLM 一句话解读
// 输入: tmp/erank-ehunt/raw/<slug>.json
// 输出: tmp/erank-ehunt/analysis/<slug>.json + tmp/erank-ehunt/analysis-all.json

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import os from 'node:os';

const RAW_DIR = path.resolve('./tmp/erank-ehunt/raw');
const ANALYSIS_DIR = path.resolve('./tmp/erank-ehunt/analysis');
fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

const MODEL = process.env.MODEL || 'claude-haiku-4-5-20251001';

function slug(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function loadProvider() {
  const db = new Database(path.join(os.homedir(), '.lumos/lumos.db'), { readonly: true });
  const row = db.prepare("SELECT api_key, base_url FROM api_providers WHERE name = 'Claude' AND base_url LIKE '%miki%' LIMIT 1").get();
  db.close();
  if (!row) throw new Error('未找到 Claude provider');
  return { apiKey: row.api_key, baseUrl: row.base_url.replace(/\/$/, '') };
}

// "PerebetiUKStore Ad from shop PerebetiUKStore" → "PerebetiUKStore"
function cleanShopName(name) {
  if (!name) return '';
  return name.replace(/\s+Ad\s+from\s+shop\s+.+$/i, '').replace(/\s+From\s+shop\s+.+$/i, '').trim();
}

// "Sale Price $58.79" → 58.79
function parsePrice(p) {
  if (!p) return null;
  const m = p.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, ''));
}

function parseListedDate(d) {
  if (!d) return null;
  // "04/22/26" → Date
  const m = d.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (!m) return null;
  const year = 2000 + parseInt(m[3], 10);
  return new Date(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
}

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx];
}

function ngramTitles(titles) {
  // 抽 2-gram / 3-gram 出现 ≥ 30% 的
  const tokenize = (s) => s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const grams = {};
  for (const t of titles) {
    const toks = tokenize(t);
    for (let n = 1; n <= 3; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const g = toks.slice(i, i + n).join(' ');
        grams[g] = (grams[g] || 0) + 1;
      }
    }
  }
  const total = titles.length;
  return Object.entries(grams)
    .map(([gram, count]) => ({ gram, count, pct: count / total }))
    .filter((x) => x.pct >= 0.3 && x.gram.length >= 4)
    .sort((a, b) => b.count - a.count)
    .slice(0, 13);
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'shop', 'sale', 'price', 'free', 'gift', 'new', 'ready', 'set',
  'with', 'pcs', 'pack', 'one', 'two', 'three', 'item', 'made', 'use', 'design', 'custom', 'best',
  'this', 'that', 'pro', 'top', 'all', 'add', 'usa', 'inc', 'llc',
]);

function aggregate(keyword, listings) {
  const today = new Date('2026-05-22');
  const ehunt = listings.filter((l) => l.ehunt.sales != null);
  const sales = ehunt.map((l) => l.ehunt.sales).filter((x) => x != null);
  const favs = ehunt.map((l) => l.ehunt.favorites).filter((x) => x != null);
  const weeklySales = ehunt.map((l) => l.ehunt.store_weekly_sales).filter((x) => x != null);
  const prices = listings.map((l) => parsePrice(l.price)).filter((x) => x != null);

  // 上架日期分布
  const listedAges = ehunt
    .map((l) => parseListedDate(l.ehunt.listed_date))
    .filter((d) => d != null)
    .map((d) => Math.floor((today - d) / (1000 * 60 * 60 * 24)));
  const newWithin30 = listedAges.filter((a) => a <= 30).length;
  const newWithin90 = listedAges.filter((a) => a <= 90).length;
  const newWithin30WithSales = ehunt.filter((l) => {
    const d = parseListedDate(l.ehunt.listed_date);
    if (!d) return false;
    const age = (today - d) / (1000 * 60 * 60 * 24);
    return age <= 30 && l.ehunt.sales > 0;
  }).length;

  // 店铺集中度
  const shopCounts = {};
  for (const l of listings) {
    const name = cleanShopName(l.shop_name);
    if (!name) continue;
    if (!shopCounts[name]) shopCounts[name] = { name, listings: 0, sales: 0, favs: 0 };
    shopCounts[name].listings++;
    shopCounts[name].sales += l.ehunt.sales || 0;
    shopCounts[name].favs += l.ehunt.favorites || 0;
  }
  const topShops = Object.values(shopCounts).sort((a, b) => b.sales - a.sales || b.listings - a.listings).slice(0, 5);
  const top5SalesPct = sales.length > 0
    ? topShops.slice(0, 5).reduce((s, x) => s + x.sales, 0) / Math.max(1, sales.reduce((s, x) => s + x, 0))
    : 0;

  // SEO 词频
  const titles = listings.map((l) => l.title).filter(Boolean);
  const topNgrams = ngramTitles(titles);

  return {
    keyword,
    listingCount: listings.length,
    ehuntCoverage: ehunt.length,
    sales: {
      max: sales[0] || null,
      median: median(sales),
      p75: percentile(sales, 0.75),
      total: sales.reduce((s, x) => s + x, 0),
      top10: [...sales].sort((a, b) => b - a).slice(0, 10),
    },
    favorites: {
      max: Math.max(0, ...favs),
      median: median(favs),
      total: favs.reduce((s, x) => s + x, 0),
    },
    storeWeeklySales: {
      median: median(weeklySales),
      max: Math.max(0, ...weeklySales),
    },
    price: {
      min: Math.min(...prices),
      max: Math.max(...prices),
      median: median(prices),
      p25: percentile(prices, 0.25),
      p75: percentile(prices, 0.75),
    },
    newStores: {
      within30: newWithin30,
      within90: newWithin90,
      within30WithSales: newWithin30WithSales,
      ageDistribution: listedAges.sort((a, b) => a - b),
    },
    topShops,
    top5SalesPct,
    topNgrams,
  };
}

async function callLLM(provider, agg) {
  const system = `你是 Etsy 选品助理。给定一个关键词的市场聚合数据,用 1-2 句中文直接给"切入建议"。

要求:
- 必须引用具体数字(销量/价格/新店比例)作为依据
- 必须给出"建议价位"或"建议策略"
- 必须诚实:头部垄断时说"难"、新店出单时说"可切"
- 一句 80 字以内,合计不超过 200 字
- 不写"建议..."的废话开头,直接给定调
- 不输出 markdown / 序号 / 多段`;

  const user = `keyword = ${JSON.stringify(agg.keyword)}

数据:
- listing 数: ${agg.listingCount}, EHunt 覆盖: ${agg.ehuntCoverage}
- 销量: 最高 ${agg.sales.max}, 中位 ${agg.sales.median}, P75 ${agg.sales.p75}, top 10 合计 ${agg.sales.top10.reduce((s, x) => s + x, 0)}
- 收藏: 最高 ${agg.favorites.max}, 中位 ${agg.favorites.median}, 合计 ${agg.favorites.total}
- 价格: $${agg.price.min}-${agg.price.max}, 中位 $${agg.price.median}, P25-P75 $${agg.price.p25}-$${agg.price.p75}
- 新店(上架 ≤30 天): ${agg.newStores.within30} 个, 其中 ${agg.newStores.within30WithSales} 个已出单
- 头部 5 店占总销量: ${(agg.top5SalesPct * 100).toFixed(0)}%
- 头部店铺(按销量): ${agg.topShops.slice(0, 3).map((s) => `${s.name}(销 ${s.sales}/listing ${s.listings})`).join(', ')}
- 头部 SEO 词: ${agg.topNgrams.slice(0, 8).map((n) => n.gram).join(' / ')}

输出"切入建议"(1-2 句,纯文本):`;

  const res = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  return (json.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}

async function main() {
  const provider = loadProvider();
  const rawFiles = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.json'));
  console.log(`▶ 聚合 ${rawFiles.length} 个 raw 文件\n`);

  const all = [];
  for (const file of rawFiles) {
    const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'));
    const agg = aggregate(raw.keyword, raw.listings);

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const insight = await callLLM(provider, agg);
        agg.llmInsight = insight;
        console.log(`  ✓ ${raw.keyword.padEnd(40)} → ${insight.slice(0, 80)}${insight.length > 80 ? '...' : ''}`);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (lastErr) {
      agg.llmInsight = `LLM 失败: ${lastErr.message.slice(0, 100)}`;
      console.log(`  ⚠ ${raw.keyword.padEnd(40)} LLM 3 次失败`);
    }

    fs.writeFileSync(path.join(ANALYSIS_DIR, file), JSON.stringify(agg, null, 2));
    all.push(agg);
  }

  fs.writeFileSync(path.join(path.dirname(ANALYSIS_DIR), 'analysis-all.json'), JSON.stringify(all, null, 2));
  console.log(`\n▶ 输出 tmp/erank-ehunt/analysis-all.json (${all.length} 词)`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
