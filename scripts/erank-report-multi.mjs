#!/usr/bin/env node
// 多关键词综合选品分析报告 PDF
// 结构:封面 → 总览排序表 → 每词 2 页(核心数据 + 资产模板) → 通用附录
// 用法:node scripts/erank-report-multi.mjs [--run=RUN-id] [--limit=N]

import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const LIMIT = args.limit ? Number(args.limit) : Infinity;
const OUT_DIR = path.resolve('tmp/reports');
const IMG_DIR = path.resolve('public/etsy-images');

const COLOR_MAIN = '#1f3a5f';
const COLOR_ACCENT = '#8b1a1a';
const COLOR_GRID = '#d8d8d8';
const COLOR_TEXT = '#333';
const COLOR_MUTED = '#7a7a7a';

// ============ 数据加载 ============
function loadData() {
  const db = new Database(path.join(os.homedir(), '.lumos/lumos.db'), { readonly: true });
  let runId = args.run;
  if (!runId) {
    const row = db.prepare('SELECT id FROM radar_runs ORDER BY started_at DESC LIMIT 1').get();
    runId = row?.id;
  }
  if (!runId) throw new Error('找不到 run');

  const run = db.prepare('SELECT id, label, started_at, capabilities_json FROM radar_runs WHERE id = ?').get(runId);

  const ehunts = db.prepare(`
    SELECT keyword, analysis_json, listings_json FROM radar_ehunt WHERE run_id = ?
  `).all(runId);

  const bulks = db.prepare(`
    SELECT keyword, seed, searches, clicks, ctr, competition, kd, google, grade
    FROM radar_bulk WHERE run_id = ?
  `).all(runId);
  const bulkByKw = new Map(bulks.map((b) => [b.keyword, b]));

  db.close();

  // 组装每个 keyword 的完整数据
  return {
    runId,
    runLabel: run?.label || runId,
    reportDate: new Date().toISOString().slice(0, 10),
    keywords: ehunts.map((e) => ({
      keyword: e.keyword,
      bulk: bulkByKw.get(e.keyword),
      analysis: JSON.parse(e.analysis_json),
      listings: JSON.parse(e.listings_json),
    })),
  };
}

function imgDataUrl(listingId) {
  const p = path.join(IMG_DIR, `${listingId}.jpg`);
  if (!fs.existsSync(p)) return null;
  return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
}

function cleanShop(name) {
  return (name || '').replace(/\s+Ad\s+from\s+shop\s+.+$/i, '').replace(/\s+From\s+shop\s+.+$/i, '').trim();
}

function intFromComma(s) {
  return parseInt((s || '0').replace(/,/g, ''), 10) || 0;
}

// ============ 综合评分 ============
function computeScore(kw) {
  const m = intFromComma(kw.bulk?.searches);
  const g = intFromComma(kw.bulk?.google);
  const kd = parseInt(kw.bulk?.kd) || 100;
  const top5 = kw.analysis.top5SalesPct || 0;
  const newRate = kw.analysis.newStores.within30 > 0
    ? kw.analysis.newStores.within30WithSales / kw.analysis.newStores.within30 : 0;
  const priceRange = kw.analysis.price.median > 0
    ? (kw.analysis.price.p75 - kw.analysis.price.p25) / kw.analysis.price.median : 1;

  const sub = {
    market: Math.min(20, Math.round(((m + g) / 7000) * 20)),
    seo: Math.round((100 - kd) / 100 * 15),
    biz: Math.round(Math.max(0, (1 - top5) * 10) + Math.max(0, 10 - priceRange * 10)),
    newcomer: Math.round(newRate * 12 + Math.min(3, kw.analysis.newStores.within30 * 1)),
    risk: 10,    // 默认中等,各 keyword 可基于 LLM 调
    feasible: 11, // 默认通用工艺
  };
  const total = sub.market + sub.seo + sub.biz + sub.newcomer + sub.risk + sub.feasible;
  // 仅用 color 标识强度,不再输出主观建议文字(避免误导卖家)
  let color;
  if (total >= 75) color = '#1e6b3a';
  else if (total >= 50) color = '#a05a00';
  else color = '#8b1a1a';
  return { sub, total: Math.round(total), color };
}

