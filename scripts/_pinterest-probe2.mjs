#!/usr/bin/env node
// 拦截 metrics 请求,dump 完整 URL + headers
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  page.on('request', (req) => {
    const url = req.url();
    if (!/metrics\/?\?/.test(url)) return;
    console.log('\n=== metrics request ===');
    console.log('URL:', url);
    console.log('Method:', req.method());
    console.log('Headers:', JSON.stringify(req.headers(), null, 2));
  });

  await page.goto('https://trends.pinterest.com/search/?country=US&q=sword%20earrings&trendsPreset=3', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  await page.close();
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
