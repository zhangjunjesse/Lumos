#!/usr/bin/env node
// erank-seed-collect — 跑 Etsy 选品 SOP ② 采种子。
// AdsPower 启 profile → Playwright CDP 接管 → 访问 eRank 免费区 → 抓全列 + 截图 → 落地 seeds.{tsv,json}
//
// 用法:
//   node scripts/erank-seed-collect.mjs
//        [--profile=k1ck97si]
//        [--api=http://127.0.0.1:50325]
//        [--out=./tmp/erank-seeds]
//        [--timeframe=yesterday]      # eRank 实际选项: yesterday(默认) / last-30-days / 单月 YYYY-MM(如 2026-04)
//        [--limit=100]                # 每源最多抄多少行,默认不限
//        [--include=top-sellers]      # 默认源仅 Trend Buzz + Monthly Trends;Top Sellers 是头部累计销量榜,
//                                     # 对"找新机会"低价值,默认不抓,需要时显式开启
//
// 底线(SOP §5):不调 AdsPower stop;不动 lumos browser-provider;不切用户当前可见 tab;只走免费区不烧配额。

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
const API = args.api ?? 'http://127.0.0.1:50325';
const OUT = path.resolve(args.out ?? './tmp/erank-seeds');
const TIMEFRAME = args.timeframe ?? 'yesterday';
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const INCLUDE_TOP_SELLERS = args.include === 'top-sellers';

// Trend Buzz URL 不带 query(eRank 不认 URL timeframe);timeframe 进页面后通过 dropdown 切换
const TREND_BUZZ_URL = 'https://erank.com/trend-buzz';
// eRank Trend Buzz 实际下拉选项:Yesterday / Last 30 Days / 单月(Apr 2026 / Mar 2026 / ...)
// 单月需要传 YYYY-MM(如 --timeframe=2026-04),会自动映射成 "MMM YYYY" 形式去匹配 dropdown
const TIMEFRAME_LABELS = {
  yesterday: 'Yesterday',
  'last-30-days': 'Last 30 Days',
};
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function resolveTimeframeLabel(tf) {
  if (TIMEFRAME_LABELS[tf]) return TIMEFRAME_LABELS[tf];
  const m = tf.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTH_SHORT[parseInt(m[2], 10) - 1]} ${m[1]}`;
  return tf;
}

async function startProfile() {
  const r = await fetch(`${API}/api/v1/browser/start?user_id=${PROFILE}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(`AdsPower start failed: ${j.msg}`);
  return j.data.debug_port;
}

/**
 * 抓表头 + 每行所有 td。
 * - 文本列直接取 innerText
 * - 图形列(Relative Popularity 进度条 / Search Trend sparkline)兜底读 style.width / aria-label / SVG 占位
 * - 按列名映射,不按位置(SOP §6.2 字段漂移防护)
 */
async function scrape(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  // 真实鼠标滚轮事件,触发 IntersectionObserver / scroll 监听器(evaluate scrollTo 触发不到)
  const initial = await page
    .evaluate(() => document.querySelectorAll('table tbody tr').length)
    .catch(() => 0);
  if (initial < 20) {
    try {
      await page.mouse.move(400, 400);
      let lastCount = initial;
      let stable = 0;
      const start = Date.now();
      while (Date.now() - start < 30_000 && stable < 5) {
        await page.mouse.wheel(0, 1500);
        await page.waitForTimeout(350);
        const c = await page.evaluate(
          () => document.querySelectorAll('table tbody tr').length,
        );
        if (c === lastCount) stable += 1;
        else {
          stable = 0;
          lastCount = c;
        }
      }
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    } catch {
      /* 滚轮失败不阻塞抓取 */
    }
  }
  return page.evaluate(() => {
    // eRank Trend Buzz 用 sticky header pattern,页面同时有 3 个 <table>:
    //   - sticky 顶部表头(thead 单表)
    //   - 真实数据(tbody 最多)
    //   - sticky 底部 footer
    // 选 tbody 行数最多的那个,headers 从同表 thead 取
    const tables = [...document.querySelectorAll('table')];
    if (tables.length === 0) return { headers: [], rows: [] };
    const table = tables.reduce(
      (max, t) =>
        t.querySelectorAll('tbody tr').length >
        (max ? max.querySelectorAll('tbody tr').length : -1)
          ? t
          : max,
      null,
    );
    if (!table) return { headers: [], rows: [] };
    // headers:优先取本 table 的 thead;若无(sticky pattern 把 thead 分到别处),回退到第一个 table 的 thead
    let headers = [...table.querySelectorAll('thead th')].map((th) => th.innerText.trim());
    if (headers.length === 0) {
      const headTable = tables.find((t) => t.querySelectorAll('thead th').length > 0);
      headers = headTable
        ? [...headTable.querySelectorAll('thead th')].map((th) => th.innerText.trim())
        : [];
    }
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => {
      return [...tr.querySelectorAll('td')].map((td) => {
        const txt = td.innerText.trim();
        if (txt) return txt;
        const bar = td.querySelector('[style*="width"]');
        if (bar && bar.style && bar.style.width) return `bar:${bar.style.width}`;
        const aria = td.getAttribute('aria-label');
        if (aria) return aria;
        if (td.querySelector('svg')) return '(sparkline)';
        return '';
      });
    });
    return { headers, rows };
  });
}

