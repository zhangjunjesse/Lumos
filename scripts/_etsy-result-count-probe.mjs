#!/usr/bin/env node
// 探 etsy.com/search 页里"结果总数"在哪个 selector
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';
const Q = process.argv[3] || 'graduation nails';

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  await page.goto(`https://www.etsy.com/search?q=${encodeURIComponent(Q)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4000);

  const probe = await page.evaluate(() => {
    // 1. 扫所有 <h1>/<h2>/<span> 文本含 "result" 的元素
    const out = [];
    const all = document.querySelectorAll('h1, h2, h3, [class*="search-result"], [class*="SearchResult"], [data-test-id*="result"], [aria-label*="result"]');
    for (const el of all) {
      const t = (el.textContent || '').trim();
      if (t && t.length < 200 && /result|件|结果/i.test(t)) {
        out.push({
          tag: el.tagName,
          cls: el.className.toString().slice(0, 100),
          ariaLabel: el.getAttribute('aria-label') || '',
          dataTest: el.getAttribute('data-test-id') || '',
          text: t.slice(0, 100),
        });
      }
    }
    // 2. 找 body 文本里所有 "X+ results / X results" 模式
    const bodyText = document.body.innerText || '';
    const matches = [...bodyText.matchAll(/[\d,]+\+?\s*(?:results?|件结果|个结果)/gi)].slice(0, 5);
    return { hits: out, bodyMatches: matches.map((m) => m[0]) };
  });

  console.log('▶ 命中元素:');
  for (const h of probe.hits) {
    console.log(`  [${h.tag}] dataTest="${h.dataTest}" aria="${h.ariaLabel}" cls="${h.cls}"`);
    console.log(`    text: ${h.text}`);
  }
  console.log('▶ body 文本里的 "X results" 模式:', probe.bodyMatches);

  await page.close().catch(() => {});
  await browser.close();
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
