// ④ Bulk 验真 — 把 scripts/erank-bulk-batch.mjs 的逻辑搬到 lib
// AdsPower → eRank Bulk Tool → CSV 导出 → 入 radar_bulk + grade

import { chromium, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { startAdsPowerForContext } from './adspower';
import { getDb } from '../db/connection';
import type { Grade } from './types';

const BULK_URL = 'https://members.erank.com/bulk-keyword-tool';
const BATCH_SIZE = 20;
const REQUIRED_COLS = ['Keywords', 'Avg Searches', 'Avg Clicks', 'Avg CTR', 'Etsy Competition', 'Keyword Difficulty', 'Google Searches'];

interface KeywordToVerify {
  keyword: string;
  seed: string;
  sources: string[];
}

function loadCandidates(runId: string): KeywordToVerify[] {
  const db = getDb();
  // ③ 扩词产物
  const expRows = db
    .prepare(`SELECT seed, keyword, sources_json FROM radar_expanded WHERE run_id = ?`)
    .all(runId) as Array<{ seed: string; keyword: string; sources_json: string }>;
  // ②的种子也要送验真(因为它们的 KD 还没拿到)
  const seedRows = db
    .prepare(`SELECT DISTINCT keyword FROM radar_seeds WHERE run_id = ?`)
    .all(runId) as Array<{ keyword: string }>;

  const list: KeywordToVerify[] = [];
  const seen = new Set<string>();
  for (const s of seedRows) {
    if (seen.has(s.keyword)) continue;
    seen.add(s.keyword);
    list.push({ keyword: s.keyword, seed: s.keyword, sources: ['seed'] });
  }
  for (const r of expRows) {
    if (seen.has(r.keyword)) continue;
    seen.add(r.keyword);
    list.push({ keyword: r.keyword, seed: r.seed, sources: JSON.parse(r.sources_json) as string[] });
  }
  return list;
}

function loadDoneKeywords(runId: string): Set<string> {
  const rows = getDb().prepare('SELECT keyword FROM radar_bulk WHERE run_id = ?').all(runId) as Array<{ keyword: string }>;
  return new Set(rows.map((r) => r.keyword));
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function parseCsvText(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function gradeOf(r: { searches: string; ctr: string; competition: string; kd: string }): Grade {
  const s = parseInt((r.searches || '').replace(/,/g, ''), 10) || 0;
  const c = parseInt((r.competition || '').replace(/,/g, ''), 10) || 0;
  const kd = parseInt(r.kd, 10) || 0;
  const ctr = parseInt(r.ctr, 10) || 0;
  const sU = r.searches === 'Unknown' || r.searches === '< 20';
  const ctrU = r.ctr === 'Unknown' || r.ctr === '< 20%';
  if (sU || ctrU || s < 100 || c > 100000 || kd === 100) return 'drop';
  if (s >= 150 && c < 5000 && kd < 30 && ctr >= 80) return 'A';
  if (s >= 100 && c < 50000 && kd < 50 && ctr >= 80) return 'B';
  return 'C';
}

function buildColIdx(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  for (const col of REQUIRED_COLS) {
    const i = headers.findIndex((h) => h.trim() === col);
    if (i < 0) throw new Error(`CSV 缺列「${col}」(字段漂移?headers=${headers.join('|')})`);
    idx[col] = i;
  }
  return idx;
}

async function runBatch(page: Page, keywords: string[], tmpDownloadDir: string, batchIdx: number): Promise<{ headers: string[]; rows: string[][] }> {
  await page.waitForSelector('textarea[placeholder*="Enter keywords"]', { timeout: 30_000 }).catch(() => {});
  const ta = await page.$('textarea[placeholder*="Enter keywords"]');
  if (!ta) throw new Error('找不到 textarea');
  await ta.click();
  await ta.fill('');
  await page.waitForTimeout(300);
  await ta.fill(keywords.join('\n'));

  const analyzeBtn = await page.$('button:has-text("Analyze")');
  if (!analyzeBtn) throw new Error('找不到 Analyze 按钮');
  await analyzeBtn.click();

  await page.waitForFunction(
    (expected: number) => {
      const tbody = document.querySelector('table tbody');
      return tbody !== null && tbody.querySelectorAll('tr').length >= expected;
    },
    keywords.length,
    { timeout: 90_000 },
  ).catch(() => { /* 90s 内未见 */ });
  await page.waitForTimeout(1500);

  const exportBtn = await page.$('button:has-text("Export"), a:has-text("Export")');
  if (!exportBtn) throw new Error('找不到 Export 按钮');
  await exportBtn.click();
  await page.waitForTimeout(500);

  const csvHandle = await page.evaluateHandle(() => {
    const all = [...document.querySelectorAll('*')];
    return all.find((el) => {
      const t = (el.textContent || '').trim();
      return t === 'Download as CSV' || t === 'CSV';
    });
  });
  const csvEl = csvHandle ? csvHandle.asElement() : null;
  if (!csvEl) throw new Error('找不到 Download as CSV 菜单项');

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    csvEl.click(),
  ]);
  const csvPath = path.join(tmpDownloadDir, `batch-${batchIdx}.csv`);
  await download.saveAs(csvPath);
  const text = fs.readFileSync(csvPath, 'utf8');
  return parseCsvText(text);
}

function saveRows(runId: string, batchId: string, rows: Array<{ keyword: string; seed: string; sources: string[]; searches: string; clicks: string; ctr: string; competition: string; kd: string; google: string; grade: Grade }>): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO radar_bulk (run_id, seed, keyword, sources_json, searches, clicks, ctr, competition, kd, google, grade, batch_id, verified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, keyword) DO UPDATE SET
      seed = excluded.seed,
      sources_json = excluded.sources_json,
      searches = excluded.searches,
      clicks = excluded.clicks,
      ctr = excluded.ctr,
      competition = excluded.competition,
      kd = excluded.kd,
      google = excluded.google,
      grade = excluded.grade,
      batch_id = excluded.batch_id,
      verified_at = excluded.verified_at
  `);
  const now = Date.now();
  const insertMany = db.transaction(() => {
    for (const r of rows) {
      stmt.run(runId, r.seed, r.keyword, JSON.stringify(r.sources), r.searches, r.clicks, r.ctr, r.competition, r.kd, r.google, r.grade, batchId, now);
    }
  });
  insertMany();
}

export interface VerifyOptions {
  runId: string;
  maxBatches?: number;
  browserContextId?: string;
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
  reportProgress?: (done: number, total: number) => void;
}

export interface VerifyResult {
  batchesRun: number;
  totalDone: number;
  totalTodo: number;
  gradeCounts: { A: number; B: number; C: number; drop: number };
}

export async function verifyBulk(opts: VerifyOptions): Promise<VerifyResult> {
  const { runId, appendLog, isAborted, reportProgress } = opts;
  const maxBatches = opts.maxBatches ?? Number.MAX_SAFE_INTEGER;

  const all = loadCandidates(runId);
  if (all.length === 0) throw new Error('没有候选词 — 先跑 ③');
  const done = loadDoneKeywords(runId);
  const todo = all.filter((x) => !done.has(x.keyword));
  appendLog(`▶ 全量 ${all.length} 词 · 已跑 ${done.size} · 待跑 ${todo.length}`);

  if (todo.length === 0) {
    const counts = countGrades(runId);
    return { batchesRun: 0, totalDone: done.size, totalTodo: 0, gradeCounts: counts };
  }

  appendLog(`▶ 启动 AdsPower`);
  const handle = await startAdsPowerForContext(opts.browserContextId);
  const browser = await chromium.connectOverCDP(handle.wsEndpoint);
  const ctx = browser.contexts()[0];
  if (!ctx) {
    await browser.close().catch(() => {});
    throw new Error('AdsPower 无 context');
  }

  let page: Page | null = null;
  for (const p of ctx.pages()) {
    if (/bulk-keyword-tool/i.test(p.url())) { page = p; break; }
  }
  if (!page) {
    page = await ctx.newPage();
    await page.goto(BULK_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } else {
    appendLog(`  复用已开 Bulk Tool tab`);
  }
  await page.waitForLoadState('networkidle').catch(() => {});

  // 抓 quota
  const quota = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = (n.textContent || '').trim();
      const m = t.match(/Quota\s+(\d+)\s*\/\s*(\d+)/i);
      if (m) return { used: +m[1], cap: +m[2] };
    }
    return null;
  }).catch(() => null);
  const remaining = quota ? quota.cap - quota.used : Number.MAX_SAFE_INTEGER;
  if (quota) appendLog(`▶ 当前配额 ${quota.used}/${quota.cap} (余 ${remaining})`);

  const allowed = Math.min(Math.ceil(todo.length / BATCH_SIZE), maxBatches, remaining);
  if (allowed <= 0) {
    await browser.close().catch(() => {});
    throw new Error(`无可跑批次(maxBatches=${maxBatches} · 配额余 ${remaining})`);
  }

  const thisRun = todo.slice(0, allowed * BATCH_SIZE);
  const batches = chunk(thisRun, BATCH_SIZE);
  appendLog(`▶ 本次跑 ${batches.length} 批 / ${thisRun.length} 词`);
  reportProgress?.(0, batches.length);

  const tmpDownloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erank-bulk-'));

  let okCount = 0;
  try {
    for (let i = 0; i < batches.length; i++) {
      if (isAborted()) throw new Error('aborted');
      const batchIdx = i + 1;
      const batchId = `${new Date().toISOString().slice(0, 10)}-${batchIdx}`;
      const batchItems = batches[i];
      const keywords = batchItems.map((x) => x.keyword);
      appendLog(`▶ batch ${batchIdx}: ${keywords.length} 词`);
      try {
        const { headers, rows } = await runBatch(page, keywords, tmpDownloadDir, batchIdx);
        const colIdx = buildColIdx(headers);
        const seedMap = new Map(batchItems.map((x) => [x.keyword, x]));
        const toInsert = rows.map((r) => {
          const kw = r[colIdx['Keywords']];
          const meta = seedMap.get(kw);
          const metric = {
            searches: r[colIdx['Avg Searches']],
            clicks: r[colIdx['Avg Clicks']],
            ctr: r[colIdx['Avg CTR']],
            competition: r[colIdx['Etsy Competition']],
            kd: r[colIdx['Keyword Difficulty']],
            google: r[colIdx['Google Searches']],
          };
          return {
            keyword: kw,
            seed: meta?.seed ?? '?',
            sources: meta?.sources ?? [],
            ...metric,
            grade: gradeOf(metric),
          };
        });
        saveRows(runId, batchId, toInsert);
        okCount++;
        reportProgress?.(okCount, batches.length);
        appendLog(`  ✓ batch ${batchIdx} 入库 ${rows.length} 词`);
      } catch (e) {
        appendLog(`  ✗ batch ${batchIdx} 失败: ${(e as Error).message.slice(0, 120)}`, 'warn');
      }
    }
  } finally {
    await browser.close().catch(() => {});
    appendLog(`▶ disconnect CDP · AdsPower 窗口保留`);
  }

  const totalDone = loadDoneKeywords(runId).size;
  const counts = countGrades(runId);
  return { batchesRun: okCount, totalDone, totalTodo: all.length - totalDone, gradeCounts: counts };
}

export function countGrades(runId: string): { A: number; B: number; C: number; drop: number } {
  const db = getDb();
  const rows = db.prepare(`SELECT grade, COUNT(*) as cnt FROM radar_bulk WHERE run_id = ? GROUP BY grade`).all(runId) as Array<{ grade: Grade; cnt: number }>;
  const counts = { A: 0, B: 0, C: 0, drop: 0 };
  for (const r of rows) counts[r.grade] = r.cnt;
  return counts;
}
