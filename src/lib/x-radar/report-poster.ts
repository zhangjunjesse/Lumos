/**
 * X 雷达海报渲染器（bento 布局主入口）。
 *
 * Satori（JSX → SVG）+ @resvg/resvg-js（SVG → PNG）。
 * 设计参考：Bento Grid（Apple/Notion/Datadog dashboard）。Satori 只支持 flex，
 * 用 flexDirection: 'row/column' + 不等比 flex 模拟 bento。
 *
 * 各 block 渲染函数（hook / kpi / insight / quotes / actions / footer）→ report-poster-blocks.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

import type { ReportStyle } from './report-image-styles';
import {
  renderBrandStrip, renderTitle, renderHookCard, renderKpiGrid,
  renderInsightSection, renderQuotesSection, renderActionsSection, renderFooter,
  type PosterTheme,
} from './report-poster-blocks';

export interface ReportPosterInput {
  hook: string;
  title: string;
  subtitle?: string;
  metaLines?: string[];
  kpis: { value: string; label: string }[];
  insight: string;
  quotes?: { text: string; author: string; url?: string }[];
  actions?: string[];
  style?: ReportStyle;
  width?: number;
}

let cachedFont: Buffer | null = null;
function loadFont(): Buffer {
  if (cachedFont) return cachedFont;
  const candidates: string[] = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'fonts/NotoSansCJKsc-Regular.otf'));
  const root = findProjectRoot(__dirname);
  if (root) candidates.push(path.join(root, 'resources/fonts/NotoSansCJKsc-Regular.otf'));
  candidates.push(path.join(process.cwd(), 'resources/fonts/NotoSansCJKsc-Regular.otf'));
  for (const p of candidates) {
    if (fs.existsSync(p)) { cachedFont = fs.readFileSync(p); return cachedFont; }
  }
  throw new Error(`找不到字体（候选：${candidates.join(' / ')}）`);
}

function findProjectRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export async function renderReportPoster(input: ReportPosterInput): Promise<Buffer> {
  const width = input.width ?? 1080;
  const style = input.style ?? 'business';
  const theme = THEMES[style];
  const padX = 80;
  const tree = buildPosterTree(input, theme, padX);
  const estimatedHeight = estimatePosterHeight(input, padX, width);
  const font = loadFont();
  const svg = await satori(tree, {
    width, height: estimatedHeight,
    fonts: [
      { name: 'NotoSansSC', data: font, weight: 400, style: 'normal' },
      { name: 'NotoSansSC', data: font, weight: 700, style: 'normal' },
      { name: 'NotoSansSC', data: font, weight: 800, style: 'normal' },
    ],
  });
  const resvg = new Resvg(svg, { font: { loadSystemFonts: false }, background: 'transparent' });
  return Buffer.from(resvg.render().asPng());
}

const THEMES: Record<ReportStyle, PosterTheme> = {
  business: {
    bg: '#f5f4ef', bgAccent: '#e8e4d8',
    fg: '#1a202c', muted: '#64748b',
    accent: '#1e40af', accentBg: '#dbeafe', accentFg: '#1e3a8a',
    divider: '#d6d3c7', card: '#ffffff', cardBorder: '#e2dfd2',
    h1: '#0f172a', quoteBar: '#1e40af',
  },
  minimal: {
    bg: '#ffffff', bgAccent: '#fafafa',
    fg: '#0a0a0a', muted: '#737373',
    accent: '#2563eb', accentBg: '#dbeafe', accentFg: '#1e40af',
    divider: '#e5e5e5', card: '#fafafa', cardBorder: '#e5e5e5',
    h1: '#0a0a0a', quoteBar: '#2563eb',
    // minimal 主题 hook 走浅底深字（克制）
    hookBg: '#fafafa', hookFg: '#0a0a0a', hookLabelFg: '#2563eb', hookSeqFg: '#a3a3a3',
  },
  magazine: {
    bg: '#fdf6e8', bgAccent: '#f6ecd4',
    fg: '#1c1917', muted: '#78716c',
    accent: '#c2410c', accentBg: '#fed7aa', accentFg: '#7c2d12',
    divider: '#e7dcbe', card: '#fffaee', cardBorder: '#ecdfb8',
    h1: '#7c2d12', quoteBar: '#c2410c',
  },
  dark: {
    bg: '#0a0a0a', bgAccent: '#141414',
    fg: '#e5e5e5', muted: '#a3a3a3',
    accent: '#22d3ee', accentBg: '#164e63', accentFg: '#67e8f9',
    divider: '#262626', card: '#171717', cardBorder: '#262626',
    h1: '#fafafa', quoteBar: '#22d3ee',
  },
};

function buildPosterTree(input: ReportPosterInput, theme: PosterTheme, padX: number): React.ReactElement {
  const w = input.width ?? 1080;
  return React.createElement('div', {
    style: {
      display: 'flex', flexDirection: 'column', width: w,
      backgroundColor: theme.bg, color: theme.fg,
      fontFamily: 'NotoSansSC', fontSize: 36, lineHeight: 1.85,
      padding: padX, paddingTop: 80, paddingBottom: 80, boxSizing: 'border-box',
    },
  }, [
    renderBrandStrip(theme),
    renderTitle(input.title, input.subtitle, theme),
    renderHookCard(input.hook, theme),
    renderKpiGrid(input.kpis, theme),
    renderInsightSection(input.insight, theme),
    (input.quotes && input.quotes.length > 0) ? renderQuotesSection(input.quotes, theme) : null,
    (input.actions && input.actions.length > 0) ? renderActionsSection(input.actions, theme) : null,
    renderFooter(theme),
  ].filter(Boolean));
}

function estimatePosterHeight(input: ReportPosterInput, padX: number, width: number): number {
  const innerWidth = width - padX * 2;
  const charsPerLine = Math.floor(innerWidth / 38);
  let h = 100 + 100 + 240; // padding + brand + title 大间距
  if (input.subtitle) h += 80;
  // hook 卡片
  const hookLines = Math.ceil(input.hook.length / Math.floor(innerWidth / 56));
  h += 60 + hookLines * 100 + 60;
  // KPI 2 排
  const kpiRows = Math.ceil(input.kpis.length / 2);
  h += kpiRows * 240 + 72;
  // insight
  const insightLines = input.insight.split('\n').reduce((acc, line) => {
    const len = line.trim().length || 1;
    return acc + Math.ceil(len / charsPerLine);
  }, 0);
  h += 120 + insightLines * 68 + 100;
  // quotes
  if (input.quotes && input.quotes.length > 0) {
    h += 120 + input.quotes.reduce((acc, q) => acc + Math.ceil(q.text.length / charsPerLine) * 60 + 100, 0);
  }
  // actions
  if (input.actions && input.actions.length > 0) {
    h += 120 + input.actions.length * 100 + 60;
  }
  h += 120; // footer
  return h;
}
