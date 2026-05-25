#!/usr/bin/env node
// ④ Bulk 验真 - 续跑模式
// 从 tmp/etsy-expand/merged.json 读全部 ③ 扩词产物,扁平化去重
// state 文件记录已跑词,下次自动跳过 + 配额内尽量跑
// 用法: node scripts/erank-bulk-batch.mjs [--max-batches=30]

import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const API = args.api ?? 'http://127.0.0.1:50325';
const PROFILE = args.profile ?? 'k1ck97si';
const BULK_URL = 'https://members.erank.com/bulk-keyword-tool';
const OUT = path.resolve('./tmp/erank-bulk');
const STATE_PATH = path.join(OUT, 'state.json');
const BATCH_SIZE = 20;
const MAX_BATCHES = args['max-batches'] ? Number(args['max-batches']) : Infinity;

// 从 merged.json(③ 扩词产物)读全部 keywords,扁平化 + 去重 + 带 seed 溯源
async function loadKeywords() {
  const merged = JSON.parse(await readFile('./tmp/etsy-expand/merged.json', 'utf8'));
  const list = [];
  const seen = new Set();
  for (const [seed, words] of Object.entries(merged)) {
    // seed 本身也送验真(② 给了 search/ctr/competition,但 ④ 才给 KD)
    if (!seen.has(seed)) {
      seen.add(seed);
      list.push({ seed, keyword: seed, sources: ['seed'] });
    }
    for (const w of words) {
      if (seen.has(w.keyword)) continue;
      seen.add(w.keyword);
      list.push({ seed, keyword: w.keyword, sources: w.sources });
    }
  }
  return list;
}