/** 切 Trend Buzz timeframe dropdown(原生 select 或自定义 div 兜底);返回是否切成功 */
async function setTrendBuzzTimeframe(page, timeframe) {
  const label = resolveTimeframeLabel(timeframe);
  const ok = await page.evaluate((want) => {
    // 路径 1:原生 <select>
    const selects = [...document.querySelectorAll('select')];
    for (const s of selects) {
      const opt = [...s.options].find((o) => o.text.trim() === want);
      if (opt) {
        s.value = opt.value;
        s.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // 路径 2:自定义 dropdown(React UI 常用 button + listbox)
    // 找显示 "Yesterday / Last 30 Days / MMM YYYY" 的 trigger
    const candidates = [...document.querySelectorAll('button, [role="combobox"], [role="button"]')];
    const trigger = candidates.find((b) => /(Yesterday|Last 30 Days|[A-Z][a-z]{2} \d{4})/.test(b.innerText || ''));
    if (!trigger) return false;
    trigger.click();
    return new Promise((resolve) => {
      // 等弹层渲染
      setTimeout(() => {
        const items = [...document.querySelectorAll('[role="option"], li, button')];
        const item = items.find((i) => (i.innerText || '').trim() === want);
        if (item) {
          item.click();
          resolve(true);
        } else {
          resolve(false);
        }
      }, 300);
    });
  }, label);
  if (ok) await page.waitForLoadState('networkidle').catch(() => {});
  return ok;
}

/** 从已加载的 eRank 页面侧边栏发现 Monthly Trends 真实 href(避免硬编 URL 漂移) */
async function discoverMonthlyTrendsUrl(page) {
  return page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href]')];
    const match = links.find((a) => /monthly\s*trends?/i.test(a.textContent || ''));
    return match ? new URL(match.getAttribute('href'), location.origin).toString() : null;
  });
}

function rowToObject(headers, row) {
  const o = {};
  headers.forEach((h, i) => {
    o[h || `col_${i}`] = row[i] ?? '';
  });
  return o;
}

function buildTsv(blocks) {
  const out = [];
  for (const b of blocks) {
    out.push(`# source=${b.source}${b.timeframe ? ` timeframe=${b.timeframe}` : ''}`);
    out.push(`# headers: ${b.headers.join(' | ')}`);
    for (const row of b.rows) out.push(`${b.source}\t${row.join('\t')}`);
    out.push('');
  }
  return out.join('\n');
}

