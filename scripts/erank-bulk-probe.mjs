#!/usr/bin/env node
// ④ Bulk 验真 - 探测脚本(单关键词)
// 用法:node scripts/erank-bulk-probe.mjs --keyword="autism pin" [--api=http://127.0.0.1:50326]
// 目的:跑 1 个关键词,看 eRank Bulk Keyword Tool 真实导出 CSV 长啥样,定位选择器
// ⚠ 这会扣 1 个 eRank 月配额

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const PROFILE = args.profile ?? 'k1ck97si';
const API = args.api ?? 'http://127.0.0.1:50326';
const KEYWORD = args.keyword ?? 'autism pin';
const OUT = path.resolve(args.out ?? './tmp/erank-bulk');

async function startProfile() {
  const r = await fetch(`${API}/api/v1/browser/start?user_id=${PROFILE}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(`AdsPower start: ${j.msg}`);
  return j.data.debug_port;
}

async function discoverBulkUrl(page) {
  // 从已加载页面侧边栏发现 Bulk Keyword Tool 真实 href
  return page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')];
    const match = links.find((a) => /bulk\s*keyword/i.test(a.textContent || ''));
    return match ? new URL(match.getAttribute('href'), location.origin).toString() : null;
  });
}

async function run() {
  await mkdir(OUT, { recursive: true });
  console.log(`▶ profile=${PROFILE} · keyword="${KEYWORD}"`);
  const port = await startProfile();
  console.log(`  debug_port=${port}`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('AdsPower 无 context');

  // 1. 先去 Trend Buzz(稳定入口)加载侧边栏,发现 Bulk Keyword Tool 真实 URL
  const navPage = await ctx.newPage();
  await navPage.goto('https://erank.com/trend-buzz', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  if (/login|signin/i.test(navPage.url())) {
    console.log(`  ⚠ 跳登录 ${navPage.url()}`);
    return;
  }
  const bulkUrl = await discoverBulkUrl(navPage);
  if (!bulkUrl) {
    // 兜底:eRank 公开文档常见路径
    console.log('  ⚠ 侧边栏找不到 Bulk Keyword Tool 链接,尝试常见路径');
    const candidates = [
      'https://erank.com/keyword-tool/bulk',
      'https://erank.com/bulk-keyword-tool',
      'https://erank.com/tools/bulk-keyword',
    ];
    for (const u of candidates) {
      const p = await ctx.newPage();
      await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
      const ok = !/(404|not found)/i.test(await p.title());
      console.log(`    ${u} → ${p.url()} ${ok ? 'OK' : '404'}`);
      if (ok) {
        await dumpPageStructure(p);
        await browser.close().catch(() => {});
        return;
      }
      await p.close();
    }
    await browser.close().catch(() => {});
    return;
  }
  console.log(`▶ Bulk Keyword Tool URL: ${bulkUrl}`);

  // 2. 打开 Bulk Keyword Tool
  const page = await ctx.newPage();
  await page.goto(bulkUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});

  // 3. dump 页面结构,定位输入框和"提交"按钮
  await dumpPageStructure(page);

  await browser.close().catch(() => {});
  console.log('▶ disconnect CDP · AdsPower 窗口保留');
}

async function dumpPageStructure(page) {
  // 等 SPA hydrate:等到出现可交互元素(textarea / button / input) 或 30 秒
  console.log('  等待页面 hydrate...');
  await page
    .waitForFunction(
      () => {
        const ta = document.querySelectorAll('textarea').length;
        const btn = document.querySelectorAll('button').length;
        const inp = document.querySelectorAll('input').length;
        return ta + btn + inp > 0;
      },
      { timeout: 30_000 },
    )
    .catch(() => console.log('  ⚠ 30s 内未见 textarea/button/input'));
  // 再多等 2s 让 React 完全渲染
  await page.waitForTimeout(2_000);

  const shot = path.join(OUT, 'bulk-page-empty.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`  截图:${shot}`);

  // 抓所有 textarea / textbox / input + 主要 button
  const probe = await page.evaluate(() => {
    const out = {};
    out.url = location.href;
    out.title = document.title;
    out.textareas = [...document.querySelectorAll('textarea')].map((t) => ({
      placeholder: t.placeholder,
      name: t.name,
      id: t.id,
      cls: t.className.slice(0, 80),
    }));
    out.inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')].map(
      (i) => ({
        placeholder: i.placeholder,
        name: i.name,
        id: i.id,
      }),
    );
    out.buttons = [...document.querySelectorAll('button')]
      .map((b) => (b.innerText || '').trim())
      .filter((t) => t && t.length < 50);
    out.h1h2 = [...document.querySelectorAll('h1, h2, h3')]
      .map((h) => h.innerText.trim())
      .filter(Boolean)
      .slice(0, 10);
    return out;
  });
  console.log(`  URL: ${probe.url}`);
  console.log(`  Title: ${probe.title}`);
  console.log(`  Headings: ${probe.h1h2.join(' / ')}`);
  console.log(`  Textareas: ${probe.textareas.length}`);
  probe.textareas.slice(0, 3).forEach((t) => console.log(`    ${JSON.stringify(t)}`));
  console.log(`  Inputs: ${probe.inputs.length}`);
  probe.inputs.slice(0, 5).forEach((i) => console.log(`    ${JSON.stringify(i)}`));
  console.log(`  Buttons (top 12): ${probe.buttons.slice(0, 12).join(' | ')}`);

  await writeFile(path.join(OUT, 'page-structure.json'), JSON.stringify(probe, null, 2));
}

run().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
