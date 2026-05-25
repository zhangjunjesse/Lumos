/**
 * X 雷达报告图片样式 — 移动端友好的长图布局主题 + 主入口 buildReportTree。
 *
 * 设计参考：公众号长图 / 小红书图文 / 即刻报告 / Notion 长图。
 *   - 宽度 900px（手机微信图片预览可放大无损读）
 *   - 正文 18px / 行高 1.9（中文舒读）
 *   - h1 44 / h2 28+底部分割线 / h3 22
 *   - 段落 / 列表 / 引文 / 代码块各自布局
 *
 * markdown 解析 + block 渲染 → report-image-blocks.ts
 */

import React from 'react';
import { parseBlocks, estimateBlockHeight, renderBlock, renderHeader, renderFooter } from './report-image-blocks';

export type ReportStyle = 'minimal' | 'business' | 'magazine' | 'dark';

interface BuildInput {
  title: string;
  subtitle?: string;
  metaLines?: string[];
  markdown: string;
  width: number;
  style: ReportStyle;
}

interface BuildOutput {
  tree: React.ReactElement;
  estimatedHeight: number;
}

export interface Theme {
  bg: string; fg: string; muted: string; accent: string; accentSoft: string;
  h1Color: string; h2Color: string; h3Color: string;
  cardBg: string; codeBg: string; codeText: string;
  divider: string; brandLabel: string;
  fontFamily: string;
}

const THEMES: Record<ReportStyle, Theme> = {
  minimal: {
    bg: '#ffffff', fg: '#171717', muted: '#737373',
    accent: '#2563eb', accentSoft: '#dbeafe',
    h1Color: '#0a0a0a', h2Color: '#171717', h3Color: '#262626',
    cardBg: '#fafafa', codeBg: '#f4f4f5', codeText: '#18181b',
    divider: '#e5e5e5', brandLabel: '#2563eb',
    fontFamily: 'NotoSansSC',
  },
  business: {
    bg: '#fafaf7', fg: '#1f2937', muted: '#6b7280',
    accent: '#1e40af', accentSoft: '#dbeafe',
    h1Color: '#0f172a', h2Color: '#1e3a8a', h3Color: '#1f2937',
    cardBg: '#ffffff', codeBg: '#f1f5f9', codeText: '#0f172a',
    divider: '#e2e8f0', brandLabel: '#1e40af',
    fontFamily: 'NotoSansSC',
  },
  magazine: {
    bg: '#fdf8f1', fg: '#1c1917', muted: '#78716c',
    accent: '#c2410c', accentSoft: '#fed7aa',
    h1Color: '#7c2d12', h2Color: '#9a3412', h3Color: '#451a03',
    cardBg: '#fffbf2', codeBg: '#fef3c7', codeText: '#451a03',
    divider: '#fde68a', brandLabel: '#c2410c',
    fontFamily: 'NotoSansSC',
  },
  dark: {
    bg: '#0a0a0a', fg: '#e5e5e5', muted: '#a3a3a3',
    accent: '#22d3ee', accentSoft: '#164e63',
    h1Color: '#fafafa', h2Color: '#67e8f9', h3Color: '#fafafa',
    cardBg: '#171717', codeBg: '#171717', codeText: '#a3e635',
    divider: '#262626', brandLabel: '#22d3ee',
    fontFamily: 'NotoSansSC',
  },
};

export function buildReportTree(input: BuildInput): BuildOutput {
  const theme = THEMES[input.style];
  const blocks = parseBlocks(input.markdown);
  // 微信图片预览默认缩到屏宽 ~400px，900px 宽 → 缩 0.44x。
  // 要让缩放后字号 ≈ 16-18px 手机舒读，原图 base 至少 36-40px。这里取 40。
  const padX = 96;
  const innerWidth = input.width - padX * 2;
  const charsPerLine = Math.floor(innerWidth / 44); // 40px 字 + 间距 ≈ 44
  const contentHeight = blocks.reduce((acc, b) => acc + estimateBlockHeight(b, charsPerLine), 0);
  const headerHeight = 520 + (input.metaLines ?? []).length * 56;
  const footerHeight = 160;
  const estimatedHeight = headerHeight + contentHeight + footerHeight + 160;

  const tree = React.createElement('div', {
    style: {
      display: 'flex', flexDirection: 'column', width: input.width, minHeight: estimatedHeight,
      backgroundColor: theme.bg, color: theme.fg,
      fontFamily: theme.fontFamily, fontSize: 40, lineHeight: 1.85,
      padding: padX, paddingTop: 96, paddingBottom: 96, boxSizing: 'border-box',
    },
  }, [
    renderHeader(input, theme),
    ...blocks.map((b, i) => renderBlock(b, theme, i, blocks)),
    renderFooter(theme),
  ]);

  return { tree, estimatedHeight };
}
