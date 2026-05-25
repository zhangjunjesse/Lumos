#!/usr/bin/env node
// ⑥ 商业分析 — 抓 EHunt 注入数据
// 输入: 关键词列表(--keywords=a,b,c 或读 39 个 A 级)
// 输出: tmp/erank-ehunt/raw/<slug>.json(每词一文件)+ public/etsy-images/<id>.jpg
// 严格规则:
//   - AdsPower 串行,不停
//   - 每词等 EHunt 注入(.eh-mask-info-fetched-item),最多等 12 秒
//   - state-ehunt.json 断点续跑

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';

const PORT = process.env.PORT || (process.argv.find((a) => a.startsWith('--port='))?.slice(7) ?? '58491');
const KEYWORDS_FLAG = process.argv.find((a) => a.startsWith('--keywords='))?.slice(11);
const MAX = parseInt(process.argv.find((a) => a.startsWith('--max='))?.slice(6) ?? '24', 10);
const TOP_N = MAX;

const RAW_DIR = path.resolve('./tmp/erank-ehunt/raw');
const IMG_DIR = path.resolve('./public/etsy-images');
const STATE_FILE = path.resolve('./tmp/erank-ehunt/state-ehunt.json');
fs.mkdirSync(RAW_DIR, { recursive: true });
fs.mkdirSync(IMG_DIR, { recursive: true });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

function slug(s) {
  return s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  return { done: {}, failed: {}, last_run: null };
}

function saveState(s) {
  s.last_run = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function getKeywords() {
  if (KEYWORDS_FLAG) return KEYWORDS_FLAG.split(',').map((s) => s.trim()).filter(Boolean);

  // 从 ④ state 读 39 个 A 级
  const state = JSON.parse(fs.readFileSync('./tmp/erank-bulk/state.json', 'utf8'));
  const grade = (r) => {
    const s = parseInt((r.searches || '').replace(/,/g, '')) || 0;
    const c = parseInt((r.competition || '').replace(/,/g, '')) || 0;
    const kd = parseInt(r.kd) || 0;
    const ctr = parseInt(r.ctr) || 0;
    const sU = r.searches === 'Unknown' || r.searches === '< 20';
    const ctrU = r.ctr === 'Unknown' || r.ctr === '< 20%';
    if (sU || ctrU || s < 100 || c > 100000 || kd === 100) return 'drop';
    if (s >= 150 && c < 5000 && kd < 30 && ctr >= 80) return 'A';
    if (s >= 100 && c < 50000 && kd < 50 && ctr >= 80) return 'B';
    return 'C';
  };
  return Object.entries(state.done_keywords)
    .filter(([, m]) => grade(m) === 'A')
    .map(([k]) => k)
    .sort();
}

function downloadImage(url, dest) {
  return new Promise((resolve) => {
    if (fs.existsSync(dest)) return resolve(true);
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(false);
        }
        const f = fs.createWriteStream(dest);
        res.pipe(f);
        f.on('finish', () => f.close(() => resolve(true)));
        f.on('error', () => resolve(false));
      })
      .on('error', () => resolve(false));
  });
}

