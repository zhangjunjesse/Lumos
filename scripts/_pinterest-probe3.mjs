#!/usr/bin/env node
// 在 search 框输入 sword earrings 后,看 Pinterest 触发什么 API
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  page.on('response', async (res) => {
    const url = res.url();
    if (!/trends\.pinterest\.com/i.test(url)) return;
    if (!/\?|\/$/.test(url)) return;
    if (/\.(js|css|svg|png|woff)/i.test(url)) return;
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const body = await res.text();
      if (/sword|dagger|earring/i.test(body) || /sword|dagger/i.test(url)) {
        console.log('\n=== 命中 sword/earring 关键词 ===');
        console.log('URL:', url);
        console.log('Status:', res.status());
        console.log('Body 前 800:', body.slice(0, 800));
      }
    } catch {}
  });

  // 直接打开 search 页 keyword query 参数
  await page.goto('https://trends.pinterest.com/search/?country=US&q=sword%20earrings&trendsPreset=3', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  await page.close();
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