async function run() {
  await mkdir(OUT, { recursive: true });
  console.log(
    `▶ AdsPower profile=${PROFILE} · timeframe=${TIMEFRAME} · limit=${isFinite(LIMIT) ? LIMIT : '∞'}` +
      (INCLUDE_TOP_SELLERS ? ' · +TopSellers' : ''),
  );
  const port = await startProfile();
  console.log(`  debug_port=${port}`);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('AdsPower 无 context');
  console.log(`  context 接管 · 已有 ${ctx.pages().length} 个 page`);

  async function processOne(src) {
    console.log(`▶ ${src.name} — ${src.url}`);
    const page = await ctx.newPage();
    try {
      await page.goto(src.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (/login|signin/i.test(page.url())) {
        console.log(`  ⚠ 跳登录页 ${page.url()}(重开已登录 profile)`);
        return { page, block: null };
      }
      const { headers, rows } = await scrape(page);
      const limited = rows.slice(0, isFinite(LIMIT) ? LIMIT : rows.length);
      const shot = path.join(OUT, `${src.name.replace(/\W+/g, '-')}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      console.log(`  抓到 ${limited.length} 行 · headers=[${headers.join(' | ')}]`);
      return {
        page,
        block: {
          source: src.name,
          timeframe: src.timeframe,
          headers,
          rows: limited,
          objects: limited.map((r) => rowToObject(headers, r)),
        },
      };
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      return { page, block: null };
    }
  }

  const blocks = [];

  // 1. Trend Buzz(主源)
  //    先 navigate,再切 timeframe,再抓表格(URL 不认 timeframe query)
  console.log(`▶ Trend Buzz — ${TREND_BUZZ_URL}(将切到 ${TIMEFRAME_LABELS[TIMEFRAME] || TIMEFRAME})`);
  const tbPage = await ctx.newPage();
  let tbBlock = null;
  try {
    await tbPage.goto(TREND_BUZZ_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (/login|signin/i.test(tbPage.url())) {
      console.log(`  ⚠ 跳登录页 ${tbPage.url()}`);
    } else {
      // 先等表格首次出现(默认 Yesterday)
      await tbPage.waitForSelector('table tbody tr', { timeout: 15_000 }).catch(() => {});
      // 切 timeframe
      const switched = await setTrendBuzzTimeframe(tbPage, TIMEFRAME);
      console.log(`  timeframe 切换:${switched ? '成功' : '失败(回退默认 Yesterday)'}`);
      const { headers, rows } = await scrape(tbPage);
      const limited = rows.slice(0, isFinite(LIMIT) ? LIMIT : rows.length);
      await tbPage.screenshot({ path: path.join(OUT, 'Trend-Buzz.png'), fullPage: true });
      console.log(`  抓到 ${limited.length} 行 · headers=[${headers.join(' | ')}]`);
      tbBlock = {
        source: 'Trend Buzz',
        timeframe: switched ? TIMEFRAME : 'yesterday',
        headers,
        rows: limited,
        objects: limited.map((r) => rowToObject(headers, r)),
      };
      blocks.push(tbBlock);
    }
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
  }
  const tb = { page: tbPage, block: tbBlock };

  // 2. Monthly Trends — 从 Trend Buzz 侧边栏自动发现
  let monthlyUrl = null;
  let topSellersUrl = null;
  if (tb.page) {
    monthlyUrl = await discoverMonthlyTrendsUrl(tb.page);
    if (INCLUDE_TOP_SELLERS) {
      topSellersUrl = await tb.page
        .evaluate(() => {
          const links = [...document.querySelectorAll('a[href]')];
          const m = links.find((a) => /top\s*seller/i.test(a.textContent || ''));
          return m ? new URL(m.getAttribute('href'), location.origin).toString() : null;
        })
        .catch(() => null);
    }
  }

  if (monthlyUrl) {
    const r = await processOne({ name: 'Monthly Trends', url: monthlyUrl });
    if (r.block) blocks.push(r.block);
  } else {
    console.log('  ⚠ 侧边栏没找到 Monthly Trends 链接,跳过');
  }

  if (INCLUDE_TOP_SELLERS) {
    if (topSellersUrl) {
      const r = await processOne({ name: 'Top Sellers', url: topSellersUrl });
      if (r.block) blocks.push(r.block);
    } else {
      console.log('  ⚠ 侧边栏没找到 Top Sellers 链接,跳过');
    }
  }

  await writeFile(path.join(OUT, 'seeds.tsv'), buildTsv(blocks), 'utf8');
  await writeFile(path.join(OUT, 'seeds.json'), JSON.stringify(blocks, null, 2), 'utf8');
  console.log(`\n✓ ${path.join(OUT, 'seeds.tsv')}`);
  console.log(`✓ ${path.join(OUT, 'seeds.json')}(喂给 ③ AI 收敛)`);

  await browser.close().catch(() => {});
  console.log('▶ disconnect CDP · AdsPower 窗口保留(SOP §5.1)');
}

run().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
