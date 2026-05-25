#!/usr/bin/env node
// 探测 EHunt 插件是否注入到 Etsy 搜索页 — 抓单条 listing 卡片完整 DOM
// 用法: node scripts/_ehunt-probe.mjs <port>

import { chromium } from 'playwright';

const PORT = process.argv[2] || '58491';
const KEYWORD = process.argv[3] || 'fursuit head';
const URL = `https://www.etsy.com/search?q=${encodeURIComponent(KEYWORD)}`;

async function main() {
  console.log(`▶ CDP :${PORT}  · search "${KEYWORD}"`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];

  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('▶ 等 listing 网格出现');
  await page.waitForSelector('[data-listing-id]', { timeout: 30000 });
  console.log('▶ 等 8 秒让 EHunt 注入');
  await page.waitForTimeout(8000);

  // dump 第一个 listing 卡片 outerHTML + 看 EHunt 注入标记
  const probe = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-listing-id]')];
    const first = items[0];
    if (!first) return { found: false, total: 0 };

    const all = first.outerHTML;
    const ehuntMarkers = [
      '[class*="ehunt"]',
      '[class*="EHunt"]',
      '[class*="e-hunt"]',
      '[id*="ehunt"]',
      '[id*="EHunt"]',
      '[data-ehunt]',
      '[data-e-hunt]',
    ]
      .map((sel) => ({ sel, count: document.querySelectorAll(sel).length }))
      .filter((x) => x.count > 0);

    // 取所有 inline class 看有没有非 Etsy 命名空间的 element
    const inlineEls = first.querySelectorAll('[style*="position"]');
    const customClassNames = new Set();
    first.querySelectorAll('*').forEach((el) => {
      el.classList.forEach((c) => {
        if (!c.startsWith('wt-') && !c.startsWith('v2-listing') && !c.startsWith('search-')) {
          customClassNames.add(c);
        }
      });
    });

    return {
      found: true,
      total: items.length,
      first_outer: all.slice(0, 6000),
      ehuntMarkers,
      customClassNames: [...customClassNames].slice(0, 30),
      inlineStyleEls: inlineEls.length,
    };
  });

  console.log('\n=== probe 结果 ===');
  console.log('listing 总数:', probe.total);
  console.log('EHunt selector 命中:', JSON.stringify(probe.ehuntMarkers, null, 2));
  console.log('非 wt-* 的 classNames(前 30):', probe.customClassNames);
  console.log('inline style elements(possibly injected):', probe.inlineStyleEls);
  console.log('\n=== 第一个 listing outerHTML 前 6000 字符 ===');
  console.log(probe.first_outer);

  await page.close();
  await browser.close();
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
