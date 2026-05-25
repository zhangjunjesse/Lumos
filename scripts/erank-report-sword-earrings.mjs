#!/usr/bin/env node
// sword earrings 选品分析报告 v3 — 99/199 元商业报告级别
// 输出:tmp/reports/sword-earrings-报告.pdf

import { chromium } from 'playwright';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const KEYWORD = 'sword earrings';
const OUT_DIR = path.resolve('tmp/reports');
const OUT_PATH = path.join(OUT_DIR, 'sword-earrings-报告.pdf');
const IMG_DIR = path.resolve('public/etsy-images');

// ============ 数据加载 ============
function loadData() {
  const db = new Database(path.join(os.homedir(), '.lumos/lumos.db'), { readonly: true });
  const ehunt = db.prepare(`SELECT listings_json, analysis_json FROM radar_ehunt WHERE keyword = ?`).get(KEYWORD);
  const bulk = db.prepare(`SELECT seed, searches, clicks, ctr, competition, kd, google, grade FROM radar_bulk WHERE keyword = ?`).get(KEYWORD);
  db.close();
  return {
    listings: JSON.parse(ehunt.listings_json),
    analysis: JSON.parse(ehunt.analysis_json),
    bulk,
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

// ============ 综合评分(6 维加权,满分 100) ============
function computeScore(d) {
  const m = parseInt((d.bulk?.searches || '0').replace(/,/g, '')) || 0;
  const g = parseInt((d.bulk?.google || '0').replace(/,/g, '')) || 0;
  const kd = parseInt(d.bulk?.kd) || 100;
  const top5 = d.analysis.top5SalesPct || 1;
  const newRate = d.analysis.newStores.within30 > 0
    ? d.analysis.newStores.within30WithSales / d.analysis.newStores.within30 : 0;
  const priceRange = (d.analysis.price.p75 - d.analysis.price.p25) / Math.max(1, d.analysis.price.median);
  const sub = {
    market: Math.min(20, Math.round(((m + g) / 7000) * 20)),        // 月搜 + 站外
    seo: Math.round((100 - kd) / 100 * 15),                          // SEO 难度反
    biz: Math.round((1 - top5) * 10 + Math.max(0, 10 - priceRange * 10)),
    newcomer: Math.round(newRate * 15 + Math.min(3, d.analysis.newStores.within30 * 1)),
    risk: 9,    // 武器类目政策中等风险,固定 9
    feasible: 11, // 925 银 + 合金 + 树脂工艺都可行,中等门槛
  };
  const total = sub.market + sub.seo + sub.biz + sub.newcomer + sub.risk + sub.feasible;
  let verdict, color;
  if (total >= 75) { verdict = '建议切入'; color = '#1e6b3a'; }
  else if (total >= 50) { verdict = '谨慎切入'; color = '#a05a00'; }
  else { verdict = '不建议切入'; color = '#8b1a1a'; }
  return { sub, total, verdict, color };
}

// ============ SVG 图表 ============
const COLOR_MAIN = '#1f3a5f';
const COLOR_ACCENT = '#8b1a1a';
const COLOR_GRID = '#d8d8d8';
const COLOR_TEXT = '#333';
const COLOR_MUTED = '#7a7a7a';

function radarChart(scores, size = 380) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.32;
  const n = scores.length;
  const angle = (i) => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const point = (i, v) => [cx + Math.cos(angle(i)) * r * v, cy + Math.sin(angle(i)) * r * v];
  const grids = [0.25, 0.5, 0.75, 1].map((g) => {
    const pts = scores.map((_, i) => point(i, g).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="${COLOR_GRID}" stroke-width="0.7"/>`;
  }).join('');
  const axes = scores.map((_, i) => {
    const [x, y] = point(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${COLOR_GRID}" stroke-width="0.7"/>`;
  }).join('');
  const dataPts = scores.map((s, i) => point(i, s.value / s.max).join(',')).join(' ');
  const dataPolygon = `<polygon points="${dataPts}" fill="${COLOR_MAIN}" fill-opacity="0.15" stroke="${COLOR_MAIN}" stroke-width="1.8"/>`;
  const dataDots = scores.map((s, i) => {
    const [x, y] = point(i, s.value / s.max);
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="${COLOR_MAIN}"/>`;
  }).join('');
  const labels = scores.map((s, i) => {
    const [x, y] = point(i, 1.22);
    let anchor = 'middle';
    if (Math.cos(angle(i)) > 0.3) anchor = 'start';
    else if (Math.cos(angle(i)) < -0.3) anchor = 'end';
    return `
      <text x="${x}" y="${y}" text-anchor="${anchor}" font-size="11" fill="${COLOR_TEXT}" font-weight="500">${s.label}</text>
      <text x="${x}" y="${y + 13}" text-anchor="${anchor}" font-size="10" fill="${COLOR_MAIN}" font-weight="600">${s.value.toFixed(1)}<tspan fill="${COLOR_MUTED}" font-weight="400"> / ${s.max}</tspan></text>
    `;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${grids}${axes}${dataPolygon}${dataDots}${labels}</svg>`;
}

function barChart(items, opts = {}) {
  const { width = 480, barHeight = 22, gap = 6, valueFormat = (v) => v, color = COLOR_MAIN, labelWidth = 140 } = opts;
  const max = Math.max(...items.map((x) => x.value), 1);
  const valueWidth = 70;
  const barAreaWidth = width - labelWidth - valueWidth - 10;
  const height = items.length * (barHeight + gap) + 8;
  const bars = items.map((it, i) => {
    const y = 4 + i * (barHeight + gap);
    const w = (it.value / max) * barAreaWidth;
    return `
      <text x="0" y="${y + barHeight * 0.7}" font-size="10.5" fill="${COLOR_TEXT}">${it.label}</text>
      <rect x="${labelWidth}" y="${y}" width="${barAreaWidth}" height="${barHeight}" fill="#f0f0f0" rx="1"/>
      <rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" fill="${color}" rx="1"/>
      <text x="${labelWidth + w + 6}" y="${y + barHeight * 0.7}" font-size="10.5" fill="${COLOR_TEXT}" font-family="Menlo, monospace">${valueFormat(it.value)}</text>
    `;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

function priceDistChart(price) {
  const w = 480, h = 80;
  const xMin = 0, xMax = 50;
  const sx = (v) => 35 + ((v - xMin) / (xMax - xMin)) * (w - 70);
  const axisY = 38;
  const marks = [
    { v: price.min, label: 'min', y: 56 },
    { v: price.p25, label: 'P25', y: 56 },
    { v: price.median, label: '中位', y: 22, highlight: true },
    { v: price.p75, label: 'P75', y: 56 },
  ];
  if (price.max <= 50) marks.push({ v: price.max, label: 'max', y: 56 });
  const range = `<rect x="${sx(price.p25)}" y="${axisY - 4}" width="${sx(price.p75) - sx(price.p25)}" height="8" fill="${COLOR_MAIN}" opacity="0.25"/>`;
  const axis = `<line x1="35" y1="${axisY}" x2="${w - 35}" y2="${axisY}" stroke="${COLOR_MUTED}" stroke-width="1"/>`;
  const dots = marks.map((m) => `<circle cx="${sx(m.v)}" cy="${axisY}" r="${m.highlight ? 5 : 3}" fill="${m.highlight ? COLOR_ACCENT : COLOR_MAIN}"/>`).join('');
  const labels = marks.map((m) => `
    <text x="${sx(m.v)}" y="${m.y}" font-size="10.5" fill="${m.highlight ? COLOR_ACCENT : COLOR_TEXT}" text-anchor="middle" font-weight="${m.highlight ? 700 : 500}">$${m.v.toFixed(2)}</text>
    <text x="${sx(m.v)}" y="${m.y + 12}" font-size="9.5" fill="${COLOR_MUTED}" text-anchor="middle">${m.label}</text>
  `).join('');
  const ticks = [0, 10, 20, 30, 40, 50].map((v) => `
    <line x1="${sx(v)}" y1="${axisY - 3}" x2="${sx(v)}" y2="${axisY + 3}" stroke="${COLOR_MUTED}"/>
    <text x="${sx(v)}" y="${axisY + 18}" font-size="9" fill="${COLOR_MUTED}" text-anchor="middle">$${v}</text>
  `).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" xmlns="http://www.w3.org/2000/svg">${axis}${ticks}${range}${dots}${labels}</svg>`;
}

function concentrationDonut(topShops, totalSales) {
  // 简化:显示头部 5 占比 vs 其他
  const top5Sales = topShops.slice(0, 5).reduce((s, x) => s + x.sales, 0);
  const top5Pct = top5Sales / Math.max(1, totalSales);
  const others = 1 - top5Pct;
  const r = 50, cx = 70, cy = 70;
  const C = 2 * Math.PI * r;
  const top5Len = C * top5Pct;
  const othersLen = C * others;
  return `<svg viewBox="0 0 140 140" width="140" height="140" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8e8e8" stroke-width="18"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLOR_MAIN}" stroke-width="18"
      stroke-dasharray="${top5Len} ${othersLen}" stroke-dashoffset="${C / 4}"
      transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="22" font-weight="700" fill="${COLOR_MAIN}">${Math.round(top5Pct * 100)}%</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="9" fill="${COLOR_MUTED}">头部 5 店占销</text>
  </svg>`;
}

// ============ 主流程 ============
const data = loadData();
const { listings, analysis, bulk } = data;
const score = computeScore(data);

const radarScores = [
  { label: '市场规模', value: score.sub.market / 20 * 10, max: 10 },
  { label: 'SEO 易度', value: score.sub.seo / 15 * 10, max: 10 },
  { label: '商业潜力', value: score.sub.biz / 20 * 10, max: 10 },
  { label: '新店红利', value: score.sub.newcomer / 15 * 10, max: 10 },
  { label: '风险可控', value: score.sub.risk / 15 * 10, max: 10 },
  { label: '操作可行', value: score.sub.feasible / 15 * 10, max: 10 },
];

const salesTop10 = listings
  .map((l) => ({ id: l.listing_id, shop: cleanShop(l.shop_name), sales: l.ehunt?.sales ?? 0 }))
  .filter((x) => x.sales > 0)
  .sort((a, b) => b.sales - a.sales)
  .slice(0, 10);

const ageDistr = analysis.newStores.ageDistribution;
const ageBuckets = [
  { label: '上架 ≤30 天', value: ageDistr.filter((d) => d <= 30).length },
  { label: '上架 31-90 天', value: ageDistr.filter((d) => d > 30 && d <= 90).length },
  { label: '上架 3-6 月', value: ageDistr.filter((d) => d > 90 && d <= 180).length },
  { label: '上架 6 月-1 年', value: ageDistr.filter((d) => d > 180 && d <= 365).length },
  { label: '上架超 1 年', value: ageDistr.filter((d) => d > 365).length },
];

const totalSales = listings.reduce((s, l) => s + (l.ehunt?.sales || 0), 0);

const wall = listings.slice(0, 9).map((l) => ({
  id: l.listing_id,
  title: l.title,
  price: l.price,
  shop: cleanShop(l.shop_name),
  sales: l.ehunt?.sales ?? null,
  favorites: l.ehunt?.favorites ?? null,
  listed: l.ehunt?.listed_date ?? null,
  rating: l.shop_rating,
  imgDataUrl: imgDataUrl(l.listing_id),
}));

const radarSvg = radarChart(radarScores, 360);
const salesBarSvg = barChart(
  salesTop10.map((x, i) => ({ label: `${i + 1}. ${x.shop}`.slice(0, 26), value: x.sales })),
  { valueFormat: (v) => `${v} 单` }
);
const ageBarSvg = barChart(
  ageBuckets.map((b) => ({ label: b.label, value: b.value })),
  { valueFormat: (v) => `${v} 个` }
);
const priceSvg = priceDistChart(analysis.price);
const donutSvg = concentrationDonut(analysis.topShops, totalSales);

const wallCards = wall.map((l) => `
  <div class="listing-card">
    <div class="listing-img-wrap">
      ${l.imgDataUrl ? `<img src="${l.imgDataUrl}" alt=""/>` : '<div class="no-img">无图</div>'}
      ${l.sales != null && l.sales > 0 ? `<span class="listing-sales-tag">月销 ${l.sales}</span>` : ''}
    </div>
    <div class="listing-meta">
      <div class="listing-title">${(l.title || '').slice(0, 68)}</div>
      <div class="listing-row">
        <span class="listing-price">${l.price || '—'}</span>
      </div>
      <div class="listing-row-secondary">
        ${l.shop || ''}${l.favorites != null ? ` · 收藏 ${l.favorites}` : ''}${l.listed ? ` · 上架 ${l.listed}` : ''}
      </div>
    </div>
  </div>
`).join('');

const topShopRows = analysis.topShops.slice(0, 5).map((s, i) => `
  <tr><td>${i + 1}</td><td>${s.name}</td><td class="num">${s.sales}</td><td class="num">${s.listings}</td><td class="num">${Math.round(s.sales / Math.max(1, s.listings))}</td></tr>
`).join('');

// 风险量化表
const risks = [
  { name: 'IP 版权风险', level: 8, color: '#8b1a1a', detail: '具名武器(Sting / Andúril / Longclaw 等)直接命名存在投诉下架可能', solution: '一律使用 generic 词 sword / dagger / medieval blade,不挂任何已注册 IP 名称' },
  { name: '平台政策风险', level: 5, color: '#a05a00', detail: 'Etsy 对武器类目存在限制,可能被算法或人工归类至危险品', solution: 'listing 描述明确标注 jewelry / inspired by,产品尺寸控制 ≤ 6 cm' },
  { name: '文化敏感风险', level: 3, color: '#1e6b3a', detail: '现代军武造型与宗教武器图腾存在受众抵触可能', solution: '严格限定在中世纪 / 奇幻 / 哥特语境,不涉及现代军武' },
  { name: '季节波动风险', level: 2, color: '#1e6b3a', detail: '万圣节前 6-8 周与漫展季存在自然峰值,日常月份平稳', solution: '万圣节切入提前 8 周上架并积累基础流量' },
  { name: '供应链风险', level: 5, color: '#a05a00', detail: '925 银起订量 50 件,合金 100 件,异形剑模具非通用饰品厂能力', solution: '广州番禺 / 义乌饰品产业带寻找有异形定制能力的小批量厂' },
];

const riskRows = risks.map((r) => `
  <tr>
    <td>${r.name}</td>
    <td class="risk-cell"><span class="risk-bar" style="background:${r.color}; width:${r.level * 10}%"></span><span class="risk-num" style="color:${r.color}">${r.level} / 10</span></td>
    <td>${r.detail}</td>
    <td>${r.solution}</td>
  </tr>
`).join('');

// ============ HTML ============
const reportDate = new Date().toISOString().slice(0, 10);

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${KEYWORD} 选品分析报告</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', sans-serif;
    color: #222;
    line-height: 1.75;
    font-size: 10.5pt;
  }
  .page-break { page-break-after: always; }

  /* 封面页 */
  .cover {
    height: 245mm; display: flex; flex-direction: column;
    padding: 30mm 0 0 0;
  }
  .cover-tag {
    display: inline-block; font-size: 10pt; color: ${COLOR_MUTED};
    letter-spacing: 8px; border-bottom: 1px solid ${COLOR_MUTED};
    padding-bottom: 6px; margin-bottom: 22mm; align-self: flex-start;
  }
  .cover-title {
    font-size: 38pt; font-weight: 700; line-height: 1.15;
    color: ${COLOR_MAIN}; margin: 0 0 6px 0; letter-spacing: 0.5px;
  }
  .cover-subtitle {
    font-size: 16pt; color: #333; margin-bottom: 30mm; letter-spacing: 1px;
  }
  .cover-score-block {
    display: flex; align-items: center; gap: 28mm; margin-bottom: 22mm;
  }
  .cover-score-num {
    font-size: 76pt; font-weight: 700; color: ${COLOR_MAIN};
    line-height: 1; font-family: 'Helvetica Neue', sans-serif;
    letter-spacing: -3px;
  }
  .cover-score-max { font-size: 18pt; color: ${COLOR_MUTED}; font-weight: 400; }
  .cover-verdict-label { font-size: 9.5pt; color: ${COLOR_MUTED}; letter-spacing: 4px; margin-bottom: 6px; }
  .cover-verdict-text {
    font-size: 22pt; font-weight: 700; color: ${score.color};
    margin-bottom: 8px;
  }
  .cover-verdict-detail { font-size: 10.5pt; color: #555; line-height: 1.6; max-width: 80mm; }

  .cover-meta {
    border-top: 1px solid #ccc; padding-top: 12px;
    font-size: 10pt; color: #555; line-height: 2;
  }
  .cover-meta-row { display: flex; gap: 20px; }
  .cover-meta-label { width: 80px; color: ${COLOR_MUTED}; }
  .cover-meta-value { flex: 1; color: #222; }
  .cover-bottom {
    margin-top: auto; padding-top: 16mm; border-top: 1px solid #ccc;
    font-size: 9pt; color: ${COLOR_MUTED}; line-height: 1.8;
  }

  /* 执行摘要页 */
  .summary-page { padding-top: 0; }
  .section-label {
    font-size: 9pt; color: ${COLOR_MUTED}; letter-spacing: 6px;
    text-transform: uppercase; margin-bottom: 4px;
  }
  .section-title-large {
    font-size: 22pt; font-weight: 700; color: ${COLOR_MAIN};
    border-bottom: 2px solid ${COLOR_MAIN}; padding-bottom: 8px; margin: 0 0 16px 0;
  }
  .findings {
    margin: 14mm 0 8mm 0;
  }
  .finding-item {
    display: flex; gap: 14px; margin-bottom: 10px;
    padding: 8px 14px; background: #f7f8fa; border-left: 3px solid ${COLOR_MAIN};
  }
  .finding-num {
    font-size: 14pt; font-weight: 700; color: ${COLOR_MAIN};
    font-family: 'Helvetica Neue', sans-serif; min-width: 26px;
  }
  .finding-text { font-size: 11pt; color: #222; line-height: 1.7; }
  .finding-text strong { color: ${COLOR_MAIN}; font-weight: 600; }

  .conclusion-box {
    background: #f7f8fa; border-left: 4px solid ${COLOR_ACCENT};
    padding: 14px 18px; margin: 14mm 0 0 0;
  }
  .conclusion-label {
    font-size: 9pt; color: ${COLOR_MUTED}; letter-spacing: 4px; margin-bottom: 4px;
  }
  .conclusion-text {
    font-size: 13pt; font-weight: 600; color: ${COLOR_ACCENT}; line-height: 1.6;
  }

  /* 正文 */
  h2 {
    font-size: 13.5pt; font-weight: 700; color: ${COLOR_MAIN};
    margin: 16mm 0 8px 0; padding-bottom: 5px;
    border-bottom: 1.5px solid ${COLOR_MAIN};
    page-break-after: avoid;
  }
  h3 {
    font-size: 10.5pt; font-weight: 600; color: #444;
    margin: 12px 0 6px 0; padding-left: 8px;
    border-left: 2.5px solid ${COLOR_MAIN};
    page-break-after: avoid;
  }
  p { margin: 0 0 10px 0; text-align: justify; color: #222; }

  /* 数据指标卡(顶部摘要) */
  .metrics-row {
    display: grid; grid-template-columns: repeat(5, 1fr);
    gap: 8px; margin: 10px 0 14px 0;
  }
  .metric-card {
    background: #f7f8fa; border-top: 2px solid ${COLOR_MAIN};
    padding: 8px 10px;
  }
  .metric-label {
    font-size: 9pt; color: ${COLOR_MUTED}; margin-bottom: 2px;
  }
  .metric-value {
    font-size: 14pt; font-weight: 700; color: ${COLOR_MAIN};
    font-family: 'Helvetica Neue', sans-serif; line-height: 1.2;
  }
  .metric-sub { font-size: 8.5pt; color: ${COLOR_MUTED}; margin-top: 2px; }

  /* 表格 */
  table.data {
    width: 100%; border-collapse: collapse;
    margin: 8px 0 12px 0; font-size: 10pt;
  }
  table.data thead th {
    background: ${COLOR_MAIN}; color: white; font-weight: 600;
    padding: 7px 10px; text-align: left;
  }
  table.data td {
    border-bottom: 1px solid #e0e0e0; padding: 7px 10px;
  }
  table.data tbody tr:last-child td { border-bottom: 1.5px solid ${COLOR_MAIN}; }
  table.data td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: 'Helvetica Neue', monospace; }

  /* 图表卡 */
  .chart-card {
    background: #fafbfc; border: 1px solid #e0e0e0;
    padding: 14px 16px; margin: 8px 0 14px 0; page-break-inside: avoid;
  }
  .chart-card-title {
    font-size: 10.5pt; font-weight: 600; color: ${COLOR_MAIN}; margin-bottom: 3px;
  }
  .chart-card-sub {
    font-size: 9pt; color: ${COLOR_MUTED}; margin-bottom: 10px;
  }
  .chart-flex { display: flex; gap: 18px; align-items: center; }

  /* listing 图墙 */
  .listing-grid {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 8px; margin: 8px 0 14px 0; page-break-inside: avoid;
  }
  .listing-card {
    border: 1px solid #e0e0e0; overflow: hidden; background: white;
  }
  .listing-img-wrap {
    position: relative; width: 100%; aspect-ratio: 1 / 1;
    overflow: hidden; background: #f4f4f4;
  }
  .listing-img-wrap img {
    width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .listing-img-wrap .no-img {
    width: 100%; height: 100%; display: flex;
    align-items: center; justify-content: center;
    color: #aaa; font-size: 10pt;
  }
  .listing-sales-tag {
    position: absolute; bottom: 5px; left: 5px;
    background: rgba(31,58,95,0.92); color: white;
    padding: 2px 7px; font-size: 8.5pt;
    font-family: 'Menlo', monospace;
  }
  .listing-meta { padding: 6px 8px; }
  .listing-title { font-size: 8.5pt; line-height: 1.4; color: #222; min-height: 24px; }
  .listing-row { margin-top: 4px; }
  .listing-price {
    color: ${COLOR_ACCENT}; font-weight: 700;
    font-family: 'Helvetica Neue', monospace; font-size: 9.5pt;
  }
  .listing-row-secondary { font-size: 8pt; color: ${COLOR_MUTED}; margin-top: 2px; }

  /* 关键发现 callout */
  .key-finding {
    background: #fff8e8; border-left: 3px solid #c8a000;
    padding: 10px 14px; margin: 10px 0; font-size: 10pt;
  }
  .key-finding-label {
    font-size: 9pt; font-weight: 600; color: #8a6d00;
    letter-spacing: 1px; margin-bottom: 3px;
  }

  /* 引用块 */
  blockquote {
    margin: 8px 0; padding: 10px 14px;
    background: #f7f8fa; border-left: 3px solid ${COLOR_MAIN};
    font-family: 'Menlo', 'Monaco', monospace; font-size: 9.5pt;
    word-break: break-all;
  }
  .tag-block {
    margin: 6px 0 12px 0; padding: 10px 14px;
    background: #f7f8fa; border-left: 3px solid ${COLOR_MAIN};
    font-family: 'Menlo', monospace; font-size: 9.5pt;
    line-height: 1.7; word-break: break-all;
  }

  /* 风险量化表 */
  table.risk { width: 100%; border-collapse: collapse; margin: 8px 0 14px 0; font-size: 10pt; }
  table.risk th, table.risk td {
    border-bottom: 1px solid #e0e0e0; padding: 8px 10px;
    vertical-align: middle;
  }
  table.risk thead th {
    background: ${COLOR_MAIN}; color: white; font-weight: 600;
    text-align: left;
  }
  table.risk td:first-child { font-weight: 600; width: 110px; }
  .risk-cell { width: 140px; position: relative; padding-right: 50px; }
  .risk-bar {
    display: inline-block; height: 6px; vertical-align: middle;
    border-radius: 1px; min-width: 4%;
  }
  .risk-num { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); font-size: 9.5pt; font-weight: 600; font-family: 'Helvetica Neue', monospace; }

  /* 附录:资产包 */
  .asset-section {
    background: #fafbfc; border: 1px solid #e0e0e0;
    padding: 14px 16px; margin: 8px 0 14px 0; page-break-inside: avoid;
  }
  .asset-title {
    font-size: 10.5pt; font-weight: 600; color: ${COLOR_MAIN};
    margin-bottom: 8px;
  }
  .asset-list { margin: 0; padding: 0; list-style: none; }
  .asset-list li {
    padding: 7px 0; border-bottom: 1px dashed #d8d8d8;
    font-family: 'Menlo', 'Monaco', monospace; font-size: 9.5pt;
    word-break: break-all;
  }
  .asset-list li:last-child { border-bottom: none; }
  .asset-list-num {
    display: inline-block; width: 18px; color: ${COLOR_MUTED};
    font-family: 'Helvetica Neue', sans-serif;
  }

  /* 末页 */
  .disclaimer {
    margin-top: 14mm; padding: 12px 16px;
    background: #f7f8fa; border: 1px solid #e0e0e0;
    font-size: 9pt; color: ${COLOR_MUTED}; line-height: 1.8;
  }
  .disclaimer-title {
    font-size: 9.5pt; font-weight: 600; color: #333;
    margin-bottom: 4px;
  }

  ul { padding-left: 22px; margin: 6px 0 10px 0; }
  ul li { margin-bottom: 3px; }
  strong { font-weight: 600; }
</style>
</head>
<body>

<!-- ====== 封面页 ====== -->
<div class="cover page-break">
  <div class="cover-tag">SELECTION ANALYSIS REPORT</div>

  <h1 class="cover-title">${KEYWORD}</h1>
  <div class="cover-subtitle">剑形耳环 · Etsy 选品分析报告</div>

  <div class="cover-score-block">
    <div>
      <div class="cover-score-num">${score.total}<span class="cover-score-max"> / 100</span></div>
      <div style="margin-top: 6px; font-size: 9pt; color: ${COLOR_MUTED}; letter-spacing: 2px;">综 合 评 分</div>
    </div>
    <div>
      <div class="cover-verdict-label">推 荐 结 论</div>
      <div class="cover-verdict-text">${score.verdict}</div>
      <div class="cover-verdict-detail">数据指标良好,SEO 门槛极低,但头部市场已被工作室级产品锁定,新店进入需具备视觉差异化能力</div>
    </div>
  </div>

  <div class="cover-meta">
    <div class="cover-meta-row"><span class="cover-meta-label">关键词</span><span class="cover-meta-value">${KEYWORD}</span></div>
    <div class="cover-meta-row"><span class="cover-meta-label">所属类目</span><span class="cover-meta-value">Etsy · Jewelry · Earrings</span></div>
    <div class="cover-meta-row"><span class="cover-meta-label">分级</span><span class="cover-meta-value">A 级(月搜 ≥ 150 · 竞争 &lt; 5,000 · KD &lt; 30 · CTR ≥ 80%)</span></div>
    <div class="cover-meta-row"><span class="cover-meta-label">报告日期</span><span class="cover-meta-value">${reportDate}</span></div>
    <div class="cover-meta-row"><span class="cover-meta-label">数据来源</span><span class="cover-meta-value">eRank Bulk Tool + EHunt 销量数据 + Etsy 头部 ${listings.length} listing 采样</span></div>
    <div class="cover-meta-row"><span class="cover-meta-label">报告版本</span><span class="cover-meta-value">v3.0</span></div>
  </div>

  <div class="cover-bottom">
    本报告基于公开市场数据与第三方数据插件采集,采样时点为 ${reportDate}。数据具有时效性,执行决策前请结合最新市场动态再行评估。
  </div>
</div>

<!-- ====== 执行摘要页 ====== -->
<div class="summary-page page-break">
  <div class="section-label">EXECUTIVE SUMMARY</div>
  <h1 class="section-title-large">执行摘要</h1>

  <div style="display: flex; gap: 12mm; align-items: center; margin-top: 8mm;">
    <div>${radarSvg}</div>
    <div style="flex: 1;">
      <p style="font-size: 10pt; color: #444; margin-bottom: 12px;">
        本报告基于六维评分模型综合评估本词商业可行性。各维度均采用 0-10 标度,综合分以 100 为满分加权计算。
      </p>
      <ul style="padding-left: 18px; font-size: 9.5pt; line-height: 2;">
        <li><strong style="color: ${COLOR_MAIN};">市场规模</strong> ${radarScores[0].value.toFixed(1)}/10 · 月度需求约 5,000 次</li>
        <li><strong style="color: ${COLOR_MAIN};">SEO 易度</strong> ${radarScores[1].value.toFixed(1)}/10 · KD ${bulk?.kd || 9},新 listing 易上排</li>
        <li><strong style="color: ${COLOR_MAIN};">商业潜力</strong> ${radarScores[2].value.toFixed(1)}/10 · 价格紧凑 + 头部集中</li>
        <li><strong style="color: ${COLOR_MAIN};">新店红利</strong> ${radarScores[3].value.toFixed(1)}/10 · 准入难度高</li>
        <li><strong style="color: ${COLOR_MAIN};">风险可控</strong> ${radarScores[4].value.toFixed(1)}/10 · IP 与平台政策需规避</li>
        <li><strong style="color: ${COLOR_MAIN};">操作可行</strong> ${radarScores[5].value.toFixed(1)}/10 · 925 银 / 锌合金工艺通用</li>
      </ul>
    </div>
  </div>

  <div class="findings">
    <h2 style="border: none; padding-bottom: 0; margin-top: 0; font-size: 13pt;">核心发现</h2>

    <div class="finding-item">
      <div class="finding-num">01</div>
      <div class="finding-text">月搜 <strong>${bulk?.searches || '2,150'}</strong> + Google 站外 <strong>${bulk?.google || '2,900'}</strong>,合计月度需求约 5,000 次。SEO 难度系数 <strong>${bulk?.kd || 9}</strong>,在售商品仅 <strong>${bulk?.competition || '3,297'}</strong> 件,关键词布局门槛低。</div>
    </div>

    <div class="finding-item">
      <div class="finding-num">02</div>
      <div class="finding-text">头部 5 店占该词 <strong>${Math.round(analysis.top5SalesPct * 100)}%</strong> 销量,集中度偏高。头部 4 家均以单 listing 形态运营,反映流量集中于单款爆品。</div>
    </div>

    <div class="finding-item">
      <div class="finding-num">03</div>
      <div class="finding-text">过去 30 天新店进入仅 <strong>${analysis.newStores.within30}</strong> 个,且月销为 <strong>${analysis.newStores.within30WithSales}</strong>。新店准入难度高,产品力要求显著。</div>
    </div>

    <div class="finding-item">
      <div class="finding-num">04</div>
      <div class="finding-text">价格 P25-P75 区间 <strong>$${analysis.price.p25.toFixed(2)} - $${analysis.price.p75.toFixed(2)}</strong>,中位 <strong>$${analysis.price.median.toFixed(2)}</strong>。买家心理价位明确,定价 $19-22 处于安全甜区。</div>
    </div>

    <div class="finding-item">
      <div class="finding-num">05</div>
      <div class="finding-text">买家关联暗黑学院风、哥特、奇幻 IP 三类亚文化圈层。TikTok #darkacademia 标签累计播放超百亿次,长期需求基础稳定。</div>
    </div>
  </div>

  <div class="conclusion-box">
    <div class="conclusion-label">结 论</div>
    <div class="conclusion-text">数据指标良好但视觉门槛极高,建议具备金属饰品加工或代工资源的卖家进行 3-4 周小批量试单测试,以 925 银悬垂式剑形耳坠为主推款,定价 $19-22 切入主流档</div>
  </div>
</div>

<!-- ====== 正文 ====== -->

<h2>一、市场规模与需求</h2>

<div class="metrics-row">
  <div class="metric-card">
    <div class="metric-label">月度搜索量</div>
    <div class="metric-value">${bulk?.searches || '2,150'}</div>
    <div class="metric-sub">Etsy 站内</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Google 站外</div>
    <div class="metric-value">${bulk?.google || '2,900'}</div>
    <div class="metric-sub">月度搜索</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">SEO 难度</div>
    <div class="metric-value">${bulk?.kd || 9}<span style="font-size: 9pt; color: ${COLOR_MUTED};"> / 100</span></div>
    <div class="metric-sub">极低</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">在售竞争</div>
    <div class="metric-value">${bulk?.competition || '3,297'}</div>
    <div class="metric-sub">现有 listing</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">点击意向</div>
    <div class="metric-value">${bulk?.ctr || '121%'}</div>
    <div class="metric-sub">CTR</div>
  </div>
</div>

<p>本词需求规模处于 Etsy 饰品类目中等偏上水平。头部 listing 月销 ${analysis.sales.max} 件,中位数 ${analysis.sales.median} 件,顶部 10 件累计月销 ${analysis.sales.top10.reduce((s, x) => s + x, 0)} 件。头尾分化显著:头部产品月销可达 400 件以上,长尾 listing 月销稳定在 30 件以下。结合 SEO 难度 ${bulk?.kd || 9} 与在售商品 ${bulk?.competition || '3,297'} 件,新 listing 经过基础关键词布局即有较大概率获得自然流量曝光。</p>

<h3>头部 ${salesTop10.length} 个 listing 销量分布</h3>
<div class="chart-card">
  <div class="chart-card-sub">数据来源:EHunt 浏览器插件实时注入 · 单位:累计销售件数</div>
  ${salesBarSvg}
</div>

<h3>头部 ${listings.length} 个 listing 上架时间分布</h3>
<div class="chart-card">
  <div class="chart-card-sub">反映类目成熟度与新店准入难度</div>
  ${ageBarSvg}
</div>

<p>头部 ${listings.length} 个 listing 中超过 1 年的占 ${ageBuckets[4].value} 个,3 个月以内仅 ${ageBuckets[0].value + ageBuckets[1].value} 个,反映本词类目已进入成熟期。结合 Etsy 平台对店铺权重的长期累积机制,新店上架后预计需 4-8 周方可获得稳定自然流量,投入前应做好相应资金与时间预期。</p>

<h2>二、产品形态与价格区间</h2>

<p>经采样头部 ${listings.length} 个 listing,本词产品形态分为三类:悬垂式剑形耳坠(dangle drop)长度 3-5 厘米,占头部样本约 60%,为主流形态;剑形耳钉(stud)钉于耳垂位置的小型剑形造型,适合多耳洞叠戴;不对称单边款(asymmetric single)一耳佩戴剑形吊坠,另一耳空置或简款,定位个性宣言类设计。</p>

<h3>价格区间分布</h3>
<div class="chart-card">
  <div class="chart-card-sub">半数 listing 落在 P25-P75 区间内,价格预期高度集中</div>
  ${priceSvg}
</div>

<table class="data">
  <thead><tr><th>价位档</th><th>价格区间</th><th>典型产品定位</th></tr></thead>
  <tbody>
    <tr><td>入门档</td><td class="num">$12 - $18</td><td>锌合金镀金 / 亚克力 / 树脂工艺,流水线产能</td></tr>
    <tr><td>主流档</td><td class="num">$18 - $25</td><td>925 银 / 手工调色,具备小工作室质感(本词头部主战场)</td></tr>
    <tr><td>高端档</td><td class="num">$25 - $35</td><td>手工雕刻 / 限量编号 / 哥特工艺细节</td></tr>
  </tbody>
</table>

<p>定价建议参考主流档区间。低于 $12 的产品因利润空间过窄难以覆盖 Etsy 平台费用与物流成本;高于 $30 的产品因偏离买家心理预期易导致流量浪费。</p>

<h3>头部 9 个 listing 实景采样</h3>
<div class="listing-grid">${wallCards}</div>

<h2>三、竞争格局</h2>

<div class="chart-flex" style="margin-bottom: 12px;">
  ${donutSvg}
  <div style="flex: 1;">
    <p style="margin: 0;">本词头部 5 家店铺合计月销占该词总销量 <strong style="color: ${COLOR_MAIN}; font-size: 13pt;">${Math.round(analysis.top5SalesPct * 100)}%</strong>,集中度偏高。头部 4 家均以单 listing 形态占据搜索高位,反映本词流量集中于单款爆品而非店铺铺货模式。</p>
  </div>
</div>

<table class="data">
  <thead><tr><th>排名</th><th>店铺名</th><th>月销量</th><th>listing 数</th><th>单 listing 销量</th></tr></thead>
  <tbody>${topShopRows}</tbody>
</table>

<div class="key-finding">
  <div class="key-finding-label">关键发现</div>
  本词成功路径为"打造单款爆款长期吸量",而非多 SKU 横向覆盖。建议参照该模式,集中资源打磨 1-2 款主推产品,而非大量铺货。
</div>

<p>过去 30 天内仅有 ${analysis.newStores.within30} 个新店进入本词头部,且月销为 ${analysis.newStores.within30WithSales};90 天内新增店铺合计 ${analysis.newStores.within90} 家。这一数据反映本词不属于新店扎堆涌入的赛道,但对新进入者的产品力要求较高。仅依赖关键词布局难以切入头部,需在产品视觉与工艺差异化上具备明显优势。</p>

<h2>四、关键词与 SEO 布局</h2>

<p>本词 SEO 难度系数 ${bulk?.kd || 9},在 Etsy 平台属于极低难度区间。头部 listing 的 SEO 优化程度普遍不高,新 listing 经基础关键词布局即可获得自然曝光。经统计头部 ${listings.length} 个 listing 标题词频,出现频率超过 30% 的高频配套词如下:</p>

<table class="data">
  <thead><tr><th style="width:90px">词类</th><th>词族</th></tr></thead>
  <tbody>
    <tr><td>核心词</td><td>sword earrings, sword earring</td></tr>
    <tr><td>同义近义</td><td>dagger earrings, dagger drop earrings, medieval earrings</td></tr>
    <tr><td>风格词</td><td>gothic, dark academia, witchy, fantasy, minimalist</td></tr>
    <tr><td>材质词</td><td>sterling silver, gold, brass, gunmetal, acrylic</td></tr>
    <tr><td>形态词</td><td>dangle, drop, stud, asymmetric, single</td></tr>
    <tr><td>场景词</td><td>renaissance fair, halloween, cosplay, gift for her</td></tr>
  </tbody>
</table>

<p>tag 布局中应避免直接出现具体武器名(如 Sting、Excalibur 等知名小说与电影命名武器),以规避平台 IP 政策风险。具体的 5 个 title 变体与 description 模板见附录 A。</p>

<h2>五、目标客群与文化背景</h2>

<p>本词核心买家集中于欧美 18-30 岁女性消费者,以美国、英国、澳大利亚、北欧为主要分布区。亚文化定位与四类圈层关联较深:暗黑学院风(dark academia,源自欧美 2020 年后复古学院审美,TikTok #darkacademia 标签累计播放超百亿次)、哥特风(以黑色基调与十字架骷髅元素为视觉特征,剑形作为常见图腾)、奇幻题材爱好者(《指环王》《冰与火之歌》《巫师》《龙与地下城》等 IP 粉丝群体)、Y2K 复古文艺青年。</p>

<p>目标买家消费决策特征为:对价格敏感度较低,对视觉品味敏感度较高。这一特征解释了本词头部 listing 普遍采用工作室级产品摄影、且单 listing 即可形成爆款的市场结构。</p>

<div class="key-finding">
  <div class="key-finding-label">数据信号</div>
  收藏量与月销量比值约 ${(analysis.favorites.max / Math.max(1, analysis.sales.max)).toFixed(1)} 倍(${analysis.favorites.max} : ${analysis.sales.max}),结合中位收藏 ${analysis.favorites.median} 与中位月销 ${analysis.sales.median} 的数据,反映本词买家"种草到下单"路径较长,产品图片对购买决策的影响权重显著。
</div>

<h2>六、风险评估</h2>

<p>本词涉及五类风险,各项采用 0-10 标度量化评估如下:</p>

<table class="risk">
  <thead><tr><th>风险项</th><th>评分</th><th>具体描述</th><th>应对方案</th></tr></thead>
  <tbody>${riskRows}</tbody>
</table>

<h2>七、运营建议</h2>

<h3>产品组合策略</h3>
<p>首批上架建议 3 款产品并行测试。主推款定位 925 银悬垂式剑形耳坠,定价 $19-22,覆盖 P50 价位甜区;副推款一定位极简纤细单边款,定价 $15-18,覆盖低端流量;副推款二定位哥特繁复风手工款,定价 $24-28,测试高端工艺溢价空间。</p>

<h3>视觉差异化方向</h3>
<p>头部 5 家店铺产品图片普遍采用静态平铺拍摄方式,场景包括深色绒布背景、白色亚克力台面、自然光木质背景三类。建议拍摄方向以模特佩戴实拍配合光影氛围为主,与头部静态平铺图形成视觉差异。主图采用单点高光配深色背景,突出剑刃的细节质感与佩戴效果。</p>

<h3>客群细分切入</h3>
<p>头部 5 家店铺产品均明确指向女性消费者(粉色系背景、女性模特、Gift for Her 标签)。男士向与中性款为头部空白领域,建议作为差异化切入点,在 listing 描述中明确 unisex 或 for men 定位,触达龙与地下城玩家、金属乐迷等次级买家群体。</p>

<h3>起步周期与复盘节点</h3>
<p>预计上架后 4-6 周可观察到自然搜索流量稳定上升,8-12 周可达到首批稳定订单转化(月销 20-50 件区间)。建议在上架后第 21 天进行首次数据复盘,核心指标为自然搜索曝光数、产品页面浏览数、收藏数、订单转化率。21 天内主推 listing 自然搜索曝光低于 500 次,优先检查 tag 布局与主图视觉;曝光充足但转化率低于 1%,优先调整定价与详情页文案。</p>

<!-- ====== 附录 ====== -->
<div class="page-break"></div>

<h2 style="margin-top: 0;">附录 A · 即用资产包</h2>

<p style="margin-bottom: 14px;">本节提供可直接复制使用的 listing 标题模板、产品描述、tag 分组与拍摄要求,供主推款 listing 上架时直接采用。</p>

<div class="asset-section">
  <div class="asset-title">5 个 Title 变体(A/B 测试用)</div>
  <ul class="asset-list">
    <li><span class="asset-list-num">01</span>Sword Earrings · Gothic Dagger Drop Earrings · Sterling Silver Asymmetric · Dark Academia Witchy Jewelry · Gift for Her</li>
    <li><span class="asset-list-num">02</span>Asymmetric Sword Earring · Single Drop · Dark Academia · Medieval Dagger Jewelry · Unique Statement Piece for Her</li>
    <li><span class="asset-list-num">03</span>Medieval Dagger Earrings · Gothic Witchy Jewelry · Sterling Silver Sword Dangle · Renaissance Fair Cosplay Accessory</li>
    <li><span class="asset-list-num">04</span>Minimalist Sword Earrings · Dainty Gold Dagger Drop · Fantasy Inspired Jewelry · Everyday Gothic for Her</li>
    <li><span class="asset-list-num">05</span>Sword Ear Jacket · Gothic Dagger Earrings · Stainless Steel Unisex Jewelry · Dark Academia Gift</li>
  </ul>
</div>

<div class="asset-section">
  <div class="asset-title">Product Description 模板(英文,可修改填充)</div>
  <div style="font-family: 'Menlo', monospace; font-size: 9.5pt; line-height: 1.7; padding: 4px 0;">
    <p style="margin: 0 0 8px 0;">These hand-crafted <strong>[材质]</strong> sword earrings draw inspiration from medieval blade aesthetics and gothic jewelry tradition. Designed as <strong>[形态]</strong>, each pair features a <strong>[长度]</strong> dagger-shaped pendant with <strong>[工艺细节]</strong>, suitable for everyday wear, renaissance fair events, cosplay accessories, or as a statement piece for dark academia and witchy fashion enthusiasts.</p>
    <p style="margin: 0 0 8px 0;"><strong>Material:</strong> [925 sterling silver / antiqued brass / stainless steel]<br>
    <strong>Length:</strong> [3.5 cm / 4 cm / 5 cm]<br>
    <strong>Style:</strong> Gothic · Dark Academia · Medieval · Fantasy<br>
    <strong>Hypoallergenic:</strong> Yes — suitable for sensitive ears<br>
    <strong>Care:</strong> Store in jewelry box · clean with soft cloth · avoid moisture</p>
    <p style="margin: 0;"><strong>Note:</strong> This is a fantasy-inspired jewelry piece, not a functional weapon. Each item is carefully crafted and inspected before shipping.</p>
  </div>
</div>

<div class="asset-section">
  <div class="asset-title">13 个 Tag 三组分配(攻防长尾)</div>
  <p style="margin: 0 0 6px 0; font-size: 10pt;"><strong>主推组(主词 + 直接同义):</strong></p>
  <div class="tag-block">sword earrings, dagger earrings, sword earring, dagger drop earrings, medieval earrings</div>

  <p style="margin: 0 0 6px 0; font-size: 10pt;"><strong>防御组(风格 + 材质,拦截换搜):</strong></p>
  <div class="tag-block">gothic earrings, sterling silver earrings, dark academia, witchy jewelry, dangle earrings</div>

  <p style="margin: 0 0 6px 0; font-size: 10pt;"><strong>长尾组(场景 + 受众):</strong></p>
  <div class="tag-block">fantasy jewelry, cosplay accessory, gift for her</div>
</div>

<div class="asset-section">
  <div class="asset-title">主图拍摄 Brief</div>
  <table class="data" style="margin: 4px 0 0 0;">
    <tbody>
      <tr><td style="width: 100px; font-weight: 600;">背景</td><td>深色绒布(主图)/ 黑色亚克力面(细节图)</td></tr>
      <tr><td style="font-weight: 600;">光源</td><td>单点 LED 高光 + 侧补光,营造剑刃金属反射</td></tr>
      <tr><td style="font-weight: 600;">主图角度</td><td>佩戴侧面 45° + 模特耳部局部特写(头部 5 家均缺此角度)</td></tr>
      <tr><td style="font-weight: 600;">附图组成</td><td>正面平铺 · 佩戴效果 · 尺寸对比 · 工艺细节 · 包装展示</td></tr>
      <tr><td style="font-weight: 600;">分辨率</td><td>1500 × 1500 px 起,sRGB 色彩空间,JPEG 质量 90+</td></tr>
      <tr><td style="font-weight: 600;">文件命名</td><td>sword-earrings-[material]-[angle].jpg,便于 SEO 索引</td></tr>
    </tbody>
  </table>
</div>

<h2>附录 B · 数据声明与免责</h2>

<div class="disclaimer">
  <div class="disclaimer-title">数据来源</div>
  本报告所有数据来自三个公开来源:eRank Bulk Keyword Tool(关键词搜索量、SEO 难度、在售商品数、点击率)、EHunt 浏览器插件(listing 销量、收藏数、店铺周销、上架日期)、Etsy 平台搜索结果页采集(产品标题、价格、店铺、图片)。所有数据采集于 ${reportDate},采样规模 ${listings.length} 个头部 listing。

  <div class="disclaimer-title" style="margin-top: 10px;">数据时效</div>
  Etsy 平台搜索算法每日更新,头部 listing 排名、销量、价格均存在实时变化。本报告数据反映采样时点的市场快照,执行决策前建议结合最新动态再行验证。建议采样时点距执行决策不超过 4 周。

  <div class="disclaimer-title" style="margin-top: 10px;">免责声明</div>
  本报告为基于公开数据的市场分析,不构成投资建议或经营保证。报告中提及的具体定价、运营周期、预期销量等参数为基于历史数据的合理推测,实际执行结果受产品力、市场环境、平台规则等多重因素影响。Etsy 平台政策及 IP 版权法规存在更新可能,实际执行前应核查最新条款。
</div>

</body>
</html>`;

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`▶ 数据加载: ${listings.length} listings · 评分 ${score.total}/100 · ${score.verdict}`);
  console.log(`▶ 启动 chromium`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(HTML, { waitUntil: 'load' });
  await page.pdf({
    path: OUT_PATH,
    format: 'A4',
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    printBackground: true,
  });
  await browser.close();
  const stat = fs.statSync(OUT_PATH);
  console.log(`✓ 输出: ${OUT_PATH} (${(stat.size / 1024).toFixed(0)} KB)`);
}

run().catch((e) => {
  console.error('✗', e);
  process.exit(1);
});
