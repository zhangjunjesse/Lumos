// ⑥ PDF 报告生成 — Pinterest 选品研究报告 V2
//
// 结构:封面 → 总览(按综合分)→ 每词单页(指标 + 大 sparkline + Etsy listing 网格 + AI 解读)→ 水印
// 输出:~/.lumos/reports/PINTEREST_选品分析报告YYYY-MM_<runId6>.pdf

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chromium, type Browser } from 'playwright';

import { startAdsPowerForContext } from '@/lib/browser-runtime/adspower-cdp';
import { getDb } from '../db/connection';
import { getRun } from './runs';

export interface GenerateReportOptions {
  runId: string;
  browserContextId?: string;
  appendLog: (msg: string, level?: 'info' | 'warn' | 'error') => void;
  isAborted: () => boolean;
}

export interface GenerateReportResult {
  filePath: string;
  termCount: number;
  sizeBytes: number;
}

interface EtsyListing {
  rank: number;
  title: string;
  imgUrl: string;
  price: string;
  shop: string;
  href: string;
  sales: number | null;
  salesWindow: number | null;
  favorites: number | null;
  listedDate: string;
}

interface EtsyMarket {
  totalResults: number | null;
  totalResultsText: string;
  priceMin: number | null;
  priceMedian: number | null;
  priceMax: number | null;
}

interface ReportRowData {
  term: string;
  preset: string;
  wow: number | null;
  mom: number | null;
  yoy: number | null;
  normalizedCount: number | null;
  seasonalityScore: number | null;
  counts: Array<{ date: string; normalizedCount: number }>;
  niche: string;
  llmCategory: string;
  audience: string;
  creativeAngles: string[];
  risks: string[];
  score: number;
  rationale: string;
  listings: EtsyListing[];
  market: EtsyMarket | null;
}

function loadReportRows(runId: string): ReportRowData[] {
  const db = getDb();
  // trending 主键 + metrics counts + analysis
  const rows = db.prepare(`
    SELECT t.term, t.preset,
           t.wow_change AS t_wow, t.mom_change AS t_mom, t.yoy_change AS t_yoy,
           t.normalized_count, t.seasonality_score,
           m.wow_change AS m_wow, m.mom_change AS m_mom, m.yoy_change AS m_yoy, m.counts_json,
           a.niche, a.category as llm_category, a.audience,
           a.creative_angles_json, a.risks_json, a.score, a.rationale
      FROM pinterest_trending t
      LEFT JOIN pinterest_metrics m ON m.run_id = t.run_id AND m.term = t.term
      LEFT JOIN pinterest_analysis a ON a.run_id = t.run_id AND a.term = t.term
     WHERE t.run_id = ?
     ORDER BY a.score DESC NULLS LAST, t.rank ASC NULLS LAST, t.id ASC
  `).all(runId) as Array<Record<string, unknown>>;

  // 拉所有 listing 一次性,按 term 分组
  const listingRows = db.prepare(
    `SELECT term, rank, title, img_url, price, shop, href, sales, sales_window, favorites, listed_date
       FROM pinterest_etsy_listings WHERE run_id = ? ORDER BY term, rank ASC`,
  ).all(runId) as Array<{
    term: string; rank: number; title: string; img_url: string; price: string; shop: string; href: string;
    sales: number | null; sales_window: number | null; favorites: number | null; listed_date: string;
  }>;
  const listingsByTerm = new Map<string, EtsyListing[]>();
  for (const l of listingRows) {
    const arr = listingsByTerm.get(l.term) ?? [];
    arr.push({
      rank: l.rank, title: l.title, imgUrl: l.img_url, price: l.price, shop: l.shop, href: l.href,
      sales: l.sales, salesWindow: l.sales_window, favorites: l.favorites, listedDate: l.listed_date,
    });
    listingsByTerm.set(l.term, arr);
  }

  // 拉市场切片
  const marketRows = db.prepare(
    `SELECT term, total_results, total_results_text, price_min, price_median, price_max
       FROM pinterest_etsy_market WHERE run_id = ?`,
  ).all(runId) as Array<{
    term: string; total_results: number | null; total_results_text: string;
    price_min: number | null; price_median: number | null; price_max: number | null;
  }>;
  const marketByTerm = new Map<string, EtsyMarket>();
  for (const m of marketRows) {
    marketByTerm.set(m.term, {
      totalResults: m.total_results,
      totalResultsText: m.total_results_text,
      priceMin: m.price_min, priceMedian: m.price_median, priceMax: m.price_max,
    });
  }

  return rows.map((r) => {
    const term = String(r.term ?? '');
    return {
      term,
      preset: String(r.preset ?? ''),
      wow: (r.t_wow as number | null) ?? (r.m_wow as number | null),
      mom: (r.t_mom as number | null) ?? (r.m_mom as number | null),
      yoy: (r.t_yoy as number | null) ?? (r.m_yoy as number | null),
      normalizedCount: r.normalized_count as number | null,
      seasonalityScore: r.seasonality_score as number | null,
      counts: (() => { try { return JSON.parse(String(r.counts_json ?? '[]')); } catch { return []; } })(),
      niche: String(r.niche ?? ''),
      llmCategory: String(r.llm_category ?? ''),
      audience: String(r.audience ?? ''),
      creativeAngles: (() => { try { return JSON.parse(String(r.creative_angles_json ?? '[]')); } catch { return []; } })(),
      risks: (() => { try { return JSON.parse(String(r.risks_json ?? '[]')); } catch { return []; } })(),
      score: Number(r.score ?? 0),
      rationale: String(r.rationale ?? ''),
      listings: listingsByTerm.get(term) ?? [],
      market: marketByTerm.get(term) ?? null,
    };
  });
}

