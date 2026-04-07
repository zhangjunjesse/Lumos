/**
 * AI auto-tagger — analyze document content and suggest categorized tags
 * Uses the knowledge provider's configured model
 */
import { z } from 'zod';
import type { TagResult, CategorizedTagResult, CategorizedTag, TagCategory } from './types';
import { callKnowledgeModel, callKnowledgeObjectModel, getKnowledgeDefaultModel } from './llm';

const VALID_CATEGORIES = ['domain', 'tech', 'doctype', 'project', 'custom'] as const satisfies readonly TagCategory[];

const categorizedTagSchema = z.object({
  name: z.string().trim().min(2).max(20),
  category: z.enum(VALID_CATEGORIES),
  confidence: z.number().min(0).max(1),
});

const categorizedTagResponseSchema = z.object({
  matched: z.array(categorizedTagSchema).default([]),
  suggested: z.array(categorizedTagSchema).default([]),
});

function buildCategorizedPrompt(existingTags: string[]): string {
  const has = existingTags.length > 0;
  const existing = has ? `\n已有标签库（优先匹配）：[${existingTags.join('、')}]\n` : '';
  return `你是文档标签分析专家。分析文档，提取3-6个标签并分类。
${existing}标签分类：
- domain: 业务领域（如"金融"、"教育"）
- tech: 技术栈（如"React"、"Python"）
- doctype: 文档类型（如"技术方案"、"会议纪要"）
- project: 项目名（如"Lumos"）
- custom: 其他

要求：
1. ${has ? '优先用已有标签' : '标签要具体有区分度'}
2. 每个标签2-8字
3. confidence: 0-1，表示标签与文档的相关度
4. 只返回JSON，格式：
{"matched":[{"name":"标签","category":"domain","confidence":0.9}],"suggested":[{"name":"新标签","category":"tech","confidence":0.8}]}

文档内容：
`;
}

async function callTagText(content: string, existingTags: string[]): Promise<string> {
  return callKnowledgeModel({
    model: getKnowledgeDefaultModel(),
    maxTokens: 16000,
    timeoutMs: 30000,
    prompt: buildCategorizedPrompt(existingTags) + content.slice(0, 3000),
  });
}

async function callTagStructured(
  content: string,
  existingTags: string[],
): Promise<z.infer<typeof categorizedTagResponseSchema>> {
  const has = existingTags.length > 0;
  const existing = has ? `已有标签库（优先复用）：${existingTags.join('、')}` : '当前没有已有标签库。';
  return callKnowledgeObjectModel({
    model: getKnowledgeDefaultModel(),
    maxTokens: 16000,
    timeoutMs: 30000,
    schema: categorizedTagResponseSchema,
    prompt: [
      '请为文档生成标签对象。',
      existing,
      '要求：',
      '- matched: 仅填写命中已有标签库的标签',
      '- suggested: 填写建议新增的标签',
      '- 每个标签 2-8 字',
      '- category 只能是 domain / tech / doctype / project / custom',
      '- confidence 取 0 到 1',
      '',
      '文档内容：',
      content.slice(0, 3000),
    ].join('\n'),
  });
}

function validTag(t: unknown): t is CategorizedTag {
  if (!t || typeof t !== 'object') return false;
  const obj = t as Record<string, unknown>;
  return typeof obj.name === 'string'
    && obj.name.length >= 2
    && obj.name.length <= 20
    && typeof obj.confidence === 'number';
}

function normalizeCategory(cat: unknown): TagCategory {
  if (typeof cat === 'string' && VALID_CATEGORIES.includes(cat as TagCategory)) {
    return cat as TagCategory;
  }
  return 'custom';
}

function parseCategorizedResult(
  text: string,
  existingTags: string[],
): CategorizedTagResult {
  const existingSet = new Set(existingTags);
  const empty: CategorizedTagResult = { matched: [], suggested: [] };

  const objMatch = text.match(/\{[\s\S]*\}/);
  if (!objMatch) return empty;

  try {
    const obj = JSON.parse(objMatch[0]);
    const matched = (obj.matched || []).filter(validTag)
      .filter((t: CategorizedTag) => existingSet.has(t.name))
      .map((t: CategorizedTag) => ({
        ...t,
        category: normalizeCategory(t.category),
      }));
    const suggested = (obj.suggested || []).filter(validTag)
      .filter((t: CategorizedTag) => !existingSet.has(t.name))
      .map((t: CategorizedTag) => ({
        ...t,
        category: normalizeCategory(t.category),
      }));
    return { matched, suggested };
  } catch {
    return empty;
  }
}

async function requestCategorizedTags(
  content: string,
  existingTags: string[],
): Promise<CategorizedTagResult> {
  const empty: CategorizedTagResult = { matched: [], suggested: [] };
  if (!content || content.length < 20) return empty;

  try {
    const response = await callTagStructured(content, existingTags);
    const existingSet = new Set(existingTags);
    return {
      matched: response.matched.filter((tag) => existingSet.has(tag.name)),
      suggested: response.suggested.filter((tag) => !existingSet.has(tag.name)),
    };
  } catch (error) {
    console.warn('[kb] Structured tag generation failed, falling back to text mode:', (error as Error).message);
    const response = await callTagText(content, existingTags);
    return parseCategorizedResult(response, existingTags);
  }
}

export async function autoTagCategorizedStrict(
  content: string,
  existingTags: string[] = [],
): Promise<CategorizedTagResult> {
  return requestCategorizedTags(content, existingTags);
}

/** Categorized auto-tag with confidence scores (new API) */
export async function autoTagCategorized(
  content: string,
  existingTags: string[] = [],
): Promise<CategorizedTagResult> {
  try {
    return await requestCategorizedTags(content, existingTags);
  } catch (err) {
    console.error('[kb] Auto-tag failed:', (err as Error).message);
    return { matched: [], suggested: [] };
  }
}

/** Backward-compatible: returns flat string arrays */
export async function autoTag(
  content: string,
  existingTags: string[] = [],
): Promise<TagResult> {
  const result = await autoTagCategorized(content, existingTags);
  return {
    matched: result.matched.map(t => t.name),
    suggested: result.suggested.map(t => t.name),
  };
}