// 主流程入口标记 — 旧的 81 行 loadKeywords for niche/source 已不用
async function _legacyUnused() {
  const src = await readFile('src/components/apps/builtin/etsy-erank/mock-data.ts', 'utf8');
  const block = src.match(/CONVERGED_CLUSTERS[\s\S]+?^\];/m)[0];
  const clusters = [];
  const re =
    /name:\s*'([^']+)'[\s\S]+?core:\s*'([^']+)'[\s\S]+?variants:\s*\[([\s\S]+?)\]/g;
  let m;
  while ((m = re.exec(block))) {
    const [, name, core, variantsRaw] = m;
    const variants = [...variantsRaw.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    clusters.push({ name, core, variants });
  }
  const list = [];
  for (const c of clusters) {
    list.push({ niche: c.name, source: 'core', keyword: c.core });
    for (const v of c.variants.slice(0, 7)) {
      list.push({ niche: c.name, source: 'variant', keyword: v });
    }
  }
  return list;
}

async function startProfile() {
  const r = await fetch(`${API}/api/v1/browser/start?user_id=${PROFILE}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg);
  return j.data.debug_port;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function parseCsvText(text) {
  // 简易 CSV 解析(eRank 导出格式:UTF-8 BOM + "field","field",number)
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

async function runBatch(page, keywords, batchIdx) {
  console.log(`\n▶ batch ${batchIdx}: ${keywords.length} 词`);
  // 等输入框
  await page
    .waitForSelector('textarea[placeholder*="Enter keywords"]', { timeout: 30_000 })
    .catch(() => {});
  const ta = await page.$('textarea[placeholder*="Enter keywords"]');
  if (!ta) throw new Error('找不到 textarea');
  await ta.click();
  await ta.fill('');
  await page.waitForTimeout(300);
  await ta.fill(keywords.join('\n'));
  console.log(`  ✓ 输入 ${keywords.length} 词`);

  const analyzeBtn = await page.$('button:has-text("Analyze")');
  if (!analyzeBtn) throw new Error('找不到 Analyze 按钮');
  await analyzeBtn.click();
  console.log('  → Analyze(扣配额)');

  await page
    .waitForFunction(
      (expected) => {
        const tbody = document.querySelector('table tbody');
        return tbody && tbody.querySelectorAll('tr').length >= expected;
      },
      keywords.length,
      { timeout: 90_000 },
    )
    .catch(() => console.log('  ⚠ 90s 内未见全部结果'));
  await page.waitForTimeout(1500);

  await page.screenshot({ path: path.join(OUT, `batch-${batchIdx}.png`), fullPage: true });

  // Export → Download as CSV
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
  const csvPath = path.join(OUT, `batch-${batchIdx}.csv`);
  await download.saveAs(csvPath);
  const text = await readFile(csvPath, 'utf8');
  const { headers, rows } = parseCsvText(text);
  console.log(`  ✓ CSV: ${rows.length} 行 · headers=[${headers.join(' | ')}]`);
  return { headers, rows, csvPath };
}

async function run() {
  await mkdir(OUT, { recursive: true });

  // 1. 读全量 keywords(③ 扩词产物 + seed 自身)
  const all = await loadKeywords();
  console.log(`▶ 全量 keywords: ${all.length} 词`);

  // 2. 读 state(已跑过的词不再跑)
  let state = { done_keywords: {}, runs: [] };
  try {
    state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    console.log(`▶ state cache: 已跑 ${Object.keys(state.done_keywords).length} 词`);
  } catch {
    console.log('▶ state cache 无,从头跑');
  }

  // 3. 过滤剩余 TODO
  const todo = all.filter((x) => !(x.keyword in state.done_keywords));
  console.log(`▶ 剩余 TODO: ${todo.length} 词 (= ${Math.ceil(todo.length / BATCH_SIZE)} 批)`);
  if (todo.length === 0) {
    console.log('✓ 全部已跑完,无需重跑');
    return;
  }

  // 4. 启 AdsPower + 进 Bulk Tool
  const port = args.port ?? (await startProfile());
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30000 });
  const ctx = browser.contexts()[0];

  let page = null;
  for (const p of ctx.pages()) {
    if (/bulk-keyword-tool/i.test(p.url())) { page = p; break; }
  }
  if (!page) {
    page = await ctx.newPage();
    await page.goto(BULK_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } else {
    console.log('  ✓ 复用已开 tab');
  }
  await page.waitForLoadState('networkidle').catch(() => {});

  // 5. 抓 Quota
  const quota = await page
    .evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = (n.textContent || '').trim();
        const m = t.match(/Quota\s+(\d+)\s*\/\s*(\d+)/i);
        if (m) return { used: +m[1], cap: +m[2] };
      }
      return null;
    })
    .catch(() => null);
  const remaining = quota ? quota.cap - quota.used : Infinity;
  if (quota) {
    console.log(`▶ 当前配额 ${quota.used}/${quota.cap} (余 ${remaining} 次)`);
  } else {
    console.log('⚠ 抓不到 Quota 数字,跳过预扣检查');
  }

  // 6. 算本次跑多少批(min of TODO/MAX_BATCHES/quota余)
  const allowed = Math.min(
    Math.ceil(todo.length / BATCH_SIZE),
    MAX_BATCHES,
    remaining,
  );
  if (allowed <= 0) {
    console.log(`✗ 无可跑批次(MAX_BATCHES=${MAX_BATCHES},余 ${remaining})`);
    await browser.close().catch(() => {});
    return;
  }
  const thisRun = todo.slice(0, allowed * BATCH_SIZE);
  const batches = chunk(thisRun, BATCH_SIZE);
  console.log(`▶ 本次跑 ${batches.length} 批 / ${thisRun.length} 词(MAX_BATCHES=${MAX_BATCHES === Infinity ? '∞' : MAX_BATCHES})`);

  // 7. CSV 列名映射(SOP §6.2 字段漂移防护)
  const REQUIRED_COLS = ['Keywords', 'Avg Searches', 'Avg Clicks', 'Avg CTR', 'Etsy Competition', 'Keyword Difficulty', 'Google Searches'];
  function buildColIdx(headers, batchIdx) {
    const idx = {};
    for (const col of REQUIRED_COLS) {
      const i = headers.findIndex((h) => h.trim() === col);
      if (i < 0) throw new Error(`batch ${batchIdx} CSV 缺列「${col}」(字段漂移?headers=${headers.join('|')})`);
      idx[col] = i;
    }
    return idx;
  }

  // 8. 跑批 + 每批立即写 state
  let okCount = 0;
  for (let i = 0; i < batches.length; i++) {
    const batchId = `${new Date().toISOString().slice(0, 10)}-${i + 1}`;
    const keywords = batches[i].map((x) => x.keyword);
    try {
      const { headers, rows } = await runBatch(page, keywords, i + 1);
      const colIdx = buildColIdx(headers, i + 1);
      const seedMap = new Map(batches[i].map((x) => [x.keyword, x]));
      for (const r of rows) {
        const kw = r[colIdx['Keywords']];
        const meta = seedMap.get(kw);
        state.done_keywords[kw] = {
          seed: meta?.seed ?? '?',
          sources: meta?.sources ?? [],
          searches: r[colIdx['Avg Searches']],
          clicks: r[colIdx['Avg Clicks']],
          ctr: r[colIdx['Avg CTR']],
          competition: r[colIdx['Etsy Competition']],
          kd: r[colIdx['Keyword Difficulty']],
          google: r[colIdx['Google Searches']],
          ranAt: new Date().toISOString(),
          batchId,
        };
      }
      okCount++;
      // 每批立即写 state(防中断丢数据)
      await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
    } catch (e) {
      console.log(`  ✗ batch ${i + 1} 失败: ${e.message}(单批失败不阻塞,继续)`);
    }
  }

  // 9. 记录这次 run
  state.runs = state.runs || [];
  state.runs.push({
    date: new Date().toISOString(),
    batches: okCount,
    words: okCount * BATCH_SIZE,
    quota_before: quota ? `${quota.used}/${quota.cap}` : 'unknown',
  });
  state.last_run = new Date().toISOString();
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));

  // 10. 重建 all-metrics.json(从 state 全量重建,审计用)
  const allRows = Object.entries(state.done_keywords).map(([keyword, m]) => ({
    keyword,
    seed: m.seed,
    sources: m.sources,
    searches: m.searches,
    clicks: m.clicks,
    ctr: m.ctr,
    competition: m.competition,
    kd: m.kd,
    google: m.google,
    ranAt: m.ranAt,
    batchId: m.batchId,
  }));
  await writeFile(path.join(OUT, 'all-metrics.json'), JSON.stringify({ rows: allRows }, null, 2));

  // 11. 总结
  const done = Object.keys(state.done_keywords).length;
  console.log(`\n=== 本次 ===`);
  console.log(`✓ 跑 ${okCount} 批 / 累计 ${done} / ${all.length} 词`);
  console.log(`✓ 配额消耗: ${okCount} 次`);
  if (done < all.length) {
    const stillNeed = Math.ceil((all.length - done) / BATCH_SIZE);
    console.log(`⏳ 还需 ${stillNeed} 批跑完剩余 ${all.length - done} 词`);
    console.log(`   下次直接 \`node scripts/erank-bulk-batch.mjs --max-batches=N\` 续跑`);
  } else {
    console.log(`✓ 全部跑完`);
  }
  console.log(`\n state: ${STATE_PATH}`);
  console.log(` all-metrics: ${path.join(OUT, 'all-metrics.json')}`);

  await browser.close().catch(() => {});
  console.log('▶ disconnect CDP · AdsPower 窗口保留');
}

run().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
