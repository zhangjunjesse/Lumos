#!/usr/bin/env node
// 直接调 trends.pinterest.com/metrics/ endpoint 拿 keyword 趋势
// 用法: node scripts/_pinterest-metrics-test.mjs <port> [keyword1,keyword2,...]

import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';
const KEYWORDS = (process.argv[3] || 'sword earrings,vow books,dungeon crawler carl').split(',');

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];

  // 必须从 trends 页面发请求,Pinterest 服务器检查 referer
  let page = ctx.pages().find((p) => /trends\.pinterest\.com\/search/i.test(p.url()));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(`https://trends.pinterest.com/search/?country=US&q=${encodeURIComponent(KEYWORDS[0])}&trendsPreset=3`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
  }
  console.log('▶ 当前页:', page.url());

  // 在浏览器上下文里 fetch metrics endpoint(带 cookie)
  const result = await page.evaluate(async (keywords) => {
    const termsParam = keywords.map((k) => k.replace(/ /g, '+')).join('%2C');
    // end_date: 今天往前 1 天(Pinterest 数据延迟 1 天)
    const d = new Date(Date.now() - 24 * 3600 * 1000);
    const endDate = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
    const url = `/metrics/?terms=${termsParam}&country=US&end_date=${endDate}&days=90&aggregation=2&normalize_against_group=false&predicted_days=0`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'x-new-site': 'true',
        },
        credentials: 'include',
      });
      const txt = await res.text();
      return { status: res.status, ok: res.ok, length: txt.length, bodyPreview: txt.slice(0, 1500), url };
    } catch (e) {
      return { error: e.message };
    }
  }, KEYWORDS);

  console.log('▶ 响应:', JSON.stringify(result, null, 2).slice(0, 2000));
  if (!result.ok || !Array.isArray(JSON.parse(result.bodyPreview))) {
    process.exit(1);
  }
  const body = JSON.parse(result.bodyPreview);
  console.log(`✓ 拿到 ${body.length} 个 keyword 数据`);
  result.body = body;
  body.forEach((kw) => {
    const wow = kw.growth_rates?.wow_change;
    const mom = kw.growth_rates?.mom_change;
    const yoy = kw.growth_rates?.yoy_change;
    console.log(`\n=== ${kw.term} ===`);
    console.log(`  growth: wow=${wow}% mom=${mom}% yoy=${yoy}%`);
    console.log(`  counts: ${kw.counts?.length || 0} 周数据`);
    if (kw.counts && kw.counts.length > 0) {
      const first = kw.counts[0];
      const last = kw.counts[kw.counts.length - 1];
      console.log(`  范围: ${first.date} 到 ${last.date}`);
      const maxCount = Math.max(...kw.counts.map((c) => c.normalizedCount));
      console.log(`  最大归一化: ${maxCount}`);
      // 打印简略 sparkline
      const spark = '▁▂▃▄▅▆▇█';
      const line = kw.counts.map((c) => spark[Math.min(7, Math.floor((c.normalizedCount / Math.max(1, maxCount)) * 7))]).join('');
      console.log(`  sparkline: ${line}`);
    }
    console.log(`  has_prediction: ${kw.has_prediction}`);
  });

  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
