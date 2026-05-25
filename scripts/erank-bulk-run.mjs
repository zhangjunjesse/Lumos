#!/usr/bin/env node
// ④ Bulk 验真 - 单关键词真实跑
// 用法:node scripts/erank-bulk-run.mjs --keyword="autism pin"
// 会扣 1 个 eRank 月配额

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const PROFILE = args.profile ?? 'k1ck97si';
const API = args.api ?? 'http://127.0.0.1:50326';
const KEYWORD = args.keyword ?? 'autism pin';
const OUT = path.resolve(args.out ?? './tmp/erank-bulk');
const BULK_URL = 'https://members.erank.com/bulk-keyword-tool';

async function startProfile() {
  const r = await fetch(`${API}/api/v1/browser/start?user_id=${PROFILE}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg);
  return j.data.debug_port;
}

async function run() {
  await mkdir(OUT, { recursive: true });
  console.log(`▶ keyword="${KEYWORD}"`);
  const port = await startProfile();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];

  // 优先复用已开着的 Bulk Keyword Tool tab(避免重新 Analyze 再扣配额)
  let page = null;
  for (const p of ctx.pages()) {
    if (/bulk-keyword-tool/i.test(p.url())) {
      // 检查是否已有结果(tbody 有行)
      const hasResult = await p
        .evaluate(() => {
          const tbody = document.querySelector('table tbody');
          return !!(tbody && tbody.querySelectorAll('tr').length > 0);
        })
        .catch(() => false);
      if (hasResult) {
        page = p;
        console.log(`  ✓ 复用已有 tab(有结果) ${p.url()}`);
        break;
      }
    }
  }

  if (!page) {
    console.log('  无可复用 tab,新开 tab 重跑(将扣配额)');
    page = await ctx.newPage();
    await page.goto(BULK_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (/login|signin/i.test(page.url())) {
      console.log(`  ⚠ 跳登录 ${page.url()}`);
      await browser.close();
      return;
    }
    await page.waitForLoadState('networkidle').catch(() => {});
    await page
      .waitForSelector('textarea[placeholder*="Enter keywords"]', { timeout: 30_000 })
      .catch(() => {});

    const ta = await page.$('textarea[placeholder*="Enter keywords"]');
    if (!ta) throw new Error('找不到 textarea');
    await ta.click();
    await ta.fill(KEYWORD);
    console.log(`  ✓ 输入 "${KEYWORD}"`);
    await page.screenshot({ path: path.join(OUT, 'bulk-1-input.png'), fullPage: true });

    const analyzeBtn = await page.$('button:has-text("Analyze")');
    if (!analyzeBtn) throw new Error('找不到 Analyze 按钮');
    console.log('  → 点 Analyze(扣配额)');
    await analyzeBtn.click();

    console.log('  等待结果...');
    await page
      .waitForFunction(
        () => {
          const tbody = document.querySelector('table tbody');
          if (tbody && tbody.querySelectorAll('tr').length > 0) return true;
          return /search\s*volume|monthly\s*searches|competition|results/i.test(
            document.body.innerText,
          );
        },
        { timeout: 60_000 },
      )
      .catch(() => console.log('  ⚠ 60s 内未见明显结果'));
    await page.waitForTimeout(2_000);
  }

  // 4. 截图结果态(fullPage,触发懒加载)
  await page.screenshot({ path: path.join(OUT, 'bulk-2-result.png'), fullPage: true });

  // 5. dump 结果页 DOM 结构(找表 + 找导出按钮)
  const probe = await page.evaluate(() => {
    const o = {};
    o.url = location.href;
    o.title = document.title;
    o.tables = [...document.querySelectorAll('table')].map((t) => {
      const headers = [...t.querySelectorAll('thead th')].map((th) => th.innerText.trim());
      const rows = [...t.querySelectorAll('tbody tr')].slice(0, 5).map((tr) =>
        [...tr.querySelectorAll('td')].map((td) => td.innerText.trim()),
      );
      return { headers, rowsSample: rows, totalRows: t.querySelectorAll('tbody tr').length };
    });
    o.buttons = [...document.querySelectorAll('button, a')]
      .map((b) => ({ text: (b.innerText || '').trim(), href: b.getAttribute('href') }))
      .filter((b) => b.text && b.text.length < 60 &&
        (/export|download|csv|save\s*list/i.test(b.text)));
    return o;
  });

  console.log(`\n▶ 结果页 ${probe.url}`);
  console.log(`  Title: ${probe.title}`);
  console.log(`  表格数: ${probe.tables.length}`);
  probe.tables.forEach((t, i) => {
    console.log(`  表 #${i}: ${t.totalRows} 行 · headers=[${t.headers.join(' | ')}]`);
    t.rowsSample.forEach((r, j) => console.log(`    row ${j + 1}: ${r.join(' | ')}`));
  });
  console.log(`  导出/下载按钮: ${probe.buttons.map((b) => b.text).join(' | ') || '无'}`);

  await writeFile(path.join(OUT, 'bulk-result-probe.json'), JSON.stringify(probe, null, 2));

  // 6. 点 Export 展开下拉,再点 "Download as CSV" 触发下载
  const exportBtn = await page.$('button:has-text("Export"), a:has-text("Export")');
  if (exportBtn) {
    console.log('\n▶ 点 Export 展开菜单...');
    await exportBtn.click();
    await page.waitForTimeout(500);

    // 用 evaluate 找文本含 "Download as CSV" 的可点元素(不挑 tag)
    const csvHandle = await page.evaluateHandle(() => {
      const all = [...document.querySelectorAll('*')];
      return all.find((el) => {
        const t = (el.textContent || '').trim();
        return t === 'Download as CSV' || t === 'CSV';
      });
    });
    const csvEl = csvHandle ? csvHandle.asElement() : null;
    if (csvEl) {
      console.log('  → 点 Download as CSV');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }).catch(() => null),
        csvEl.click(),
      ]);
      if (download) {
        const csvPath = path.join(OUT, 'autism-pin.csv');
        await download.saveAs(csvPath);
        console.log(`  ✓ CSV 落地:${csvPath}`);
        console.log(`  原文件名:${download.suggestedFilename()}`);
      } else {
        console.log('  ⚠ 未触发 download 事件');
        await page.screenshot({ path: path.join(OUT, 'bulk-3-after-export.png'), fullPage: true });
      }
    } else {
      console.log('  ⚠ 没找到 Download as CSV 菜单项');
      await page.screenshot({ path: path.join(OUT, 'bulk-3-after-export.png'), fullPage: true });
    }
  } else {
    console.log('  ⚠ 没找到 Export 按钮');
  }

  await browser.close().catch(() => {});
  console.log('\n▶ disconnect CDP · AdsPower 窗口保留');
}

run().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
