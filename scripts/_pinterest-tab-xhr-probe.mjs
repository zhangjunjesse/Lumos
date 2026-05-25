#!/usr/bin/env node
// 切 Pinterest 4 个 tab 时拦截所有 XHR,看真实数据源
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  const seenUrls = new Set();
  const log = (tag, url) => {
    if (seenUrls.has(`${tag}|${url}`)) return;
    seenUrls.add(`${tag}|${url}`);
    // 缩 URL 显示
    const u = url.replace(/^https?:\/\/[^/]+/, '').slice(0, 200);
    console.log(`  [${tag}] ${u}`);
  };

  page.on('response', (res) => {
    const url = res.url();
    if (!/trends\.pinterest\.com/i.test(url)) return;
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    if (/\.(js|css|svg|png|woff|jpg|gif)/i.test(url)) return;
    // 取 path 部分
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    log('JSON', url);
  });

  console.log('▶ 打开 https://trends.pinterest.com/?country=US(Growing 默认)');
  await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  for (const tab of ['Seasonal trends', 'Top monthly trends', 'Top yearly trends', 'Growing trends']) {
    seenUrls.clear();
    console.log(`\n▶ 点 "${tab}"`);
    try {
      const el = await page.$(`text=${tab}`);
      if (!el) { console.log('  找不到 tab'); continue; }
      await el.click();
      await page.waitForTimeout(4000);
    } catch (e) { console.log('  click err:', e.message); }
  }

  await page.close().catch(() => {});
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
