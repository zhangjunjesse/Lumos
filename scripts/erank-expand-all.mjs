#!/usr/bin/env node
// ③ 扩词 三路合并:
//   A. eRank Keyword Tool 的 Related Searches(需 AdsPower 登录态,扣 eRank 配额)
//   B. Etsy autocomplete API(公开,免费,已跑过)
//   C. Etsy listing 标题 ngram(Playwright 真浏览器,免费,绕反爬)
//
// 用法: node scripts/erank-expand-all.mjs [--seeds=...] [--port=54263]

import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const API = args.api ?? 'http://127.0.0.1:50325';
const PROFILE = args.profile ?? 'k1ck97si';
const OUT = path.resolve(args.out ?? './tmp/etsy-expand');

// SEEDS 来源:
//   - 显式传 --seeds=a,b,c → 用这些
//   - 否则读 tmp/erank-converge/candidates.json 全部 63 个(① 模式)
async function loadSeeds() {
  if (args.seeds) {
    return args.seeds.split(',').map((s) => s.trim()).filter(Boolean);
  }
  try {
    const text = await readFile('./tmp/erank-converge/candidates.json', 'utf8');
    const candidates = JSON.parse(text);
    return candidates.map((c) => c.keyword);
  } catch {
    throw new Error('找不到 candidates.json — 先跑 scripts/erank-converge-simulate.mjs 产 preFilter 候选');
  }
}
const SEEDS = await loadSeeds();
console.log(`▶ SEEDS 数: ${SEEDS.length}`);

await mkdir(OUT, { recursive: true });

// ============ B 路:Etsy autocomplete(cache 复用 + 补跑缺失) ============
let B_results = {};
try {
  const text = await readFile('./tmp/etsy-autocomplete/autocomplete-results.json', 'utf8');
  B_results = JSON.parse(text);
  console.log(`▶ B 路 cache: ${Object.keys(B_results).length} 种子`);
} catch {
  console.log('▶ B 路无 cache');
}
const B_missing = SEEDS.filter((s) => !(s in B_results) || B_results[s].error);
if (B_missing.length > 0) {
  console.log(`▶ B 路补跑 ${B_missing.length} 个缺失种子`);
  for (const kw of B_missing) {
    try {
      const { stdout } = await execFileAsync('curl', [
        '-s',
        '--max-time', '10',
        '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/147.0.0.0',
        '-H', 'Accept: application/json',
        `https://www.etsy.com/api/v3/ajax/public/search/suggestions?query=${encodeURIComponent(kw)}&suggestion_count=20`,
      ]);
      const data = JSON.parse(stdout);
      B_results[kw] = {
        suggestions: (data.results || []).map((r) => r.query),
        simplified: data.simplified_queries || [],
      };
      process.stdout.write('.');
    } catch (e) {
      B_results[kw] = { error: e.message };
      process.stdout.write('✗');
    }
  }
  console.log('');
  await mkdir('./tmp/etsy-autocomplete', { recursive: true });
  await writeFile('./tmp/etsy-autocomplete/autocomplete-results.json', JSON.stringify(B_results, null, 2));
}

// ============ AdsPower CDP 启动 ============
async function startProfile() {
  const r = await fetch(`${API}/api/v1/browser/start?user_id=${PROFILE}`);
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg);
  return j.data.debug_port;
}

const port = args.port ?? (await startProfile());
console.log(`▶ AdsPower debug_port=${port}`);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30000 });
const ctx = browser.contexts()[0];

