#!/usr/bin/env node
// 读 Bulk Keyword Tool 顶部 Quota 数字
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const API = 'http://127.0.0.1:50325';
const OUT = './tmp/erank-bulk';
await mkdir(OUT, { recursive: true });

const r = await fetch(`${API}/api/v1/browser/start?user_id=k1ck97si`);
const j = await r.json();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${j.data.debug_port}`);
const ctx = browser.contexts()[0];

// 复用已开 tab
let page = null;
for (const p of ctx.pages()) {
  if (/bulk-keyword-tool/i.test(p.url())) {
    page = p;
    break;
  }
}
if (!page) {
  page = await ctx.newPage();
  await page.goto('https://members.erank.com/bulk-keyword-tool', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2000);
}

// reload 确保拿最新数字
await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
await page.waitForTimeout(2500);

// 截图 + dump 含 "Quota" 字样的文本
await page.screenshot({ path: path.join(OUT, 'quota-check.png'), fullPage: false });

const quota = await page.evaluate(() => {
  // 找页面所有节点里含 "Quota" 的
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const t = (n.textContent || '').trim();
    if (t && /quota|searches?\s*[:：]?\s*\d/i.test(t)) texts.push(t);
  }
  return texts.slice(0, 20);
});

console.log('页面含 quota/searches 的文本:');
quota.forEach((t) => console.log('  → ' + t));

await browser.close().catch(() => {});
