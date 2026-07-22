import { z } from 'zod';
import type { ZodType } from 'zod';

import { loadTextGenProvider } from '@/lib/llm/text-gen';
import { generateObjectWithFallback } from '@/lib/text-generator';

import { ASIN_RE } from './constants';
import { sanitizeRuleSet, type ExtractionRuleSet } from './extraction-rules';
import type { PageDigest } from './page-digest';

/**
 * AI 操作模式的大模型 I/O 层：读页（摘要 → 自然位 ASIN）与规则提案
 * （摘要 + 期望结果 → 新提取规则）。只做 LLM 调用与出入参清洗，
 * 浏览器交互与验证编排在 engines.ts。
 */

export type StructuredGenerate = <T>(args: {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  maxTokens?: number;
  signal?: AbortSignal;
}) => Promise<T>;

/** 按 Lumos 默认 provider 构建生成函数；不可用时抛出带指引的错误 */
export function createProviderGenerate(runId: string): StructuredGenerate {
  const handle = loadTextGenProvider();
  return async ({ system, prompt, schema, maxTokens, signal }) =>
    generateObjectWithFallback({
      providerId: handle.providerId,
      model: handle.model,
      system,
      prompt,
      schema,
      maxTokens: maxTokens ?? 2048,
      abortSignal: signal,
      requestMetadata: { module: 'amazon-rank', operation: 'ai-operator', runId },
    });
}

const PageReadSchema = z.object({
  organicAsins: z.array(z.string()).default([]),
  captcha: z.boolean().default(false),
  noResults: z.boolean().default(false),
});

export interface AiPageRead {
  organicAsins: string[];
  captcha: boolean;
  noResults: boolean;
}

/** 读页输出契约（固定追加在用户可编辑提示词之后，用户怎么改都不破坏 schema） */
const PAGE_READ_CONTRACT =
  '输出 JSON：organicAsins=按页面顺序的自然位 ASIN 数组（10 位大写字母数字，排除一切广告/Sponsored/推荐位）；' +
  'captcha=页面是否为验证码/机器人拦截页；noResults=页面是否明确提示没有匹配的商品。' +
  '拿不准的卡片宁可不计入 organicAsins。';

export async function readPageWithAi(
  generate: StructuredGenerate,
  operatorPrompt: string,
  digest: PageDigest,
  topN: number,
  signal?: AbortSignal,
): Promise<AiPageRead> {
  const raw = await generate({
    system: `${operatorPrompt.trim()}\n\n${PAGE_READ_CONTRACT}`,
    prompt:
      `目标：识别前 ${topN} 个自然搜索位。\n` +
      `页面摘要（cards 按页面文档序；type=data-component-type；cls=class 片段；text=卡片文本片段）：\n` +
      JSON.stringify(digest),
    schema: PageReadSchema,
    signal,
  });
  const seen = new Set<string>();
  const organicAsins: string[] = [];
  for (const item of raw.organicAsins) {
    const asin = String(item).trim().toUpperCase();
    if (!ASIN_RE.test(asin) || seen.has(asin)) continue;
    seen.add(asin);
    organicAsins.push(asin);
    if (organicAsins.length >= topN) break;
  }
  return { organicAsins, captcha: raw.captcha, noResults: raw.noResults };
}

const RuleProposalSchema = z.object({
  resultSelector: z.string(),
  asinAttribute: z.string(),
  adTextMarkers: z.array(z.string()).default([]),
  adClassMarkers: z.array(z.string()).default([]),
  adLabelSelectors: z.array(z.string()).default([]),
  noResultsPatterns: z.array(z.string()).default([]),
  captchaSelectors: z.array(z.string()).default([]),
  captchaTextPatterns: z.array(z.string()).default([]),
  rationale: z.string().default(''),
});

export interface RuleProposal {
  rules: ExtractionRuleSet;
  rationale: string;
}

const RULE_PROPOSAL_SYSTEM =
  '你是网页提取规则工程师。现有的确定性提取规则在亚马逊搜索页上失效了，' +
  '请根据页面摘要和已确认的正确答案，提出一套新规则。规则语义：' +
  'resultSelector=querySelectorAll 拿到按页面顺序的结果卡片；asinAttribute=卡片上携带 ASIN 的属性名；' +
  'adTextMarkers=卡片 innerHTML 含任一子串即广告（区分大小写）；adClassMarkers=卡片 class 含任一即广告；' +
  'adLabelSelectors=卡片内命中任一选择器即广告；noResultsPatterns/captchaTextPatterns=页面标题+正文小写包含匹配；' +
  'captchaSelectors=页面级选择器。规则必须泛化到其他关键词的搜索页，不要写死本页特有的 ASIN 或文本。';

export async function proposeRulesWithAi(
  generate: StructuredGenerate,
  digest: PageDigest,
  expectedAsins: string[],
  currentRules: ExtractionRuleSet,
  signal?: AbortSignal,
): Promise<RuleProposal> {
  const raw = await generate({
    system: RULE_PROPOSAL_SYSTEM,
    prompt:
      `当前失效的规则：\n${JSON.stringify(currentRules)}\n\n` +
      `这一页的正确自然位 ASIN（按顺序，作为新规则的验收标准）：\n${JSON.stringify(expectedAsins)}\n\n` +
      `页面摘要：\n${JSON.stringify(digest)}\n\n` +
      '输出新规则 JSON，并在 rationale 里用一两句话说明改了什么、为什么。',
    schema: RuleProposalSchema,
    signal,
  });
  const { rationale, ...ruleFields } = raw;
  return { rules: sanitizeRuleSet(ruleFields), rationale: rationale.trim().slice(0, 500) };
}