// ============ A 路:eRank Keyword Tool Related Searches(已禁用) ============
const A_results = {};
const SKIP_A = !args['include-a'];
if (SKIP_A) {
  console.log('\n=== A 路:已跳过(--include-a 启用)===');
}
if (!SKIP_A) {
console.log('\n=== A 路:eRank Keyword Tool Related Searches ===');
let aPage = null;
for (const p of ctx.pages()) {
  if (/erank.com\/keyword-tool|members\.erank\.com\/keyword-tool/i.test(p.url())) {
    aPage = p;
    break;
  }
}
if (!aPage) aPage = await ctx.newPage();

await aPage.goto('https://erank.com/keyword-tool', {
  waitUntil: 'domcontentloaded',
  timeout: 30_000,
});
await aPage.waitForLoadState('networkidle').catch(() => {});
await aPage.waitForTimeout(2000);

// 探测 keyword tool 页面元素:input + Search button + Related Searches 区域
const probe = await aPage.evaluate(() => ({
  url: location.href,
  title: document.title,
  inputs: [...document.querySelectorAll('input[type="text"], input:not([type])')].map((i) => ({
    placeholder: i.placeholder,
    id: i.id,
  })),
  headings: [...document.querySelectorAll('h1, h2, h3')]
    .map((h) => h.innerText.trim())
    .filter(Boolean)
    .slice(0, 10),
  buttons: [...document.querySelectorAll('button')]
    .map((b) => (b.innerText || '').trim())
    .filter((t) => t && t.length < 30)
    .slice(0, 10),
}));
console.log(`URL: ${probe.url}`);
console.log(`Title: ${probe.title}`);
console.log(`Inputs:`, probe.inputs.slice(0, 3));
console.log(`Headings:`, probe.headings);
console.log(`Buttons:`, probe.buttons);

await aPage.screenshot({ path: path.join(OUT, 'a-keyword-tool-empty.png'), fullPage: true });

// 找 keyword 输入框 + 搜索按钮
for (const kw of SEEDS) {
  console.log(`\n▶ A "${kw}"`);
  try {
    const input = await aPage.$('input[placeholder*="keyword" i], input[placeholder*="Search" i]');
    if (!input) {
      console.log('  ✗ 找不到 input');
      break;
    }
    await input.click({ clickCount: 3 });
    await input.fill(kw);
    await aPage.keyboard.press('Enter');

    // 等结果 — 看是否有 Related Searches 区
    await aPage.waitForLoadState('networkidle').catch(() => {});
    await aPage.waitForTimeout(2500);

    const related = await aPage.evaluate(() => {
      // Related Searches 可能在 h2/h3 含 "Related Searches" 文字下方的 list/table
      const headings = [...document.querySelectorAll('h2, h3, h4')];
      const target = headings.find((h) => /related|long\s*tail|tag\s*ideas/i.test(h.innerText));
      if (!target) return { found: false, items: [] };

      // 取该 heading 之后最近的 table 或 list
      let el = target.nextElementSibling;
      let attempts = 0;
      while (el && attempts < 5) {
        const items = [...el.querySelectorAll('a, li, tr')]
          .map((x) => (x.innerText || '').trim().split('\n')[0])
          .filter((t) => t && t.length < 60 && t.length > 2);
        if (items.length > 0) return { found: true, items };
        el = el.nextElementSibling;
        attempts++;
      }
      return { found: false, items: [] };
    });

    console.log(`  found=${related.found} items=${related.items.length}`);
    related.items.slice(0, 10).forEach((i, idx) => console.log(`    ${idx + 1}. ${i}`));
    A_results[kw] = related;
    await aPage.screenshot({
      path: path.join(OUT, `a-${kw.replace(/\W+/g, '-')}.png`),
      fullPage: false,
    });
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    A_results[kw] = { error: e.message };
  }
}
} // end if (!SKIP_A)

// ============ C 路:Etsy listing 标题 ngram ============
console.log('\n=== C 路:Etsy listing 标题 ngram ===');
const C_results = {};
const cPage = await ctx.newPage();

