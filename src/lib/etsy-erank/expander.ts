// ③ 扩词 = 收敛(preFilter)+ B 路(Etsy autocomplete)+ C 路(Etsy listing ngram + 抓图)
// 把 scripts/erank-converge-simulate.mjs + erank-expand-all.mjs 的逻辑搬到 lib

import { chromium, type BrowserContext } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { startAdsPowerForContext } from './adspower';
import { getDb } from '../db/connection';

const execFileAsync = promisify(execFile);

interface SeedDbRow {
  keyword: string;
  avg_searches: string;
  avg_ctr: string;
  competition: string;
  rank: number | null;
  source_tool: string;
}

interface SeedNormalized {
  keyword: string;
  sourceTool: string;
  rank: number | null;
  monthSearches: number | 'Unknown' | '<20' | null;
  ctr: string | null;
  competition: number | null;
}

interface ConvergeOutput {
  candidates: SeedNormalized[];
  rejected: Array<{ keyword: string; source: string; reason: string; competition?: number }>;
}

function parseSearches(s: string): number | 'Unknown' | '<20' | null {
  if (!s) return null;
  if (s === 'Unknown') return 'Unknown';
  if (s.startsWith('<')) return '<20';
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseCompetition(s: string): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function loadSeeds(runId: string): SeedNormalized[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT keyword, avg_searches, avg_ctr, competition, rank, source_tool FROM radar_seeds WHERE run_id = ?`)
    .all(runId) as SeedDbRow[];
  return rows.map((r) => ({
    keyword: r.keyword,
    sourceTool: r.source_tool,
    rank: r.rank,
    monthSearches: parseSearches(r.avg_searches),
    ctr: r.avg_ctr === 'Unknown' ? 'Unknown' : r.avg_ctr || null,
    competition: parseCompetition(r.competition),
  }));
}

export function preFilter(seeds: SeedNormalized[]): ConvergeOutput {
  const seen = new Set<string>();
  const candidates: SeedNormalized[] = [];
  const rejected: ConvergeOutput['rejected'] = [];
  for (const s of seeds) {
    const norm = s.keyword.toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
    if (seen.has(norm)) {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'duplicate' });
      continue;
    }
    seen.add(norm);
    if (typeof s.competition === 'number' && s.competition > 100_000) {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'red_ocean', competition: s.competition });
      continue;
    }
    if (s.monthSearches === 'Unknown' || s.monthSearches === '<20') {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'dead_no_search' });
      continue;
    }
    if (s.ctr === 'Unknown') {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'dead_no_click' });
      continue;
    }
    const wc = s.keyword.trim().split(/\s+/).length;
    if (wc === 1 && typeof s.competition === 'number' && s.competition > 1_000_000) {
      rejected.push({ keyword: s.keyword, source: s.sourceTool, reason: 'too_broad_single_word', competition: s.competition });
      continue;
    }
    candidates.push(s);
  }
  return { candidates, rejected };
}

function scoreCorePotential(s: SeedNormalized): number {
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

function saveConverge(runId: string, output: ConvergeOutput): void {
  const db = getDb();
  db.prepare('DELETE FROM radar_converge WHERE run_id = ?').run(runId);
  const stmt = db.prepare(
    `INSERT INTO radar_converge (run_id, keyword, score, reject_reason, stats_json) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertMany = db.transaction(() => {
    for (const c of output.candidates) {
      stmt.run(runId, c.keyword, scoreCorePotential(c), '', JSON.stringify({ competition: c.competition, monthSearches: c.monthSearches }));
    }
    for (const r of output.rejected) {
      stmt.run(runId, r.keyword, 0, r.reason, JSON.stringify(r.competition ? { competition: r.competition } : {}));
    }
  });
  insertMany();
}

// ============ B 路:Etsy autocomplete ============
async function expandB(seed: string): Promise<string[]> {
  const url = `https://www.etsy.com/api/v3/ajax/public/search/suggestions?query=${encodeURIComponent(seed)}&suggestion_count=20`;
  const { stdout } = await execFileAsync('curl', [
    '-s', '--max-time', '10',
    '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/147.0.0.0',
    '-H', 'Accept: application/json',
    url,
  ]);
  const data = JSON.parse(stdout) as { results?: Array<{ query: string }>; simplified_queries?: string[] };
  const queries = [
    ...(data.results ?? []).map((r) => r.query),
    ...(data.simplified_queries ?? []),
  ];
  return [...new Set(queries.map((q) => q.toLowerCase().trim()).filter(Boolean))];
}

// ============ C 路:Etsy listing 标题 ngram + 抓图 ============
interface ListingItem {
  listing_id: string;
  title: string;
  img_url: string;
  price: string;
  shop: string;
  href: string;
}

const STOPWORDS = new Set([
  'the', 'and', 'or', 'a', 'an', 'for', 'with', 'in', 'on', 'of', 'to', 'is', 'by',
  'this', 'that', 'these', 'those', 'as', 'at', 'be', 'are', 'from', 'your', 'you',
]);

async function expandC(ctx: BrowserContext, seed: string): Promise<{ ngrams: string[]; listings: ListingItem[] }> {
  const page = await ctx.newPage();
  try {
    await page.goto(`https://www.etsy.com/search?q=${encodeURIComponent(seed)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    const listings = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-listing-id]')];
      return cards.slice(0, 40).map((card) => {
        const c = card as HTMLElement;
        const titleEl = c.querySelector('h3, h2');
        const imgEl = c.querySelector('img') as HTMLImageElement | null;
        const priceEl = c.querySelector('[class*="price"], [class*="currency"]');
        const shopEl = c.querySelector('[class*="shop"]');
        const linkEl = c.querySelector('a[href*="/listing/"]') as HTMLAnchorElement | null;
        let img_url = imgEl?.src || '';
        const srcset = imgEl?.srcset || '';
        if (srcset) {
          const m = srcset.match(/(\S+)\s+1x/) || srcset.match(/(\S+)\s+2x/);
          if (m) img_url = m[1];
        }
        img_url = img_url.replace(/il_\w+xN/, 'il_300x300');
        return {
          listing_id: (c as HTMLElement & { dataset: DOMStringMap }).dataset.listingId || '',
          title: ((titleEl as HTMLElement)?.innerText || '').trim(),
          img_url,
          price: ((priceEl as HTMLElement)?.innerText || '').trim(),
          shop: ((shopEl as HTMLElement)?.innerText || '').trim(),
          href: linkEl?.href || '',
        };
      });
    });
    const titles = listings.map((l: ListingItem) => l.title).filter(Boolean);
    const counts = new Map<string, number>();
    for (const title of titles) {
      const tokens = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t && t.length > 1 && !STOPWORDS.has(t));
      for (let n = 2; n <= 4; n++) {
        for (let i = 0; i + n <= tokens.length; i++) {
          const gram = tokens.slice(i, i + n).join(' ');
          counts.set(gram, (counts.get(gram) || 0) + 1);
        }
      }
    }
    const ngrams = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([g]) => g);
    return { ngrams, listings: listings.filter((l) => l.listing_id) };
  } finally {
    await page.close().catch(() => {});
  }
}

// ============ 图片下载 ============
const IMG_DIR = path.resolve('public/etsy-images');

function downloadImage(url: string, listingId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dest = path.join(IMG_DIR, `${listingId}.jpg`);
    if (fs.existsSync(dest)) return resolve(true);
    fs.mkdirSync(IMG_DIR, { recursive: true });
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(false); }
        const f = fs.createWriteStream(dest);
        res.pipe(f);
        f.on('finish', () => f.close(() => resolve(true)));
        f.on('error', () => resolve(false));
      })
      .on('error', () => resolve(false));
  });
}

// ============ 入库 ============
function saveExpanded(runId: string, seed: string, keywords: Array<{ keyword: string; sources: string[] }>): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO radar_expanded (run_id, seed, keyword, sources_json) VALUES (?, ?, ?, ?)`,
  );
  const insertMany = db.transaction(() => {
    for (const k of keywords) stmt.run(runId, seed, k.keyword, JSON.stringify(k.sources));
  });
  insertMany();
}

function saveListings(runId: string, seed: string, listings: ListingItem[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO radar_listings (run_id, seed, listing_id, title, img_url, price, shop_text, href) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMany = db.transaction(() => {
    for (const l of listings) stmt.run(runId, seed, l.listing_id, l.title, l.img_url, l.price, l.shop, l.href);
  });
  insertMany();
}

// ============ 主入口 ============
export interface ExpandOptions {
  runId: string;
  browserContextId?: string;
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
  reportProgress?: (done: number, total: number) => void;
}

export interface ExpandResult {
  candidateCount: number;
  expandedTotal: number;
  listingsTotal: number;
  imagesDownloaded: number;
}

export async function expandAll(opts: ExpandOptions): Promise<ExpandResult> {
  const { runId, appendLog, isAborted, reportProgress } = opts;

  // 1. 收敛
  appendLog(`▶ 加载 ② 种子`);
  const seeds = loadSeeds(runId);
  if (seeds.length === 0) throw new Error('没有 ② 种子,先跑 ②');
  appendLog(`  共 ${seeds.length} 个种子`);

  const converge = preFilter(seeds);
  saveConverge(runId, converge);
  appendLog(`▶ 收敛 preFilter:${seeds.length} → 候选 ${converge.candidates.length} / 剔除 ${converge.rejected.length}`);

  const candidates = converge.candidates;
  const candidateKeywords = candidates.map((c) => c.keyword);

  // 清掉旧 expanded + listings
  const db = getDb();
  db.prepare('DELETE FROM radar_expanded WHERE run_id = ?').run(runId);
  db.prepare('DELETE FROM radar_listings WHERE run_id = ?').run(runId);

  // 2. B 路:并行 autocomplete
  appendLog(`▶ B 路:Etsy autocomplete (${candidateKeywords.length} 词)`);
  const bResults = new Map<string, string[]>();
  let bDone = 0;
  for (const kw of candidateKeywords) {
    if (isAborted()) throw new Error('aborted');
    try {
      const queries = await expandB(kw);
      bResults.set(kw, queries);
    } catch (e) {
      appendLog(`  ⚠ B "${kw}" 失败: ${(e as Error).message.slice(0, 80)}`, 'warn');
      bResults.set(kw, []);
    }
    bDone++;
    if (bDone % 10 === 0) appendLog(`  B 进度 ${bDone}/${candidateKeywords.length}`);
    reportProgress?.(bDone, candidateKeywords.length * 2);
  }
  appendLog(`  ✓ B 路完成 · 平均每 seed ${Math.round(bResults.size > 0 ? [...bResults.values()].reduce((s, x) => s + x.length, 0) / bResults.size : 0)} 个长尾`);

  // 3. C 路:AdsPower 真浏览器
  appendLog(`▶ C 路:Etsy listing ngram · 启动 AdsPower`);
  const handle = await startAdsPowerForContext(opts.browserContextId);
  const browser = await chromium.connectOverCDP(handle.wsEndpoint);
  const ctx = browser.contexts()[0];
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower 无 context');
  }

  const cResults = new Map<string, { ngrams: string[]; listings: ListingItem[] }>();
  let cDone = 0;
  let imagesOk = 0;
  let listingsTotal = 0;

  try {
    for (const kw of candidateKeywords) {
      if (isAborted()) throw new Error('aborted');
      try {
        const r = await expandC(ctx, kw);
        cResults.set(kw, r);
        listingsTotal += r.listings.length;
        saveListings(runId, kw, r.listings);
        // 下载图片(异步,不阻塞下一词)
        for (const l of r.listings) {
          if (!l.img_url || !l.listing_id) continue;
          const ok = await downloadImage(l.img_url, l.listing_id);
          if (ok) imagesOk++;
        }
      } catch (e) {
        appendLog(`  ⚠ C "${kw}" 失败: ${(e as Error).message.slice(0, 80)}`, 'warn');
        cResults.set(kw, { ngrams: [], listings: [] });
      }
      cDone++;
      if (cDone % 5 === 0) appendLog(`  C 进度 ${cDone}/${candidateKeywords.length}`);
      reportProgress?.(candidateKeywords.length + cDone, candidateKeywords.length * 2);
    }
  } finally {
    await browser.close().catch(() => {});
    appendLog(`▶ disconnect CDP · AdsPower 窗口保留`);
  }

  // 4. 合并入库
  let expandedTotal = 0;
  for (const kw of candidateKeywords) {
    const bSet = new Set(bResults.get(kw) ?? []);
    const cSet = new Set(cResults.get(kw)?.ngrams ?? []);
    const all = new Set([...bSet, ...cSet]);
    if (all.size === 0) continue;
    const rows: Array<{ keyword: string; sources: string[] }> = [];
    for (const word of all) {
      const sources: string[] = [];
      if (bSet.has(word)) sources.push('B_autocomplete');
      if (cSet.has(word)) sources.push('C_listing_ngram');
      rows.push({ keyword: word, sources });
    }
    saveExpanded(runId, kw, rows);
    expandedTotal += rows.length;
  }
  appendLog(`  ✓ 入库 expanded ${expandedTotal} 词 · listings ${listingsTotal} · 图 ${imagesOk}`);

  return {
    candidateCount: candidates.length,
    expandedTotal,
    listingsTotal,
    imagesDownloaded: imagesOk,
  };
}