// ============ SVG 图表 ============
function radarChart(scores, size = 220) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.32;
  const n = scores.length;
  const angle = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const point = (i, v) => [cx + Math.cos(angle(i)) * r * v, cy + Math.sin(angle(i)) * r * v];
  const grids = [0.25, 0.5, 0.75, 1].map((g) => {
    const pts = scores.map((_, i) => point(i, g).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="${COLOR_GRID}" stroke-width="0.6"/>`;
  }).join('');
  const axes = scores.map((_, i) => {
    const [x, y] = point(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${COLOR_GRID}" stroke-width="0.6"/>`;
  }).join('');
  const dataPts = scores.map((s, i) => point(i, s.value / s.max).join(',')).join(' ');
  const dataPolygon = `<polygon points="${dataPts}" fill="${COLOR_MAIN}" fill-opacity="0.18" stroke="${COLOR_MAIN}" stroke-width="1.5"/>`;
  const dots = scores.map((s, i) => {
    const [x, y] = point(i, s.value / s.max);
    return `<circle cx="${x}" cy="${y}" r="2.5" fill="${COLOR_MAIN}"/>`;
  }).join('');
  const labels = scores.map((s, i) => {
    const [x, y] = point(i, 1.22);
    let anchor = 'middle';
    if (Math.cos(angle(i)) > 0.3) anchor = 'start';
    else if (Math.cos(angle(i)) < -0.3) anchor = 'end';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="9" fill="${COLOR_TEXT}">${s.label}</text><text x="${x}" y="${y + 11}" text-anchor="${anchor}" font-size="8.5" fill="${COLOR_MAIN}" font-weight="600">${s.value.toFixed(1)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${grids}${axes}${dataPolygon}${dots}${labels}</svg>`;
}

function priceBar(price) {
  const w = 240, h = 36;
  const sx = (v) => 18 + (Math.min(v, 50) / 50) * (w - 36);
  const axisY = 20;
  const range = `<rect x="${sx(price.p25)}" y="${axisY - 3}" width="${sx(price.p75) - sx(price.p25)}" height="6" fill="${COLOR_MAIN}" opacity="0.3"/>`;
  const axis = `<line x1="18" y1="${axisY}" x2="${w - 18}" y2="${axisY}" stroke="${COLOR_MUTED}" stroke-width="0.7"/>`;
  const medianDot = `<circle cx="${sx(price.median)}" cy="${axisY}" r="3" fill="${COLOR_ACCENT}"/>`;
  const labels = `
    <text x="${sx(price.p25)}" y="${axisY + 13}" font-size="8" fill="${COLOR_MUTED}" text-anchor="middle">$${price.p25.toFixed(0)}</text>
    <text x="${sx(price.median)}" y="${axisY - 7}" font-size="8.5" fill="${COLOR_ACCENT}" text-anchor="middle" font-weight="600">$${price.median.toFixed(1)}</text>
    <text x="${sx(price.p75)}" y="${axisY + 13}" font-size="8" fill="${COLOR_MUTED}" text-anchor="middle">$${price.p75.toFixed(0)}</text>
  `;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${axis}${range}${medianDot}${labels}</svg>`;
}

function concentrationDonut(top5Pct, size = 70) {
  const r = size * 0.36, cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;
  const fill = C * top5Pct;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8e8e8" stroke-width="9"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLOR_MAIN}" stroke-width="9"
      stroke-dasharray="${fill} ${C - fill}" stroke-dashoffset="${C / 4}"
      transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="13" font-weight="700" fill="${COLOR_MAIN}">${Math.round(top5Pct * 100)}%</text>
  </svg>`;
}

// ============ 每词卡片 HTML(2 页) ============
function renderKeywordCard(kw, rank, score) {
  const { keyword, bulk, analysis, listings } = kw;
  const radarScores = [
    { label: '市场规模', value: score.sub.market / 20 * 10, max: 10 },
    { label: 'SEO 易度', value: score.sub.seo / 15 * 10, max: 10 },
    { label: '商业潜力', value: score.sub.biz / 20 * 10, max: 10 },
    { label: '新店红利', value: score.sub.newcomer / 15 * 10, max: 10 },
    { label: '风险可控', value: score.sub.risk / 15 * 10, max: 10 },
    { label: '操作可行', value: score.sub.feasible / 15 * 10, max: 10 },
  ];

  const topListings = listings.slice(0, 9).map((l) => ({
    id: l.listing_id,
    title: (l.title || '').slice(0, 60),
    price: l.price || '',
    shop: cleanShop(l.shop_name),
    sales: l.ehunt?.sales ?? null,
    imgDataUrl: imgDataUrl(l.listing_id),
  }));

  const top5Shops = (analysis.topShops || []).slice(0, 5);
  const topShopRows = top5Shops.map((s, i) => `
    <tr><td>${i + 1}</td><td>${s.name}</td><td class="num">${s.sales}</td><td class="num">${s.listings}</td></tr>
  `).join('');

  const totalSales = listings.reduce((s, l) => s + (l.ehunt?.sales || 0), 0);

  // 上架时间分布
  const ageDistr = analysis.newStores.ageDistribution || [];
  const ageBuckets = [
    { label: '≤30 天', value: ageDistr.filter((d) => d <= 30).length },
    { label: '31-90 天', value: ageDistr.filter((d) => d > 30 && d <= 90).length },
    { label: '3-6 月', value: ageDistr.filter((d) => d > 90 && d <= 180).length },
    { label: '6 月-1 年', value: ageDistr.filter((d) => d > 180 && d <= 365).length },
    { label: '>1 年', value: ageDistr.filter((d) => d > 365).length },
  ];
  const maxBucket = Math.max(...ageBuckets.map((b) => b.value), 1);
  const ageBarsHtml = ageBuckets.map((b) => `
    <div class="age-bar-row">
      <span class="age-bar-label">${b.label}</span>
      <span class="age-bar-track"><span class="age-bar-fill" style="width:${(b.value / maxBucket) * 100}%"></span></span>
      <span class="age-bar-val">${b.value}</span>
    </div>
  `).join('');

  const wallCards = topListings.map((l) => `
    <div class="kw-listing-card">
      <div class="kw-listing-img">
        ${l.imgDataUrl ? `<img src="${l.imgDataUrl}" alt=""/>` : '<div class="no-img">无图</div>'}
        ${l.sales != null && l.sales > 0 ? `<span class="kw-sales-tag">销 ${l.sales}</span>` : ''}
      </div>
      <div class="kw-listing-meta">
        <div class="kw-listing-title">${l.title}</div>
        <div class="kw-listing-row">
          <span class="kw-listing-price">${l.price}</span>
          <span class="kw-listing-shop">${l.shop}</span>
        </div>
      </div>
    </div>
  `).join('');

  // 标题模板 + tag(generic 模板)
  const titleTpl = `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} · [Style] · [Material] · [Audience]`;
  const tagPool = (analysis.topNgrams || []).slice(0, 13).map((n) => n.gram);
  while (tagPool.length < 13) tagPool.push(keyword);
  const tagStr = tagPool.slice(0, 13).join(', ');

  return `
<!-- ========== Keyword: ${keyword} (2 页) ========== -->
<div class="kw-page page-break with-wm"><div class="wm-line wm-top">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div><div class="wm-line wm-mid">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div><div class="wm-line wm-bot">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div>
  <!-- 卡片头部 -->
  <div class="kw-header">
    <div class="kw-rank">#${String(rank).padStart(2, '0')}</div>
    <div class="kw-head-text">
      <div class="kw-title">${keyword}</div>
    </div>
    <div class="kw-score-block">
      <div class="kw-score-num" style="color:${score.color};">${score.total}</div>
      <div class="kw-score-label">综合评分 / 100</div>
    </div>
  </div>

  <!-- 左:雷达 / 右:指标卡 -->
  <div class="kw-row kw-row-top">
    <div class="kw-radar-cell">${radarChart(radarScores, 200)}</div>
    <div class="kw-metrics-grid">
      <div class="kw-metric"><div class="ml">月搜</div><div class="mv">${bulk?.searches || '—'}</div></div>
      <div class="kw-metric"><div class="ml">Google</div><div class="mv">${bulk?.google || '—'}</div></div>
      <div class="kw-metric"><div class="ml">SEO 难度</div><div class="mv">${bulk?.kd || '—'}<span class="ms"> / 100</span></div></div>
      <div class="kw-metric"><div class="ml">在售</div><div class="mv">${bulk?.competition || '—'}</div></div>
      <div class="kw-metric"><div class="ml">点击率</div><div class="mv">${bulk?.ctr || '—'}</div></div>
      <div class="kw-metric"><div class="ml">头部销 / 中位</div><div class="mv">${analysis.sales.max || 0}<span class="ms"> / ${analysis.sales.median || 0}</span></div></div>
    </div>
  </div>

  <!-- 头部 4 listing 图墙 -->
  <div class="kw-section-label">头部 4 个 listing 实景采样</div>
  <div class="kw-listing-grid">${wallCards}</div>

  <!-- 头部 5 店 + 集中度 -->
  <div class="kw-section-label">头部 5 店 · 集中度</div>
  <div class="kw-row">
    <div class="kw-shops-cell">
      <table class="kw-data">
        <thead><tr><th>排</th><th>店铺</th><th>月销</th><th>listing</th></tr></thead>
        <tbody>${topShopRows}</tbody>
      </table>
    </div>
    <div class="kw-donut-cell">
      ${concentrationDonut(analysis.top5SalesPct || 0, 80)}
      <div class="kw-donut-cap">头部 5 占总销</div>
      <div class="kw-donut-meta">新店 ${analysis.newStores.within30}/${analysis.newStores.within30WithSales} 出单</div>
    </div>
  </div>

  <!-- 价格 + 上架时间 -->
  <div class="kw-row">
    <div class="kw-price-cell">
      <div class="kw-section-label">价格区间</div>
      ${priceBar(analysis.price)}
      <div class="kw-price-meta">中位 $${analysis.price.median.toFixed(2)} · P25-P75 $${analysis.price.p25.toFixed(0)} - $${analysis.price.p75.toFixed(0)}</div>
    </div>
    <div class="kw-age-cell">
      <div class="kw-section-label">上架时间分布</div>
      <div class="age-bars">${ageBarsHtml}</div>
    </div>
  </div>
</div>

<div class="kw-page page-break with-wm"><div class="wm-line wm-top">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div><div class="wm-line wm-mid">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div><div class="wm-line wm-bot">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div>
  <!-- 第二页:资产模板 -->
  <div class="kw-header-mini">
    <span class="kw-rank-mini">#${String(rank).padStart(2, '0')}</span>
    <span class="kw-title-mini">${keyword}</span>
    <span class="kw-page-tag">资产模板</span>
  </div>

  <div class="kw-section-label">参考标题模板</div>
  <blockquote class="kw-blockquote">${titleTpl}</blockquote>

  <div class="kw-section-label">头部高频配套词族</div>
  <div class="kw-tag-block">${tagStr}</div>

  <div class="kw-section-label">数据快照</div>
  <table class="kw-data">
    <tbody>
      <tr><td>累计销量(top ${listings.length})</td><td class="num">${totalSales}</td></tr>
      <tr><td>头部 listing 月销</td><td class="num">${analysis.sales.max}</td></tr>
      <tr><td>销量中位</td><td class="num">${analysis.sales.median}</td></tr>
      <tr><td>top10 累计</td><td class="num">${analysis.sales.top10.reduce((s, x) => s + x, 0)}</td></tr>
      <tr><td>顶 listing 收藏</td><td class="num">${analysis.favorites.max}</td></tr>
      <tr><td>收藏中位</td><td class="num">${analysis.favorites.median}</td></tr>
      <tr><td>价格 min-max</td><td class="num">$${analysis.price.min.toFixed(2)} - $${analysis.price.max.toFixed(2)}</td></tr>
      <tr><td>EHunt 数据覆盖率</td><td class="num">${analysis.ehuntCoverage} / ${analysis.listingCount}</td></tr>
    </tbody>
  </table>
</div>
`;
}

// ============ 总览页 ============
function renderOverview(rows) {
  const tableRows = rows.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${r.kw.keyword}</td>
      <td>${r.kw.bulk?.seed || ''}</td>
      <td class="num"><strong style="color:${r.score.color};">${r.score.total}</strong></td>
      <td class="num">${r.kw.bulk?.searches || '—'}</td>
      <td class="num">${r.kw.bulk?.kd || '—'}</td>
      <td class="num">${r.kw.analysis.sales.max || 0}</td>
      <td class="num">${Math.round((r.kw.analysis.top5SalesPct || 0) * 100)}%</td>
      <td class="num">${r.kw.analysis.newStores.within30}/${r.kw.analysis.newStores.within30WithSales}</td>
    </tr>
  `).join('');

  return `
<div class="overview-page page-break with-wm">
  <div class="wm-line wm-top">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div><div class="wm-line wm-mid">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div><div class="wm-line wm-bot">${WATERMARK} · ${WATERMARK} · ${WATERMARK}</div>
  <div class="report-head">
    <h1 class="report-title">ETSY 选品报告</h1>
    <div class="report-date">${data.reportDate}</div>
  </div>

  <table class="overview-table">
    <thead>
      <tr>
        <th>#</th>
        <th>关键词</th>
        <th>seed</th>
        <th>评分</th>
        <th>月搜</th>
        <th>SEO 难度</th>
        <th>头部月销</th>
        <th>头部 5 占</th>
        <th>新店 / 已出单</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
</div>
`;
}

// ============ 主流程 ============
const data = loadData();
console.log(`▶ 加载 ${data.keywords.length} 个 ⑥ keyword`);

// 计算评分 + 排序
const scored = data.keywords.map((kw) => ({ kw, score: computeScore(kw) }));
scored.sort((a, b) => b.score.total - a.score.total);
const limited = isFinite(LIMIT) ? scored.slice(0, LIMIT) : scored;
console.log(`▶ 评分后排序: top 1 = ${limited[0].kw.keyword}(${limited[0].score.total} 分),tail = ${limited[limited.length-1].kw.keyword}(${limited[limited.length-1].score.total} 分)`);

const reportMonth = data.reportDate.slice(0, 7); // '2026-05'
const OUT_PATH = path.join(OUT_DIR, `ETSY_选品分析报告${reportMonth}.pdf`);
const WATERMARK = '391504704@qq.com';

// 计算总览页平均分等
const avgScore = Math.round(limited.reduce((s, r) => s + r.score.total, 0) / limited.length);
const recommendCount = limited.filter((r) => r.score.total >= 75).length;
const cautionCount = limited.filter((r) => r.score.total >= 50 && r.score.total < 75).length;
const skipCount = limited.filter((r) => r.score.total < 50).length;

const overviewBody = renderOverview(limited);
const keywordPages = limited.map((r, i) => renderKeywordCard(r.kw, i + 1, r.score)).join('\n');

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>选品分析报告 · ${data.runLabel}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', sans-serif;
    color: #222; line-height: 1.65; font-size: 10pt;
  }
  .page-break { page-break-after: always; }

  /* 封面 */
  .cover {
    height: 263mm; display: flex; flex-direction: column;
    padding: 25mm 0 0 0;
  }
  .cover-tag {
    display: inline-block; font-size: 9pt; color: ${COLOR_MUTED};
    letter-spacing: 8px; border-bottom: 1px solid ${COLOR_MUTED};
    padding-bottom: 5px; margin-bottom: 18mm; align-self: flex-start;
  }
  .cover-title {
    font-size: 34pt; font-weight: 700; line-height: 1.15;
    color: ${COLOR_MAIN}; margin: 0 0 8px 0;
  }
  .cover-subtitle { font-size: 14pt; color: #444; margin-bottom: 24mm; }

  .cover-stats {
    display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 4mm; margin-bottom: 20mm;
  }
  .cover-stat {
    background: #f7f8fa; border-top: 3px solid ${COLOR_MAIN};
    padding: 12px 14px;
  }
  .cover-stat-label { font-size: 9.5pt; color: ${COLOR_MUTED}; margin-bottom: 4px; }
  .cover-stat-value {
    font-size: 28pt; font-weight: 700; color: ${COLOR_MAIN};
    font-family: 'Helvetica Neue', sans-serif; line-height: 1; letter-spacing: -1px;
  }
  .cover-stat-sub { font-size: 9pt; color: ${COLOR_MUTED}; margin-top: 3px; }

  .cover-meta {
    border-top: 1px solid #ccc; padding-top: 12px;
    font-size: 9.5pt; color: #444; line-height: 1.9;
  }
  .cover-meta-row { display: flex; gap: 20px; }
  .cover-meta-label { width: 80px; color: ${COLOR_MUTED}; }
  .cover-meta-value { flex: 1; }

  .cover-bottom {
    margin-top: auto; padding-top: 14mm; border-top: 1px solid #ccc;
    font-size: 8.5pt; color: ${COLOR_MUTED}; line-height: 1.7;
  }

  /* 总览页头 */
  .report-head {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 2px solid ${COLOR_MAIN}; padding-bottom: 8px; margin-bottom: 14px;
  }
  .report-title {
    font-size: 22pt; font-weight: 700; color: ${COLOR_MAIN}; margin: 0; letter-spacing: 1px;
  }
  .report-date {
    font-size: 11pt; color: ${COLOR_MUTED};
    font-family: 'Helvetica Neue', sans-serif;
  }
  .section-title-large {
    font-size: 22pt; font-weight: 700; color: ${COLOR_MAIN};
    border-bottom: 2px solid ${COLOR_MAIN}; padding-bottom: 7px; margin: 0 0 14px 0;
  }
  .overview-table {
    width: 100%; border-collapse: collapse; font-size: 9pt;
  }
  .overview-table thead th {
    background: ${COLOR_MAIN}; color: white; font-weight: 600;
    padding: 7px 8px; text-align: left;
    position: sticky; top: 0;
  }
  .overview-table td {
    border-bottom: 1px solid #e5e5e5; padding: 5px 8px;
  }
  .overview-table tr:nth-child(even) td { background: #fafbfc; }
  .overview-table td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', monospace; }

  /* 每词卡片 */
  .kw-page {
    padding: 0; page-break-inside: avoid;
  }
  .kw-header {
    display: flex; align-items: stretch; gap: 12px;
    border-bottom: 2px solid ${COLOR_MAIN};
    padding-bottom: 10px; margin-bottom: 12px;
  }
  .kw-rank {
    font-size: 26pt; font-weight: 700; color: ${COLOR_MAIN};
    font-family: 'Helvetica Neue', sans-serif; letter-spacing: -1px;
    align-self: center; min-width: 60px;
  }
  .kw-head-text { flex: 1; align-self: center; }
  .kw-title {
    font-size: 19pt; font-weight: 700; color: ${COLOR_MAIN};
    font-family: 'Menlo', 'Monaco', monospace; letter-spacing: -0.5px;
  }
  .kw-subtitle { font-size: 9.5pt; color: ${COLOR_MUTED}; margin-top: 2px; }
  .kw-score-block {
    text-align: right; align-self: center;
    min-width: 105px;
  }
  .kw-score-num {
    font-size: 32pt; font-weight: 700; color: ${COLOR_MAIN};
    font-family: 'Helvetica Neue', sans-serif; line-height: 1;
  }
  .kw-score-label {
    font-size: 8.5pt; color: ${COLOR_MUTED};
    letter-spacing: 2px; margin: 2px 0 5px 0;
  }
  .kw-verdict {
    display: inline-block; font-size: 10.5pt; font-weight: 600;
    padding: 2px 9px; border: 1.5px solid; border-radius: 3px;
  }

  .kw-section-label {
    font-size: 9pt; font-weight: 600; color: ${COLOR_MAIN};
    letter-spacing: 1px; margin: 10px 0 5px 0;
    padding-left: 8px; border-left: 3px solid ${COLOR_MAIN};
  }

  .kw-row { display: flex; gap: 12px; margin-bottom: 8px; }
  .kw-row-top { align-items: center; }
  .kw-radar-cell {
    background: #fafbfc; border: 1px solid #e5e5e5; padding: 6px;
    flex-shrink: 0;
  }
  .kw-metrics-grid {
    flex: 1; display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
  }
  .kw-metric {
    background: #f7f8fa; border-top: 2px solid ${COLOR_MAIN};
    padding: 6px 8px;
  }
  .kw-metric .ml { font-size: 8.5pt; color: ${COLOR_MUTED}; margin-bottom: 1px; }
  .kw-metric .mv {
    font-size: 13pt; font-weight: 700; color: ${COLOR_MAIN};
    font-family: 'Helvetica Neue', sans-serif; line-height: 1.1;
  }
  .kw-metric .ms { font-size: 9pt; font-weight: 400; color: ${COLOR_MUTED}; }

  /* listing 图墙 3x3 */
  .kw-listing-grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 6px; margin-bottom: 8px;
  }
  .kw-listing-card {
    border: 1px solid #e0e0e0; overflow: hidden; background: white;
  }
  .kw-listing-img {
    position: relative; width: 100%; aspect-ratio: 1 / 1;
    overflow: hidden; background: #f4f4f4;
  }
  .kw-listing-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .kw-listing-img .no-img {
    width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
    color: #aaa; font-size: 9pt;
  }
  .kw-sales-tag {
    position: absolute; bottom: 3px; left: 3px;
    background: rgba(31,58,95,0.92); color: white;
    padding: 1px 5px; font-size: 8pt;
    font-family: 'Menlo', monospace;
  }
  .kw-listing-meta { padding: 4px 6px; }
  .kw-listing-title {
    font-size: 7.5pt; line-height: 1.35; color: #333;
    min-height: 22px; max-height: 30px; overflow: hidden;
  }
  .kw-listing-row {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-top: 2px; font-size: 7.5pt;
  }
  .kw-listing-price { color: ${COLOR_ACCENT}; font-weight: 700; font-family: 'Helvetica Neue', monospace; }
  .kw-listing-shop { color: ${COLOR_MUTED}; font-size: 7pt; max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* 头部 5 店表 + 集中度 */
  .kw-shops-cell { flex: 1; }
  .kw-donut-cell {
    background: #fafbfc; border: 1px solid #e5e5e5; padding: 8px 12px;
    display: flex; flex-direction: column; align-items: center;
    min-width: 110px;
  }
  .kw-donut-cap { font-size: 8.5pt; color: ${COLOR_MUTED}; margin-top: 2px; }
  .kw-donut-meta { font-size: 8.5pt; color: ${COLOR_MAIN}; font-weight: 600; margin-top: 3px; }

  .kw-data {
    width: 100%; border-collapse: collapse; font-size: 9pt;
  }
  .kw-data thead th {
    background: #f0f0f0; color: ${COLOR_TEXT}; font-weight: 600;
    padding: 4px 8px; text-align: left;
  }
  .kw-data td {
    border-bottom: 1px solid #e8e8e8; padding: 4px 8px;
  }
  .kw-data td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', monospace; }

  /* 价格 + 上架 */
  .kw-price-cell { flex: 1; background: #fafbfc; border: 1px solid #e5e5e5; padding: 8px 12px; }
  .kw-age-cell { flex: 1; background: #fafbfc; border: 1px solid #e5e5e5; padding: 8px 12px; }
  .kw-price-meta { font-size: 8.5pt; color: ${COLOR_MUTED}; margin-top: 4px; }
  .age-bars { margin-top: 2px; }
  .age-bar-row {
    display: flex; align-items: center; gap: 6px;
    font-size: 8.5pt; margin: 2px 0;
  }
  .age-bar-label { width: 60px; color: #444; }
  .age-bar-track { flex: 1; height: 7px; background: #ececec; border-radius: 1px; overflow: hidden; }
  .age-bar-fill { display: block; height: 100%; background: ${COLOR_MAIN}; }
  .age-bar-val { width: 24px; text-align: right; color: ${COLOR_MAIN}; font-weight: 600; font-family: 'Helvetica Neue', monospace; }

  /* 第二页 header mini */
  .kw-header-mini {
    display: flex; align-items: baseline; gap: 10px;
    border-bottom: 1.5px solid ${COLOR_MAIN};
    padding-bottom: 6px; margin-bottom: 12px;
  }
  .kw-rank-mini {
    font-size: 11pt; color: ${COLOR_MUTED};
    font-family: 'Helvetica Neue', sans-serif;
  }
  .kw-title-mini {
    flex: 1; font-size: 14pt; font-weight: 700; color: ${COLOR_MAIN};
    font-family: 'Menlo', monospace;
  }
  .kw-page-tag {
    font-size: 9pt; color: ${COLOR_MUTED}; letter-spacing: 2px;
  }

  .kw-blockquote {
    margin: 4px 0 10px 0; padding: 8px 12px;
    background: #f7f8fa; border-left: 3px solid ${COLOR_MAIN};
    font-family: 'Menlo', 'Monaco', monospace; font-size: 9pt;
    word-break: break-all;
  }
  .kw-tag-block {
    margin: 4px 0 10px 0; padding: 8px 12px;
    background: #f7f8fa; border-left: 3px solid ${COLOR_MAIN};
    font-family: 'Menlo', monospace; font-size: 8.5pt;
    line-height: 1.6; word-break: break-all;
  }
  .kw-llm-insight {
    margin: 4px 0 10px 0; padding: 10px 14px;
    background: #fff8e8; border-left: 3px solid #c8a000;
    font-size: 10pt; line-height: 1.7;
  }

  /* 水印 — 在顶层覆盖内容,opacity 控制透明度 */
  .with-wm {
    position: relative;
  }
  .wm-line {
    position: absolute;
    left: -200px; right: -200px;
    font-size: 22pt;
    font-weight: 600;
    color: #1f3a5f;
    opacity: 0.07;
    white-space: nowrap;
    letter-spacing: 8px;
    font-family: 'Helvetica Neue', 'PingFang SC', sans-serif;
    transform: rotate(-25deg);
    transform-origin: center;
    pointer-events: none;
    user-select: none;
    text-align: center;
    z-index: 9999;
  }
  .wm-line.wm-top { top: 18%; }
  .wm-line.wm-mid { top: 48%; }
  .wm-line.wm-bot { top: 78%; }
</style>
</head>
<body>

<!-- ====== 总览页(包含标题 + 日期) ====== -->
${overviewBody}

<!-- ====== 每词卡片 ====== -->
${keywordPages}

</body>
</html>`;

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, `_temp_${data.runLabel}.html`);
  fs.writeFileSync(htmlPath, HTML);
  console.log(`▶ HTML 写入临时文件 ${(fs.statSync(htmlPath).size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`▶ 启动 chromium · 总 ${limited.length} 个 keyword × 2 页 + 封面 + 总览`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  // 等图片加载完(SVG 内嵌 + base64 都不算外部资源)
  await page.waitForLoadState('load', { timeout: 180_000 }).catch(() => {});
  await page.pdf({
    path: OUT_PATH,
    format: 'A4',
    margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    printBackground: true,
  });
  await browser.close();
  fs.unlinkSync(htmlPath);
  const stat = fs.statSync(OUT_PATH);
  console.log(`✓ 输出: ${OUT_PATH}`);
  console.log(`  大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  评分分布: ≥75 分 ${recommendCount} · 50-74 ${cautionCount} · <50 ${skipCount}`);
}

run().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
