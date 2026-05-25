#!/usr/bin/env node
// 探测 Pinterest 4 个 tab 对应的 trendsPreset 参数值
// 策略:打开 trends 页 → 点 4 个 tab → 读 URL → 输出 mapping
import { chromium } from 'playwright';

const PORT = process.argv[2] || '55460';
const TABS = ['Growing trends', 'Seasonal trends', 'Top monthly trends', 'Top yearly trends'];

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  console.log('▶ 打开 https://trends.pinterest.com/?country=US');
  await page.goto('https://trends.pinterest.com/?country=US', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  console.log('▶ 起始 URL:', page.url());

  for (const label of TABS) {
    try {
      // 通过 text 找 tab 按钮(role=tab 或 button 或 link)
      const candidates = await page.$$(`text=${label}`);
      if (candidates.length === 0) {
        console.log(`  ✗ ${label}: 找不到`);
        continue;
      }
      await candidates[0].click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      console.log(`  ✓ ${label}: ${page.url()}`);
    } catch (e) {
      console.log(`  ✗ ${label}: ${e.message}`);
    }
  }

  await page.close().catch(() => {});
  await browser.close();
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