async function scrapeKeyword(page, keyword) {
  const url = `https://www.etsy.com/search?q=${encodeURIComponent(keyword)}`;
  console.log(`  → ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  await page.waitForSelector('[data-listing-id]', { timeout: 30000 });

  // 等 EHunt 注入到至少一个 listing
  try {
    await page.waitForSelector('.eh-mask-info-fetched-item', { timeout: 15000 });
  } catch {
    console.log('  ⚠ EHunt 15 秒内未注入,但继续抓 Etsy 原生');
  }
  // 多等 4 秒让所有 listing 都注入
  await page.waitForTimeout(4000);

  const raw = await page.evaluate((topN) => {
    function parseEhunt(card) {
      const items = [...card.querySelectorAll('.eh-mask-info-fetched-item')];
      const out = { sales: null, sales_window: null, favorites: null, store_weekly_sales: null, listed_date: null };
      for (const item of items) {
        const text = (item.innerText || '').replace(/\s+/g, ' ').trim();
        // "Sales: 12(5)   Favorites: 87"
        const salesM = text.match(/Sales:\s*(\d+)(?:\((\d+)\))?/i);
        if (salesM) {
          out.sales = parseInt(salesM[1], 10);
          if (salesM[2] != null) out.sales_window = parseInt(salesM[2], 10);
        }
        const favM = text.match(/Favorites:\s*(\d+)/i);
        if (favM) out.favorites = parseInt(favM[1], 10);
        const wsM = text.match(/Store Weekly Sales:\s*(\d+)/i);
        if (wsM) out.store_weekly_sales = parseInt(wsM[1], 10);
        const listM = text.match(/Listed:\s*([\d/\-]+)/i);
        if (listM) out.listed_date = listM[1];
      }
      return out;
    }

    const cards = [...document.querySelectorAll('[data-listing-id]')];
    // 去重(同 listing_id 可能多次出现,如视频 wrapper)
    const seen = new Set();
    const unique = [];
    for (const c of cards) {
      const id = c.dataset.listingId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      unique.push(c);
      if (unique.length >= topN) break;
    }

    return unique.map((card) => {
      const titleEl = card.querySelector('h3, h2, [data-listing-card-listing-title]');
      const imgEl = card.querySelector('img');
      const priceEl = card.querySelector('[class*="price"], [class*="currency"]');
      const shopEl = card.querySelector('.shop-name-with-rating, [class*="shop"]');
      const linkEl = card.querySelector('a[href*="/listing/"]');

      let img_url = imgEl?.src || '';
      const srcset = imgEl?.srcset || '';
      if (srcset) {
        const m = srcset.match(/(\S+)\s+1x/) || srcset.match(/(\S+)\s+2x/);
        if (m) img_url = m[1];
      }
      img_url = img_url.replace(/il_\w+xN/, 'il_300x300');

      // shop rating + review count from shopEl 文本
      const shopText = (shopEl?.innerText || '').replace(/\s+/g, ' ').trim();
      const ratingM = shopText.match(/^(\d\.\d)/);
      const revCountM = shopText.match(/\((\d[\d,]*)\)/);
      const shopNameM = shopText.match(/By\s+([^\n]+?)(?:\s+From|$)/);

      return {
        listing_id: card.dataset.listingId || '',
        title: (titleEl?.innerText || '').trim().slice(0, 200),
        img_url,
        price: (priceEl?.innerText || '').split('\n')[0].trim().slice(0, 40),
        shop_text: shopText.slice(0, 100),
        shop_name: shopNameM?.[1]?.trim() || '',
        shop_rating: ratingM ? parseFloat(ratingM[1]) : null,
        shop_review_count: revCountM ? parseInt(revCountM[1].replace(/,/g, ''), 10) : null,
        href: linkEl?.href || '',
        ehunt: parseEhunt(card),
      };
    });
  }, TOP_N);

  return raw;
}

async function main() {
  console.log(`▶ ⑥ EHunt 深度抓 · CDP :${PORT} · top ${TOP_N}/词`);
  const keywords = getKeywords();
  console.log(`▶ 关键词清单(${keywords.length} 个):`, keywords.slice(0, 10).join(', '), keywords.length > 10 ? '...' : '');

  const state = loadState();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    const s = slug(kw);
    const dest = path.join(RAW_DIR, `${s}.json`);

    if (state.done[kw] && fs.existsSync(dest)) {
      console.log(`\n[${i + 1}/${keywords.length}] ${kw} · cached, skip`);
      continue;
    }

    console.log(`\n[${i + 1}/${keywords.length}] ${kw}`);
    const page = await ctx.newPage();
    try {
      const listings = await scrapeKeyword(page, kw);
      const ehuntCount = listings.filter((l) => l.ehunt.sales != null).length;

      // 下载主图
      let imgOk = 0;
      for (const l of listings) {
        if (!l.img_url || !l.listing_id) continue;
        const imgDest = path.join(IMG_DIR, `${l.listing_id}.jpg`);
        const ok = await downloadImage(l.img_url, imgDest);
        if (ok) imgOk++;
      }

      fs.writeFileSync(dest, JSON.stringify({ keyword: kw, ranAt: new Date().toISOString(), listings }, null, 2));
      state.done[kw] = { count: listings.length, ehuntCount, imgOk, ranAt: new Date().toISOString() };
      delete state.failed[kw];
      saveState(state);
      console.log(`  ✓ ${listings.length} listings · EHunt 覆盖 ${ehuntCount}/${listings.length} · 图 ${imgOk}`);
    } catch (e) {
      console.log(`  ✗ ${e.message.slice(0, 200)}`);
      state.failed[kw] = { error: e.message.slice(0, 500), lastErrorAt: new Date().toISOString() };
      saveState(state);
    } finally {
      await page.close().catch(() => {});
    }
  }

  await browser.close();
  console.log('\n▶ disconnect CDP · AdsPower 窗口保留');
  console.log(`done: ${Object.keys(state.done).length} · failed: ${Object.keys(state.failed).length}`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
