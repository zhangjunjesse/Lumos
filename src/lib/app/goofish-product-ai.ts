import fs from 'node:fs';

import { generateImages } from '@/lib/image';
import { getProviderModelOptions } from '@/lib/model-metadata';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateTextFromProvider } from '@/lib/text-generator';

import { isGoofishNativeApp } from './goofish-app-sync';
import type { AppManifest } from './manifest/types';

export interface GenerateProductContentInput {
  manifest: AppManifest;
  kind: 'title' | 'description';
  title: string;
  summary: string;
  category: string;
  tags: string[];
  existingDescription?: string;
}

export interface GenerateProductContentResult {
  ok: boolean;
  titles?: string[];
  description?: string;
  message?: string;
  providerId?: string;
  model?: string;
}

export async function generateProductContent(
  input: GenerateProductContentInput,
): Promise<GenerateProductContentResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    return { ok: false, message: '当前应用不是闲鱼类应用，不能调用商品内容生成。' };
  }
  const provider = resolveProviderForCapability({ moduleKey: 'chat', capability: 'text-gen' });
  if (!provider) {
    return { ok: false, message: '未配置可用的文本生成服务商。' };
  }
  const model = getProviderModelOptions(provider)[0]?.value?.trim() || '';
  if (!model) {
    return { ok: false, message: `服务商"${provider.name}"没有可用模型。` };
  }

  const prompts = input.kind === 'title'
    ? buildTitlePrompts(input)
    : buildDescriptionPrompts(input);

  try {
    const text = await generateTextFromProvider({
      providerId: provider.id,
      model,
      system: prompts.system,
      prompt: prompts.prompt,
      maxTokens: input.kind === 'title' ? 400 : 700,
      temperature: 0.6,
      abortSignal: AbortSignal.timeout(120_000),
    });
    if (input.kind === 'title') {
      const titles = parseTitles(text);
      if (titles.length === 0) {
        return { ok: false, message: 'AI 没返回可用的候选标题。' };
      }
      return { ok: true, titles, providerId: provider.id, model };
    }
    const description = cleanDescription(text);
    if (!description) {
      return { ok: false, message: 'AI 没返回可用的描述文本。' };
    }
    return { ok: true, description, providerId: provider.id, model };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'AI 生成失败' };
  }
}

export interface GenerateProductPreviewInput {
  manifest: AppManifest;
  title: string;
  summary: string;
  category: string;
}

export interface GenerateProductPreviewResult {
  ok: boolean;
  imagePath?: string;
  message?: string;
}

export async function generateProductPreview(
  input: GenerateProductPreviewInput,
): Promise<GenerateProductPreviewResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    return { ok: false, message: '当前应用不是闲鱼类应用，不能调用 banner 生成。' };
  }
  if (!input.title.trim()) {
    return { ok: false, message: '请先填好商品标题再生成 banner。' };
  }

  const prompt = buildBannerPrompt(input);
  try {
    const result = await generateImages({ prompt, aspectRatio: '1:1', imageSize: '2K' });
    if (!result.images.length) {
      return { ok: false, message: '图片生成未返回结果。' };
    }
    const localPath = result.images[0].localPath;
    const buffer = fs.readFileSync(localPath);
    const mime = result.images[0].mimeType || 'image/png';
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    return { ok: true, imagePath: dataUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '图片生成失败';
    return { ok: false, message: msg };
  }
}

function buildTitlePrompts(input: GenerateProductContentInput): { system: string; prompt: string } {
  const system = [
    '你是一位闲鱼电商卖家文案专家，擅长写让买家一搜就出来的长尾关键词标题。',
    '输出 5 个候选标题，每个标题独立一行，前面加序号（1. 2. 3. 4. 5.）。',
    '禁止出现"PDF""电子版""资料""破解"等可能触发闲鱼违禁词过滤的词语，可以替换为"册子""参考""学习用""合集"。',
    '每个标题 20-30 个汉字，包含 3-5 个长尾关键词，让搜索能精准命中。',
    '不要输出解释、markdown 块、引号包裹。',
  ].join('\n');
  const prompt = [
    '请为以下商品生成 5 个候选商品标题。',
    `当前标题草稿: ${input.title || '（无）'}`,
    `简介: ${input.summary || '（无）'}`,
    `分类: ${input.category || '（未分类）'}`,
    `标签: ${input.tags.join('、') || '（无）'}`,
    '输出格式: 5 行，每行一个候选标题，序号开头。',
  ].join('\n');
  return { system, prompt };
}

function buildDescriptionPrompts(input: GenerateProductContentInput): { system: string; prompt: string } {
  const system = [
    '你是一位闲鱼电商卖家文案专家，擅长写让买家放心下单的商品描述。',
    '输出 80-150 字商品描述：包含「内容亮点 + 适用人群 + 交付方式」三个层次。',
    '禁止承诺平台外交易、不实宣传，禁止出现"PDF""破解""盗版"等违禁词，替换成"册子""参考"。',
    '不要输出引号、markdown、解释。直接输出可以贴到闲鱼商品描述框的纯文本。',
  ].join('\n');
  const prompt = [
    '请生成商品描述。',
    `标题: ${input.title || '（无）'}`,
    `当前简介: ${input.existingDescription || input.summary || '（无）'}`,
    `分类: ${input.category || '（未分类）'}`,
    `标签: ${input.tags.join('、') || '（无）'}`,
  ].join('\n');
  return { system, prompt };
}

function buildBannerPrompt(input: GenerateProductPreviewInput): string {
  const category = input.category || '行业研究';
  return [
    `Square commercial banner cover for a Chinese research product titled "${input.title}".`,
    `Category: ${category}.`,
    `Style: clean modern flat design, geometric shapes, navy blue + amber accent colors,`,
    `large bold Chinese title in center, abstract data visualization elements (charts, graphs)`,
    `in background, professional and trustworthy feeling. No people, no faces.`,
    `Output: square 1:1 aspect ratio, suitable for Xianyu (闲鱼) product main image.`,
  ].join(' ');
}

function parseTitles(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const titles: string[] = [];
  for (const line of lines) {
    let t = line.replace(/^\d{1,2}[.、)\s]+/, '').trim();
    t = t.replace(/^[-*]\s+/, '').trim();
    t = t.replace(/^["“『「]|["”』」]$/g, '').trim();
    if (t.length >= 4 && t.length <= 60) titles.push(t);
  }
  return Array.from(new Set(titles)).slice(0, 5);
}

function cleanDescription(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:text|markdown)?\s*/i, '').replace(/```$/i, '').trim();
  t = t.replace(/^["“]|["”]$/g, '').trim();
  return t.length > 500 ? `${t.slice(0, 500)}...` : t;
}