for (const kw of SEEDS) {
  console.log(`\n▶ C "${kw}"`);
  try {
    await cPage.goto(`https://www.etsy.com/search?q=${encodeURIComponent(kw)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await cPage.waitForLoadState('networkidle').catch(() => {});
    await cPage.waitForTimeout(2000);

    // 抓 listing 卡片完整信息(标题 + 主图 + 价格 + 店铺 + 详情链接)
    const listings = await cPage.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-listing-id]')];
      if (cards.length === 0) {
        // 兜底:只抓标题
        return {
          mode: 'titles_only',
          items: [...document.querySelectorAll('h3')]
            .map((el) => ({ title: (el.innerText || '').trim() }))
            .filter((x) => x.title && x.title.length > 10 && x.title.length < 200),
        };
      }
      return {
        mode: 'full',
        items: cards.slice(0, 40).map((card) => {
          const titleEl = card.querySelector('h3, h2');
          const imgEl = card.querySelector('img');
          const priceEl = card.querySelector('[class*="price"], [class*="currency"]');
          const shopEl = card.querySelector('[class*="shop"]');
          const linkEl = card.querySelector('a[href*="/listing/"]');
          // 主图 URL:优先 srcset 1x,再 fallback src
          let img_url = imgEl?.src || '';
          const srcset = imgEl?.srcset || '';
          if (srcset) {
            const m = srcset.match(/(\S+)\s+1x/) || srcset.match(/(\S+)\s+2x/);
            if (m) img_url = m[1];
          }
          // Etsy CDN URL 通常含 il_xxxxxN,强制改 300x300 拿小图
          img_url = img_url.replace(/il_\w+xN/, 'il_300x300');
          return {
            listing_id: card.dataset.listingId || '',
            title: (titleEl?.innerText || '').trim(),
            img_url,
            price: (priceEl?.innerText || '').trim(),
            shop: (shopEl?.innerText || '').trim(),
            href: linkEl?.href || '',
          };
        }),
      };
    });

    const titles = listings.mode === 'full'
      ? listings.items.map((x) => x.title).filter(Boolean)
      : listings.items.map((x) => x.title).filter(Boolean);

    if (titles.length === 0) {
      console.log('  ✗ 0 titles(datadome 反爬?)');
      C_results[kw] = { titles: [], ngrams: [], listings: [] };
      continue;
    }

    console.log(`  抓到 ${titles.length} 个 listing(模式:${listings.mode})`);

    // ngram 统计
    const stopwords = new Set([
      'the', 'and', 'or', 'a', 'an', 'for', 'with', 'in', 'on', 'of', 'to', 'is', 'by',
      'this', 'that', 'these', 'those', 'as', 'at', 'be', 'are', 'from', 'your', 'you',
    ]);
    const counts = new Map();
    for (const title of titles) {
      const tokens = title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t && t.length > 1 && !stopwords.has(t));
      for (let n = 2; n <= 4; n++) {
        for (let i = 0; i + n <= tokens.length; i++) {
          const gram = tokens.slice(i, i + n).join(' ');
          counts.set(gram, (counts.get(gram) || 0) + 1);
        }
      }
    }
    const sorted = [...counts.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);

    sorted.slice(0, 15).forEach(([g, c]) => console.log(`    ${g} (${c})`));
    C_results[kw] = {
      titles_count: titles.length,
      ngrams: sorted.map(([gram, count]) => ({ gram, count })),
      listings: listings.mode === 'full' ? listings.items.filter((x) => x.listing_id) : [],
    };
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    C_results[kw] = { error: e.message };
  }
}

// ============ 汇总去重 ============
console.log('\n=== 汇总去重 ===');
const merged = {};
for (const kw of SEEDS) {
  const set = new Map(); // key=normalized, value={ keyword, sources: [] }
  const add = (raw, source) => {
    if (!raw || typeof raw !== 'string') return;
    const norm = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm.length < 2 || norm.length > 80) return;
    if (norm === kw.toLowerCase()) return; // 跳过种子自身
    const cur = set.get(norm) ?? { keyword: norm, sources: new Set() };
    cur.sources.add(source);
    set.set(norm, cur);
  };
  (B_results[kw]?.suggestions || []).forEach((x) => add(x, 'B_autocomplete'));
  (A_results[kw]?.items || []).forEach((x) => add(x, 'A_eRank_related'));
  (C_results[kw]?.ngrams || []).forEach((x) => add(x.gram, 'C_listing_ngram'));
  merged[kw] = [...set.values()].map((v) => ({ keyword: v.keyword, sources: [...v.sources] }));
  console.log(`▶ ${kw} → ${merged[kw].length} 词(去重后)`);
}

const totalKeywords = Object.values(merged).reduce((n, arr) => n + arr.length, 0);
console.log(`\n汇总: ${SEEDS.length} 种子 → ${totalKeywords} 词(三路合并去重)`);

await writeFile(
  path.join(OUT, 'A-erank-related.json'),
  JSON.stringify(A_results, null, 2),
);
await writeFile(
  path.join(OUT, 'C-listing-ngram.json'),
  JSON.stringify(C_results, null, 2),
);
await writeFile(path.join(OUT, 'merged.json'), JSON.stringify(merged, null, 2));
console.log(`\n✓ A: ${path.join(OUT, 'A-erank-related.json')}`);
console.log(`✓ C: ${path.join(OUT, 'C-listing-ngram.json')}`);
console.log(`✓ 合并: ${path.join(OUT, 'merged.json')}`);

// ============ 下载 listing 主图到本地 ============
console.log('\n=== 下载 listing 主图到本地 ===');
const IMG_DIR = path.join(OUT, 'images');
await mkdir(IMG_DIR, { recursive: true });

// 收集所有要下的图(去重 listing_id)
const allListings = new Map(); // listing_id → { url, seed }
for (const [seed, c] of Object.entries(C_results)) {
  for (const item of c.listings || []) {
    if (!item.listing_id || !item.img_url) continue;
    if (!allListings.has(item.listing_id)) {
      allListings.set(item.listing_id, { url: item.img_url, seed });
    }
  }
}
console.log(`▶ 需下载 ${allListings.size} 张唯一主图(已去重 listing_id)`);

let dlOk = 0, dlSkip = 0, dlFail = 0;
const concurrency = 6;
const tasks = [...allListings.entries()];
async function downloadOne([listing_id, { url, seed }]) {
  const ext = (url.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg').toLowerCase();
  const localPath = path.join(IMG_DIR, `${listing_id}.${ext}`);
  // 已存在跳过
  try {
    await execFileAsync('test', ['-f', localPath]);
    dlSkip++;
    return;
  } catch {}
  try {
    await execFileAsync(
      'curl',
      [
        '-s',
        '--max-time', '15',
        '-o', localPath,
        '-H', 'User-Agent: Mozilla/5.0',
        '-H', 'Referer: https://www.etsy.com/',
        url,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    dlOk++;
  } catch (e) {
    dlFail++;
  }
}

// 简单并发
for (let i = 0; i < tasks.length; i += concurrency) {
  const slice = tasks.slice(i, i + concurrency);
  await Promise.allSettled(slice.map(downloadOne));
  if ((i + concurrency) % 60 === 0) {
    process.stdout.write(`\r  进度 ${Math.min(i + concurrency, tasks.length)}/${tasks.length} (✓${dlOk} ⏭${dlSkip} ✗${dlFail})`);
  }
}
console.log(`\n✓ 下载完毕:成功 ${dlOk} / 已存在跳过 ${dlSkip} / 失败 ${dlFail}`);
console.log(`  本地目录:${IMG_DIR}`);

await browser.close().catch(() => {});
