#!/usr/bin/env node
// 二分 /top_trends_filtered/ numTermsToReturn 上限
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';

async function tryFetch(page, num) {
  const url = `/top_trends_filtered/?lookbackWindow=2&endDate=2026-05-14&rankingMethod=3&country=US&trendsPreset=3&numTermsToReturn=${num}`;
  return await page.evaluate(async (u) => {
    try {
      const res = await fetch(u, { headers: { Accept: 'application/json', 'x-new-site': 'true' }, credentials: 'include' });
      const text = await res.text();
      let len = 0;
      try { const j = JSON.parse(text); len = Array.isArray(j.values) ? j.values.length : -1; } catch { len = -1; }
      return { status: res.status, body_chars: text.length, values_len: len, preview: text.slice(0, 100) };
    } catch (e) { return { error: e.message }; }
  }, url);
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /trends\.pinterest\.com/i.test(p.url()));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
  }
  for (const n of [10, 20, 25, 30, 40, 50, 75, 100, 150, 200]) {
    const r = await tryFetch(page, n);
    console.log(`  num=${n.toString().padStart(3)} → status=${r.status} body_chars=${r.body_chars} values_len=${r.values_len} preview=${r.preview}`);
    await page.waitForTimeout(400);
  }
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
