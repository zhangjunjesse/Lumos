#!/usr/bin/env node
// 直接调 /top_trends_filtered/ 看 response 格式
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';
const PRESET = process.argv[3] || '3';   // 3=growing 4=seasonal 1=monthly 2=yearly
const COUNTRY = 'US';
const NUM = 20;

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /trends\.pinterest\.com/i.test(p.url()));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }

  const endDate = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const url = `/top_trends_filtered/?lookbackWindow=2&endDate=${endDate}&rankingMethod=3&country=${COUNTRY}&trendsPreset=${PRESET}&numTermsToReturn=${NUM}`;
  console.log('▶ GET', url);

  const r = await page.evaluate(async (u) => {
    try {
      const res = await fetch(u, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'x-new-site': 'true' },
        credentials: 'include',
      });
      const text = await res.text();
      return { status: res.status, length: text.length, preview: text.slice(0, 2000) };
    } catch (e) { return { error: e.message }; }
  }, url);

  console.log('▶ status', r.status, 'len', r.length);
  console.log('▶ body preview:\n', r.preview);

  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
