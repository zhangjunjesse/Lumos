#!/usr/bin/env node
// 二分测 Pinterest endDate 边界:今天往前几天才能 200
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';
const TERMS = ['mothers day gifts', 'sword earrings', 'vow books'];

async function tryFetch(page, endDate) {
  const termsParam = TERMS.map((k) => k.replace(/ /g, '+')).join('%2C');
  const url = `/metrics/?terms=${termsParam}&country=US&end_date=${endDate}&days=90&aggregation=2&normalize_against_group=false&predicted_days=0`;
  return await page.evaluate(async (u) => {
    try {
      const res = await fetch(u, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'x-new-site': 'true' },
        credentials: 'include',
      });
      const text = await res.text();
      return { status: res.status, len: text.length, preview: text.slice(0, 200) };
    } catch (e) { return { error: e.message }; }
  }, url);
}

function dateNDaysAgo(n) {
  const d = new Date(Date.now() - n * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /trends\.pinterest\.com/i.test(p.url()));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://trends.pinterest.com/?country=US&trendsPreset=3', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
  }
  console.log('▶ 在页:', page.url());

  for (const n of [1, 3, 5, 7, 8, 9, 10, 14, 21]) {
    const endDate = dateNDaysAgo(n);
    const r = await tryFetch(page, endDate);
    console.log(`  ${n}d ago end_date=${endDate} → status=${r.status} len=${r.len} preview=${(r.preview || '').slice(0, 80)}`);
    await page.waitForTimeout(600);
  }
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
