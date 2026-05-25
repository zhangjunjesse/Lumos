#!/usr/bin/env node
// 探测 trends.pinterest.com 的 ajax 接口
// 导航 trends.pinterest.com/search?q=sword%20earrings → 拦截所有 xhr → dump

import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';
const KEYWORD = process.argv[3] || 'sword earrings';

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  const captured = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!/pinterest\.com/i.test(url)) return;
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const body = await res.text();
      if (body.length < 100) return;
      captured.push({
        url: url.slice(0, 200),
        status: res.status(),
        size: body.length,
        method: res.request().method(),
        bodyPreview: body.slice(0, 600),
      });
    } catch {}
  });

  const target = `https://trends.pinterest.com/search/?country=US&q=${encodeURIComponent(KEYWORD)}&trendsPreset=3`;
  console.log(`▶ 打开 ${target}`);
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // 等 ajax 完成
  await page.waitForTimeout(10_000);

  // 看页面 URL,是否被重定向到登录
  console.log(`▶ 最终 URL: ${page.url()}`);
  const title = await page.title();
  console.log(`▶ 标题: ${title}`);

  console.log(`\n▶ 捕获 ${captured.length} 个 pinterest.com 的 JSON 响应:\n`);
  captured.forEach((r, i) => {
    console.log(`${i + 1}. [${r.method} ${r.status}] ${r.url}`);
    console.log(`   size=${r.size}, preview: ${r.bodyPreview.slice(0, 300).replace(/\s+/g, ' ')}`);
    console.log();
  });

  await page.close();
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