/** 千分位简写:1500 → "1.5k",1200000 → "1.2M";null → "—" */
function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** EHunt 的上架日期标准化成 YYYY-MM,接受 EHunt 的 MM/DD/YY 和 YYYY/MM/DD 两种 */
function fmtListedMonth(s: string): string {
  if (!s) return '—';
  // 优先匹配 YYYY/MM(4 位年开头)
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  // 兜底:MM/DD/YY(EHunt 格式)→ 假定 YY 是 20YY
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (m) return `20${m[3]}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

function buildSparklineSvg(counts: Array<{ date: string; normalizedCount: number }>, width = 560, height = 90): string {
  if (counts.length === 0) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><text x="20" y="${height / 2}" font-size="12" fill="#999">无 90 天数据</text></svg>`;
  }
  const max = Math.max(...counts.map((c) => c.normalizedCount), 1);
  const pad = 8;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const stepX = innerW / Math.max(1, counts.length - 1);
  const pts = counts.map((c, i) => ({
    x: pad + i * stepX,
    y: pad + innerH - (c.normalizedCount / max) * innerH,
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${pad + innerH} L ${pts[0].x.toFixed(1)} ${pad + innerH} Z`;
  // 网格线 4 横
  const grid = [0.25, 0.5, 0.75].map((f) => {
    const y = (pad + innerH * f).toFixed(1);
    return `<line x1="${pad}" x2="${width - pad}" y1="${y}" y2="${y}" stroke="#eee" stroke-width="0.5" />`;
  }).join('');
  // 起点终点日期
  const firstDate = counts[0].date;
  const lastDate = counts[counts.length - 1].date;
  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${grid}
      <path d="${areaPath}" fill="#1a1a1a" fill-opacity="0.06" />
      <path d="${linePath}" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-linejoin="round" />
      <text x="${pad}" y="${height - 2}" font-size="9" fill="#999">${firstDate}</text>
      <text x="${width - pad}" y="${height - 2}" font-size="9" fill="#999" text-anchor="end">${lastDate}</text>
    </svg>
  `;
}

/** 极简 mini sparkline,只一条线,无网格无文本,适合塞表格单元 */
function buildMiniSparklineSvg(counts: Array<{ normalizedCount: number }>, width = 84, height = 22): string {
  if (counts.length === 0) {
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"></svg>`;
  }
  const max = Math.max(...counts.map((c) => c.normalizedCount), 1);
  const stepX = width / Math.max(1, counts.length - 1);
  const linePath = counts.map((c, i) => {
    const x = i * stepX;
    const y = height - (c.normalizedCount / max) * (height - 2) - 1;
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="${linePath}" fill="none" stroke="#1a1a1a" stroke-width="1" stroke-linejoin="round" />
  </svg>`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function pctColor(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '#999';
  if (n > 0) return '#1e7a3a';
  if (n < 0) return '#9a3030';
  return '#666';
}

function scoreColor(score: number): string {
  if (score >= 75) return '#1e7a3a';
  if (score >= 50) return '#b88600';
  return '#9a3030';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildOverviewRows(rows: ReportRowData[]): string {
  return rows.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="term-cell">${escapeHtml(r.term)}</td>
      <td>${escapeHtml(r.niche || r.llmCategory || '—')}</td>
      <td class="spark-cell">${buildMiniSparklineSvg(r.counts)}</td>
      <td class="num" style="color:${pctColor(r.wow)}">${fmtPct(r.wow)}</td>
      <td class="num" style="color:${pctColor(r.mom)}">${fmtPct(r.mom)}</td>
      <td class="num" style="color:${pctColor(r.yoy)}">${fmtPct(r.yoy)}</td>
      <td class="num" style="color:${scoreColor(r.score)};font-weight:600">${r.score || '—'}</td>
    </tr>
  `).join('');
}

interface CoverStats {
  termCount: number;
  totalListings: number;
  ehuntHits: number;             // listing 里有 EHunt 销量/收藏数据的数量
  totalSales30d: number;
  totalFavorites: number;
  avgScore: number;
  scoreAOver70: number;
  medianPrice: number | null;
  topGrowingTerm: string;
  topGrowingValue: number;
}

function computeCoverStats(rows: ReportRowData[]): CoverStats {
  const termCount = rows.length;
  let totalListings = 0;
  let ehuntHits = 0;
  let totalSales30d = 0;
  let totalFavorites = 0;
  const prices: number[] = [];
  rows.forEach((r) => {
    totalListings += r.listings.length;
    r.listings.forEach((l) => {
      if (l.sales != null || l.favorites != null) ehuntHits++;
      if (l.sales != null) totalSales30d += l.sales;
      if (l.favorites != null) totalFavorites += l.favorites;
    });
    if (r.market?.priceMedian != null) prices.push(r.market.priceMedian);
  });
  const scores = rows.map((r) => r.score).filter((n) => n > 0);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0;
  const scoreAOver70 = scores.filter((s) => s >= 70).length;
  prices.sort((a, b) => a - b);
  const medianPrice = prices.length > 0 ? prices[Math.floor(prices.length / 2)] : null;

  // 涨幅最高:按 MoM 排,失败 fallback WoW,失败 fallback YoY
  let topTerm = '', topVal = -Infinity;
  rows.forEach((r) => {
    const v = r.mom ?? r.wow ?? r.yoy;
    if (v != null && v > topVal) { topVal = v; topTerm = r.term; }
  });
  return {
    termCount, totalListings, ehuntHits, totalSales30d, totalFavorites, avgScore, scoreAOver70,
    medianPrice, topGrowingTerm: topTerm, topGrowingValue: topVal === -Infinity ? 0 : topVal,
  };
}

function buildCoverStatsBlock(stats: CoverStats): string {
  return `
    <div class="cover-stats">
      <div class="stat-item">
        <div class="stat-value">${stats.termCount}</div>
        <div class="stat-label">关键词</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.totalListings}</div>
        <div class="stat-label">Etsy listing</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${fmtNum(stats.totalSales30d)}</div>
        <div class="stat-label">30d 总销量</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${fmtNum(stats.totalFavorites)}</div>
        <div class="stat-label">总收藏</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.avgScore || '—'}<span class="stat-suffix">/100</span></div>
        <div class="stat-label">综合分均值</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.scoreAOver70}<span class="stat-suffix">个</span></div>
        <div class="stat-label">≥70 分</div>
      </div>
      <div class="stat-item">
        <div class="stat-value">${stats.medianPrice != null ? '$' + stats.medianPrice.toFixed(0) : '—'}</div>
        <div class="stat-label">中位价</div>
      </div>
    </div>
    ${stats.topGrowingTerm ? `
    <div class="cover-highlight">
      <span class="hl-label">涨幅榜首</span>
      <span class="hl-term">${escapeHtml(stats.topGrowingTerm)}</span>
      <span class="hl-val">MoM ${stats.topGrowingValue > 0 ? '+' : ''}${stats.topGrowingValue.toFixed(1)}%</span>
    </div>` : ''}
  `;
}

function buildListingsBlock(listings: EtsyListing[]): string {
  if (listings.length === 0) {
    return '<div class="listings-empty">未抓到 Etsy listing(此词可能 Etsy 无对应商品 / 抓取失败)</div>';
  }
  const top = listings.slice(0, 6);
  // 6 件销量小结 — 只有当至少一个 listing 有 EHunt 销量数据才显示
  const salesNums = top.map((l) => l.sales).filter((n): n is number => n != null);
  const favNums = top.map((l) => l.favorites).filter((n): n is number => n != null);
  const listedDates = top.map((l) => l.listedDate).filter(Boolean);
  const hasEhunt = salesNums.length > 0 || favNums.length > 0;
  const sumSales = salesNums.reduce((s, n) => s + n, 0);
  const medianSales = salesNums.length > 0
    ? [...salesNums].sort((a, b) => a - b)[Math.floor(salesNums.length / 2)] : 0;
  const sumFav = favNums.reduce((s, n) => s + n, 0);
  const dateMonths = listedDates.map(fmtListedMonth).filter((s) => s !== '—').sort();
  const oldest = dateMonths[0];
  const newest = dateMonths[dateMonths.length - 1];

  const summary = hasEhunt
    ? `<div class="ehunt-summary">
        <span><b>${top.length} 件销量</b> 30d 共 ${fmtNum(sumSales)} · 中位 ${fmtNum(medianSales)}</span>
        <span>收藏共 ${fmtNum(sumFav)}</span>
        ${oldest && newest ? `<span>上架窗口 ${oldest} → ${newest}</span>` : ''}
      </div>`
    : `<div class="ehunt-summary ehunt-missing">本词 6 个 listing 都未拿到 EHunt 数据(异步注入未完成或本词无覆盖)</div>`;

  return `
    <div class="listings-grid">
      ${top.map((l) => `
        <div class="listing">
          <div class="listing-img-wrap">
            ${l.imgUrl ? `<img src="${escapeHtml(l.imgUrl)}" alt="" loading="eager" />` : '<div class="listing-img-fallback">无图</div>'}
          </div>
          <p class="listing-title" title="${escapeHtml(l.title)}">${escapeHtml(l.title)}</p>
          <p class="listing-price">${escapeHtml(l.price || '—')}</p>
          ${(l.sales != null || l.favorites != null || l.listedDate)
            ? `<p class="listing-ehunt">
                ${l.sales != null ? `<span><em>30d 销</em> ${fmtNum(l.sales)}</span>` : ''}
                ${l.favorites != null ? `<span><em>收藏</em> ${fmtNum(l.favorites)}</span>` : ''}
                ${l.listedDate ? `<span><em>上架</em> ${fmtListedMonth(l.listedDate)}</span>` : ''}
              </p>`
            : ''}
        </div>
      `).join('')}
    </div>
    ${summary}
  `;
}

function buildMarketBlock(market: EtsyMarket | null): string {
  // Etsy 改版后已不在页面公开总结果数,total_results 几乎肯定为 null。
  // market 块只显示能可靠拿到的字段:top 6 价格带。
  if (!market || market.priceMedian == null) {
    return ''; // 没价格数据(罕见 — 几乎所有 listing 都有 price)
  }
  const priceRange = (market.priceMin != null && market.priceMax != null)
    ? `$${market.priceMin.toFixed(0)} – $${market.priceMax.toFixed(0)}`
    : '—';
  const median = market.priceMedian != null ? `$${market.priceMedian.toFixed(0)}` : '—';
  return `
    <div class="market-row">
      <div class="market-cell">
        <div class="card-label">top 6 价格带</div>
        <div class="card-value">${priceRange} <span class="muted">· 中位 ${median}</span></div>
      </div>
    </div>
  `;
}

function buildTermPage(r: ReportRowData, rank: number, watermark: string): string {
  return `
    <section class="term-page">
      <header class="term-header">
        <div class="term-header-left">
          <span class="term-rank">#${rank}</span>
          <h2 class="term-title">${escapeHtml(r.term)}</h2>
          <span class="term-tag">${escapeHtml(r.niche || r.llmCategory || r.preset)}</span>
        </div>
        <div class="term-header-right">
          <span class="score-label">综合分</span>
          <span class="score-value" style="color:${scoreColor(r.score)}">${r.score || '—'}</span>
        </div>
      </header>

      <div class="metric-row">
        <div class="sparkline-card">
          <div class="card-label">近 90 天搜索趋势(归一化)</div>
          ${buildSparklineSvg(r.counts)}
        </div>
        <div class="number-cards">
          <div class="number-card">
            <div class="card-label">WoW 周环比</div>
            <div class="card-value" style="color:${pctColor(r.wow)}">${fmtPct(r.wow)}</div>
          </div>
          <div class="number-card">
            <div class="card-label">MoM 月环比</div>
            <div class="card-value" style="color:${pctColor(r.mom)}">${fmtPct(r.mom)}</div>
          </div>
          <div class="number-card">
            <div class="card-label">YoY 年同比</div>
            <div class="card-value" style="color:${pctColor(r.yoy)}">${fmtPct(r.yoy)}</div>
          </div>
          <div class="number-card">
            <div class="card-label">季节性</div>
            <div class="card-value">${r.seasonalityScore != null ? r.seasonalityScore.toFixed(2) : '—'}</div>
          </div>
        </div>
      </div>

      <h3 class="section-h">Etsy 市场切片</h3>
      ${buildMarketBlock(r.market)}

      <h3 class="section-h">Etsy 上的样子(top ${r.listings.length || 0})</h3>
      ${buildListingsBlock(r.listings)}

      <h3 class="section-h">选品分析</h3>
      <div class="ai-grid">
        <div class="ai-cell">
          <div class="ai-label">目标人群</div>
          <p>${escapeHtml(r.audience || '—')}</p>
        </div>
        <div class="ai-cell">
          <div class="ai-label">创意方向</div>
          ${r.creativeAngles.length > 0
            ? `<ul>${r.creativeAngles.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
            : '<p class="muted">—</p>'}
        </div>
        <div class="ai-cell">
          <div class="ai-label">风险点</div>
          ${r.risks.length > 0
            ? `<ul>${r.risks.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`
            : '<p class="muted">—</p>'}
        </div>
        <div class="ai-cell">
          <div class="ai-label">综合判断</div>
          <p class="rationale">${escapeHtml(r.rationale || '—')}</p>
        </div>
      </div>

      <div class="watermark">${watermark}</div>
    </section>
  `;
}

function buildHtml(runLabel: string, runDate: string, rows: ReportRowData[]): string {
  const reportMonth = runDate.slice(0, 7);
  const wmLine = Array(4).fill('391504704@qq.com').join('&nbsp;&nbsp;&nbsp;&nbsp;');
  const watermark = `${wmLine}<br/>${wmLine}<br/>${wmLine}<br/>${wmLine}`;
  const stats = computeCoverStats(rows);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Pinterest 选品分析报告 ${reportMonth}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    color: #1a1a1a; font-size: 10.5pt; line-height: 1.55; margin: 0;
  }
  h1 { font-size: 30pt; margin: 0 0 12px; letter-spacing: -0.5px; font-weight: 700; }
  h2 { font-size: 18pt; margin: 0; font-weight: 600; }
  h3 { font-size: 10pt; margin: 8px 0 4px; font-weight: 600; color: #1a1a1a;
       border-bottom: 1px solid #1a1a1a; padding-bottom: 2px; }
  p { margin: 4px 0; }
  ul { padding-left: 16px; margin: 4px 0; }
  li { margin: 2px 0; }
  .num { font-variant-numeric: tabular-nums; }
  .muted { color: #999; }

  /* 封面 */
  .cover { page-break-after: always; padding-top: 40mm; position: relative; }
  .cover .meta { color: #666; margin-top: 8mm; font-size: 11pt; }
  .cover .meta span { display: inline-block; margin: 0 8px; }
  .cover .stamp { position: absolute; top: 20mm; right: 0; font-size: 9pt; color: #999;
                  letter-spacing: 2px; text-transform: uppercase; }
  .cover-stats { margin-top: 20mm; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .stat-item { background: #fafafa; border: 1px solid #eee; padding: 12px 14px; }
  .stat-value { font-size: 22pt; font-weight: 700; line-height: 1.1; color: #1a1a1a;
                font-variant-numeric: tabular-nums; }
  .stat-suffix { font-size: 11pt; font-weight: 500; color: #888; margin-left: 4px; }
  .stat-label { font-size: 9pt; color: #888; margin-top: 4px;
                text-transform: uppercase; letter-spacing: 0.5px; }
  .cover-highlight { margin-top: 8mm; padding: 14px 18px; background: #1a1a1a; color: #fff;
                     display: flex; align-items: baseline; gap: 12px; }
  .hl-label { font-size: 9pt; color: #999; text-transform: uppercase; letter-spacing: 1px; }
  .hl-term { font-size: 16pt; font-weight: 600; }
  .hl-val { font-size: 11pt; color: #6fb47e; font-variant-numeric: tabular-nums;
            margin-left: auto; }
  /* 数据来源 — 封面底部,小字,透明披露 */
  .data-source { margin-top: 10mm; padding: 12px 14px; background: #fafafa;
                 border: 1px solid #eee; }
  .ds-title { font-size: 8pt; color: #888; text-transform: uppercase; letter-spacing: 1px;
              margin-bottom: 6px; font-weight: 500; }
  .ds-list { display: flex; flex-direction: column; gap: 3px; font-size: 9pt;
             color: #555; line-height: 1.5; }
  .ds-list b { color: #1a1a1a; font-weight: 600; }
  .ds-list em { color: #b88600; font-style: normal; font-weight: 500; }
  .ds-missing { color: #888; }

  /* 总览 */
  .overview { page-break-after: always; }
  .overview table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 8px; }
  .overview th { background: #f5f5f5; padding: 8px 10px; text-align: left;
                 border-bottom: 1.5px solid #1a1a1a; font-weight: 600; font-size: 9pt;
                 text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
  .overview td { padding: 7px 10px; border-bottom: 1px solid #eee; }
  .overview td.num { text-align: right; }
  .overview th.num { text-align: right; }
  .overview .term-cell { font-weight: 500; }
  .overview .spark-cell { padding: 4px 10px; }
  .overview .spark-cell svg { display: block; }

  /* 每词页 — 严格 1 页(A4),收紧间距 */
  .term-page { page-break-after: always; page-break-inside: avoid; position: relative; }
  .term-header { display: flex; align-items: flex-end; justify-content: space-between;
                 padding-bottom: 5px; border-bottom: 2px solid #1a1a1a; margin-bottom: 8px; }
  .term-header-left { display: flex; align-items: baseline; gap: 10px; flex: 1; min-width: 0; }
  .term-rank { font-size: 13pt; color: #999; font-weight: 600; font-variant-numeric: tabular-nums; }
  .term-title { font-size: 16pt; font-weight: 600; word-break: break-word; }
  .term-tag { background: #1a1a1a; color: #fff; padding: 2px 7px; font-size: 8pt;
              border-radius: 2px; font-weight: 500; }
  .term-header-right { display: flex; align-items: baseline; gap: 6px; flex-shrink: 0; }
  .score-label { font-size: 8pt; color: #999; text-transform: uppercase; letter-spacing: 1px; }
  .score-value { font-size: 20pt; font-weight: 700; font-variant-numeric: tabular-nums;
                 line-height: 1; }

  /* 指标行 */
  .metric-row { display: flex; gap: 8px; margin-bottom: 8px; }
  .sparkline-card { flex: 1; background: #fafafa; border: 1px solid #eee; padding: 6px 10px; }
  .number-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; width: 200px; flex-shrink: 0; }
  .number-card { background: #fafafa; border: 1px solid #eee; padding: 5px 8px; }
  .card-label { font-size: 7.5pt; color: #666; text-transform: uppercase;
                letter-spacing: 0.4px; margin-bottom: 1px; font-weight: 500; }
  .card-value { font-size: 12pt; font-weight: 600; font-variant-numeric: tabular-nums;
                line-height: 1.2; }

  /* Etsy 市场切片 */
  .market-row { display: grid; grid-template-columns: 1fr; gap: 4px; margin-bottom: 6px; }
  .market-cell { background: #f7f3ed; border: 1px solid #ebe0ce; padding: 5px 10px; }
  .market-cell .card-value { font-size: 11pt; }

  /* Etsy listing 网格 3×2 — 紧凑 */
  .listings-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .listing { font-size: 8pt; }
  .listing-img-wrap { width: 100%; aspect-ratio: 1 / 1; background: #f5f5f5;
                      overflow: hidden; border: 1px solid #eee; margin-bottom: 2px;
                      display: flex; align-items: center; justify-content: center; }
  .listing-img-wrap img { width: 100%; height: 100%; object-fit: cover; }
  .listing-img-fallback { color: #aaa; font-size: 9pt; }
  .listing-title { font-size: 8.5pt; line-height: 1.3; height: 2.6em; overflow: hidden;
                   margin: 2px 0 2px; color: #333;
                   display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .listing-price { font-size: 8.5pt; color: #333; margin: 0; font-weight: 500;
                   font-variant-numeric: tabular-nums; }
  .listing-ehunt { font-size: 8pt; color: #555; margin: 2px 0 0; font-variant-numeric: tabular-nums;
                   display: flex; gap: 6px; flex-wrap: wrap; }
  .listing-ehunt span { white-space: nowrap; }
  .listing-ehunt em { font-style: normal; color: #999; font-size: 7.5pt; margin-right: 2px;
                      letter-spacing: 0.2px; }
  .listings-empty { padding: 16px; background: #fafafa; border: 1px dashed #ccc;
                    color: #888; text-align: center; font-size: 9.5pt; }
  .ehunt-summary { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 4px;
                   padding: 5px 10px; background: #f3f6f3; border-left: 3px solid #1e7a3a;
                   font-size: 8.5pt; font-variant-numeric: tabular-nums; color: #333; }
  .ehunt-summary b { color: #1e7a3a; }
  .ehunt-missing { background: #faf6e8; border-left-color: #b88600; color: #66552a; }

  /* AI 解读 2×2 grid — 紧凑 */
  .ai-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .ai-cell { background: #fafafa; border: 1px solid #eee; padding: 6px 10px; }
  .ai-label { font-size: 7.5pt; color: #666; text-transform: uppercase;
              letter-spacing: 0.4px; font-weight: 500; margin-bottom: 2px; }
  .ai-cell p { font-size: 9pt; margin: 0; line-height: 1.4; }
  .ai-cell .rationale { font-size: 8.5pt; line-height: 1.45; color: #444; }
  .ai-cell ul { padding-left: 14px; margin: 2px 0 0; }
  .ai-cell li { font-size: 8.5pt; margin: 1px 0; line-height: 1.35; }

  /* 水印 */
  .watermark { position: absolute; inset: 0; pointer-events: none; opacity: 0.05;
               transform: rotate(-25deg); font-size: 22pt; color: #999;
               letter-spacing: 8px; display: flex; align-items: center;
               justify-content: center; z-index: 9999; line-height: 2; }
  .cover .watermark { opacity: 0.04; }
</style>
</head>
<body>
  <section class="cover">
    <div class="stamp">Lumos · Pinterest 选品研究</div>
    <h1>Pinterest 选品<br/>分析报告</h1>
    <div class="meta">
      <span>${escapeHtml(runLabel)}</span><span>·</span><span>${escapeHtml(runDate)}</span>
    </div>
    ${buildCoverStatsBlock(stats)}
    <div class="data-source">
      <div class="ds-title">数据来源</div>
      <div class="ds-list">
        <span><b>Pinterest Trends</b> — trending 关键词 / 90 天搜索曲线 / WoW · MoM · YoY 增长率 / 季节性得分</span>
        <span><b>Etsy 网站</b> — 每个关键词 top 6 listing 的图、价格、店铺;top 6 价格中位与区间</span>
        <span><b>EHunt 浏览器扩展</b> — listing 30 天销量 · 累计销量 · 收藏数 · 上架日期(本轮 ${stats.ehuntHits}/${stats.totalListings} 个 listing 命中)</span>
        <span><b>LLM 解读</b> — 目标人群 / 创意方向 / 风险点 / 综合分(基于上述数据)</span>
      </div>
    </div>
    <div class="watermark">${watermark}</div>
  </section>

  <section class="overview">
    <h2>总览 · 按综合分排序</h2>
    <table>
      <thead><tr>
        <th class="num">#</th><th>关键词</th><th>Niche</th><th>90d 趋势</th>
        <th class="num">WoW</th><th class="num">MoM</th><th class="num">YoY</th><th class="num">分数</th>
      </tr></thead>
      <tbody>${buildOverviewRows(rows)}</tbody>
    </table>
    <div class="watermark">${watermark}</div>
  </section>

  ${rows.map((r, i) => buildTermPage(r, i + 1, watermark)).join('')}
</body></html>`;
}

function getReportDir(): string {
  const base = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
  return path.join(base, 'reports');
}

async function renderPdfWithLaunchedChromium(html: string, filePath: string): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.pdf({ path: filePath, format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

async function renderPdfViaCdp(html: string, filePath: string, browserContextId: string | undefined): Promise<void> {
  const handle = await startAdsPowerForContext(browserContextId);
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(handle.wsEndpoint);
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('AdsPower 无 context');
    const page = await ctx.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle', timeout: 120_000 });
      await page.pdf({ path: filePath, format: 'A4', printBackground: true, preferCSSPageSize: true });
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export async function generateReport(opts: GenerateReportOptions): Promise<GenerateReportResult> {
  const { runId, browserContextId, appendLog: log, isAborted } = opts;
  const run = getRun(runId);
  if (!run) throw new Error('run not found');

  const rows = loadReportRows(runId);
  if (rows.length === 0) throw new Error('没有任何 trending 词条,无法生成报告');
  const analyzedCount = rows.filter((r) => r.score > 0 || r.rationale).length;
  if (analyzedCount === 0) {
    throw new Error('没有任何 AI 解读结果(④ 未跑或全失败),不出空壳报告。请先把 ④ 跑通。');
  }
  const totalListings = rows.reduce((s, r) => s + r.listings.length, 0);
  log(`▶ 准备生成报告:${rows.length} 个词 · ${analyzedCount} 已解读 · ${totalListings} Etsy listing`);

  const reportDir = getReportDir();
  fs.mkdirSync(reportDir, { recursive: true });
  const month = new Date(run.startedAt).toISOString().slice(0, 7);
  // 加生成时间戳,避免同一 run 多次重跑时 PDF reader 缓存旧版
  const now = new Date();
  const stamp = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}`;
  const fileName = `PINTEREST_选品分析报告${month}_${runId.slice(-6)}_${stamp}.pdf`;
  const filePath = path.join(reportDir, fileName);

  const html = buildHtml(run.label, new Date(run.startedAt).toISOString().slice(0, 10), rows);
  if (isAborted()) throw new Error('aborted');

  try {
    log(`▶ chromium.launch headless 渲染 PDF(含 Etsy 图,可能 30-90s)`);
    await renderPdfWithLaunchedChromium(html, filePath);
  } catch (launchErr) {
    const msg = launchErr instanceof Error ? launchErr.message : String(launchErr);
    log(`  chromium.launch 失败 (${msg.slice(0, 100)}) — fallback CDP`, 'warn');
    await renderPdfViaCdp(html, filePath, browserContextId);
  }

  const stat = fs.statSync(filePath);
  const db = getDb();
  db.prepare(`
    INSERT INTO pinterest_reports (run_id, file_path, term_count, size_bytes, generated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(runId, filePath, rows.length, stat.size, Date.now());

  log(`✓ 报告已生成:${filePath}`);
  return { filePath, termCount: rows.length, sizeBytes: stat.size };
}
