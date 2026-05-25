#!/usr/bin/env node
// 探 EHunt 注入的 .eh-mask-info-fetched-item 真实 innerText 格式
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';
const Q = process.argv[3] || 'graduation nails';

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto(`https://www.etsy.com/search?q=${encodeURIComponent(Q)}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForSelector('[data-listing-id]', { timeout: 20_000 });
  console.log('▶ 等 EHunt 注入 25 秒...');
  try {
    await page.waitForFunction(() => document.querySelectorAll('.eh-mask-info-fetched-item').length >= 6, { timeout: 25_000 });
  } catch { console.log('  超时, 不到 6 个,看看实际有多少'); }
  await page.waitForTimeout(2_000);

  const probe = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.eh-mask-info-fetched-item')];
    return {
      count: items.length,
      samples: items.slice(0, 5).map((el) => ({
        innerText: el.innerText || '',
        innerHTML: (el.innerHTML || '').slice(0, 200),
        cls: el.className.toString(),
      })),
    };
  });

  console.log(`▶ 注入 item 数: ${probe.count}`);
  probe.samples.forEach((s, i) => {
    console.log(`\n--- sample ${i + 1} ---`);
    console.log(`innerText: ${JSON.stringify(s.innerText)}`);
    console.log(`cls: ${s.cls}`);
    console.log(`innerHTML 200: ${s.innerHTML}`);
  });

  await page.close().catch(() => {});
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
