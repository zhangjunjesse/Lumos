// Prompt composer for Etsy Forge
// 组合：推送 prompt（方向 + 趋势 + 审美） + 6 个二创 prompt 模板
// 全部 prompt 英文 + 强制原创约束 + Etsy POD 友好。
// 不暴露 prompt 给用户。

import { ORIGINAL_DESIGN_GUARDRAILS, type PushSlot, type RemixAction, type TasteProfile } from './types';

export interface PushPromptInput {
  slot: PushSlot;
  taste: TasteProfile;
}

export function composePushPrompt(input: PushPromptInput): string {
  const { slot, taste } = input;
  const palette = slot.palette.length > 0 ? slot.palette.join(', ') : 'designer-friendly modern palette';
  const likedKeywords = pickTopTasteSignals(taste);

  const lines = [
    'You are an original design generator for Etsy Print-on-Demand products.',
    '',
    `Theme direction: ${slot.theme}`,
    `Style: ${slot.style}`,
    `Color palette: ${palette}`,
    `Composition: ${slot.composition}`,
    `Format: ${slot.format}`,
    '',
  ];

  if (likedKeywords.length > 0) {
    lines.push(`User taste signals (previously liked): ${likedKeywords.join(', ')}`);
    lines.push('');
  }

  lines.push('Constraints:');
  for (const g of ORIGINAL_DESIGN_GUARDRAILS) lines.push(`- ${g}`);

  return lines.join('\n');
}

function pickTopTasteSignals(taste: TasteProfile): string[] {
  const out: string[] = [];
  for (const t of taste.liked_themes.slice(0, 3)) out.push(t.theme);
  for (const s of taste.liked_styles.slice(0, 2)) out.push(s.style);
  return out;
}

// ============ Remix Prompts (6 preset actions) ============

export interface RemixPromptInput {
  action: RemixAction;
  originalTheme?: string;
  originalStyle?: string;
  originalPalette?: string[];
  // 注：resize / removebg 不调用 generation，应该在 caller 处分流走图片处理。
}

export interface RemixPromptResult {
  prompt: string;
  variantCount: number;
  needsReferenceImage: boolean;
}

export function composeRemixPrompt(input: RemixPromptInput): RemixPromptResult {
  const { action } = input;

  switch (action) {
    case 'recolor':
      return {
        prompt: buildRecolorPrompt(input.originalPalette),
        variantCount: 4,
        needsReferenceImage: true,
      };
    case 'restyle':
      return {
        prompt: buildRestylePrompt(),
        variantCount: 4,
        needsReferenceImage: true,
      };
    case 'resubject':
      return {
        prompt: buildResubjectPrompt(input.originalTheme),
        variantCount: 4,
        needsReferenceImage: true,
      };
    case 'series':
      return {
        prompt: buildSeriesPrompt(),
        variantCount: 4,
        needsReferenceImage: true,
      };
    case 'resize':
    case 'removebg':
      throw new Error(
        `composeRemixPrompt: action "${action}" 不走 generation — 调用方应分流到图片处理（crop/resize/rembg）。`,
      );
  }
}

function buildRecolorPrompt(originalPalette: string[] | undefined): string {
  const altPalettes = generateAlternatePalettes(originalPalette);
  const lines = [
    'Same composition and subject as Image 1.',
    'Generate 4 variants with these distinct color palettes:',
    ...altPalettes.map((p, i) => `Variant ${i + 1}: palette ${p.join(', ')}`),
    '',
    'Constraints:',
    ...ORIGINAL_DESIGN_GUARDRAILS.map((g) => `- ${g}`),
  ];
  return lines.join('\n');
}

function buildRestylePrompt(): string {
  const lines = [
    'Same subject as Image 1.',
    'Generate 4 variants in these distinct visual styles:',
    'Variant 1: vintage / retro woodcut',
    'Variant 2: minimalist line art',
    'Variant 3: hand-drawn watercolor',
    'Variant 4: bold flat illustration',
    '',
    'Constraints:',
    ...ORIGINAL_DESIGN_GUARDRAILS.map((g) => `- ${g}`),
  ];
  return lines.join('\n');
}

function buildResubjectPrompt(originalTheme: string | undefined): string {
  const alternatives = suggestSubjectAlternatives(originalTheme);
  const lines = [
    'Same visual style, composition, and palette as Image 1.',
    'Replace the main subject. Generate 4 variants:',
    ...alternatives.map((a, i) => `Variant ${i + 1}: ${a}`),
    '',
    'Constraints:',
    ...ORIGINAL_DESIGN_GUARDRAILS.map((g) => `- ${g}`),
  ];
  return lines.join('\n');
}

function buildSeriesPrompt(): string {
  const lines = [
    'Same composition and subject as Image 1.',
    'Generate 4 series extensions:',
    'Variant 1: holiday version (Christmas or Halloween, choose what fits subject)',
    'Variant 2: seasonal version (summer or winter)',
    'Variant 3: special occasion (birthday / anniversary)',
    'Variant 4: alternate scene or setting',
    '',
    'Constraints:',
    ...ORIGINAL_DESIGN_GUARDRAILS.map((g) => `- ${g}`),
  ];
  return lines.join('\n');
}

// 颜色变体：保持主色一个，换三种语义距离大的配色
function generateAlternatePalettes(_seed: string[] | undefined): string[][] {
  return [
    ['#D97757', '#F4A261', '#E9C46A', '#264653'], // warm earth
    ['#1D3557', '#457B9D', '#A8DADC', '#F1FAEE'], // cool blue
    ['#000000', '#FFFFFF', '#E63946', '#000000'], // high contrast
    ['#9E9E9E', '#BDBDBD', '#E0E0E0', '#F5F5F5'], // muted neutral
  ];
}

// 简单 subject 替换；更智能的版本可以让 LLM 基于审美档案推荐
function suggestSubjectAlternatives(theme: string | undefined): string[] {
  const lower = (theme ?? '').toLowerCase();
  if (lower.includes('dog')) return ['cat', 'fox', 'wolf', 'rabbit'];
  if (lower.includes('cat')) return ['dog', 'fox', 'owl', 'hedgehog'];
  if (lower.includes('flower')) return ['leaf', 'mushroom', 'wildflower bouquet', 'succulent'];
  if (lower.includes('mountain')) return ['ocean wave', 'forest', 'desert', 'lake'];
  return ['cat', 'fox', 'owl', 'bear'];
}
