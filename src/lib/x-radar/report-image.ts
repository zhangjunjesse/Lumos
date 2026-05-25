/**
 * X 雷达报告 → 长 PNG 图片。
 *
 * 走 satori（JSX → SVG）+ @resvg/resvg-js（SVG → PNG）。中文字体用 Noto Sans CJK SC
 * 嵌入（resources/fonts/NotoSansCJKsc-Regular.otf）。
 *
 * 微信发图片附件（image/png），用户在手机/电脑微信里直接预览。
 */

import fs from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

import { buildReportTree, type ReportStyle } from './report-image-styles';

export type { ReportStyle };

export interface ReportImageInput {
  title: string;
  subtitle?: string;
  metaLines?: string[];
  markdown: string;
  style?: ReportStyle;
  width?: number; // 默认 800
}

let cachedFont: Buffer | null = null;

function loadFont(): Buffer {
  if (cachedFont) return cachedFont;
  // 多 fallback：
  // 1. Electron prod：process.resourcesPath/fonts/...
  // 2. Lumos 项目根（向上找 package.json）：<root>/resources/fonts/...
  // 3. dev cwd 兜底
  const FONT_REL = 'resources/fonts/NotoSansCJKsc-Regular.otf';
  const candidates: string[] = [];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, 'fonts/NotoSansCJKsc-Regular.otf'));
  const projectRoot = findProjectRoot(__dirname);
  if (projectRoot) candidates.push(path.join(projectRoot, FONT_REL));
  candidates.push(path.join(process.cwd(), FONT_REL));
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      cachedFont = fs.readFileSync(p);
      return cachedFont;
    }
  }
  throw new Error(`找不到字体 NotoSansCJKsc-Regular.otf（候选路径：${candidates.join(' / ')}）`);
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

export async function renderReportImage(input: ReportImageInput): Promise<Buffer> {
  const width = input.width ?? 900;
  const style = input.style ?? 'business';
  const { tree, estimatedHeight } = buildReportTree({ ...input, width, style });
  const font = loadFont();
  const svg = await satori(tree, {
    width,
    height: estimatedHeight,
    fonts: [
      { name: 'NotoSansSC', data: font, weight: 400, style: 'normal' },
      { name: 'NotoSansSC', data: font, weight: 700, style: 'normal' },
    ],
  });
  // resvg 把 SVG 渲染成 PNG。loadSystemFonts: false 避免依赖系统字体
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: false },
    background: 'transparent',
  });
  return Buffer.from(resvg.render().asPng());
}
