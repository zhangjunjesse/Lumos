#!/usr/bin/env node
// 探 EHunt 扩展是否在页面 active,扫所有可能的 EHunt 注入 selector
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';
const Q = process.argv[3] || 'graduation nails';

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto(`https://www.etsy.com/search?q=${encodeURIComponent(Q)}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForSelector('[data-listing-id]', { timeout: 20_000 });
  console.log('▶ 等 30 秒,扫所有可能的 EHunt selector');
  await page.waitForTimeout(30_000);

  const probe = await page.evaluate(() => {
    // 扫所有 .eh-* / .ehunt-* / 包含 "ehunt" 的元素
    const ehuntElems = [...document.querySelectorAll('[class*="eh-"], [class*="ehunt" i], [id*="eh-"], [id*="ehunt" i]')];
    const counts = {};
    ehuntElems.forEach((el) => {
      const cls = el.className.toString();
      counts[cls] = (counts[cls] || 0) + 1;
    });
    // 看是否注入任何全局变量
    const wKeys = Object.keys(window).filter((k) => /eh(unt)?/i.test(k));
    // listing card 数
    const listings = document.querySelectorAll('[data-listing-id]').length;
    return { ehuntElemCount: ehuntElems.length, counts, windowKeys: wKeys, listingCount: listings };
  });

  console.log(`▶ listing card 数: ${probe.listingCount}`);
  console.log(`▶ EHunt 相关元素总数: ${probe.ehuntElemCount}`);
  console.log(`▶ window 上 EH 相关 keys:`, probe.windowKeys);
  console.log(`▶ class 分布:`);
  Object.entries(probe.counts).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([cls, n]) => console.log(`  ${n}× ${cls}`));

  await page.close().catch(() => {});
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
