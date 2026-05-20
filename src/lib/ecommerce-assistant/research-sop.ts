/**
 * 调研 SOP —— 方法论层（业务上用户说的「内置一套 SOP / skill」）。
 *
 * 本模块不采集、不 compose，只负责「调研该怎么做」的剧本：
 * - 从用户一段自然语言需求里读出平台 / 品类 / 价位 / 关注点（不再有独立
 *   平台选择器，平台写在描述里）。
 * - 每一轮决定：是否已经够了；不够的话下一轮去哪些数据源、搜什么 query；
 *   还缺什么（gaps）。
 * - 轮次 / 单轮 query 数的硬预算，避免无限深挖烧预算。
 *
 * 真正的多轮驱动在 research-runner 的 planner-executor 循环里：它反复调用
 * 这里的 planNextRound，按返回的 nextQueries 跑 adapter、累积 corpus，直到
 * done 或撞预算。LLM 不可用时降级为「立即收尾」（与调研模块既有原则一致：
 * AI 不可用不假装，原始数据照常保留）。
 */

import { z } from 'zod';

import { EcommerceLlmUnavailableError, generateStructured } from './llm-client';

/** 多轮调研硬上限。撞顶即用已采集 corpus 收尾，不再继续。 */
export const MAX_RESEARCH_ROUNDS = 4;
/** 单轮最多并行下发的检索条数，防止一轮炸开太多 adapter 调用。 */
export const MAX_QUERIES_PER_ROUND = 3;

export const RESEARCH_SOP_SYSTEM = `你是资深电商市场调研分析师。用户会用一段自然语言描述调研需求——目标平台、品类、价位带、关注点、忽略项都可能混在这段话里，没有单独的平台字段，你要自己读出来。

你的工作方式是「多轮迭代调研」，不是搜一次就交差：
1. 第一轮：从需求里抽出目标平台（如 etsy / amazon / walmart / tiktok / 没指明则 general）与核心调研主题，下发覆盖面广的检索。
2. 之后每一轮：看已累积的发现，判断信息是否足够支撑一份能指导选品的调研报告（市场概况、热卖特征、价格带、竞争格局、机会与风险）。
   - 不够：找出还缺什么（gaps），下一轮针对性补搜——换关键词、换数据源、钻具体子问题，而不是重复上一轮。
   - 够了 / 边际收益很低 / 已逼近轮次预算：done=true，停止检索。
3. 数据源各有所长：web=平台真实 listing（标题/价格/评分/评论），deepsearch=知乎·公众号等深度图文与行业讨论，douyin=短视频侧的流行度与内容角度。按缺口选源，不必每轮全用。

判停原则：宁可早停也不要为凑数重复检索；空结果的源换思路而不是反复试同一个 query。reasoning 用一两句中文说清这轮为什么这么决定。`;

/** 每轮规划输出。source 用字符串，由 runner 按已注册源名校验过滤。 */
export const researchPlanSchema = z.object({
  platform: z
    .string()
    .max(40)
    .describe('从需求里抽出的目标平台标识，小写英文；没指明用 general'),
  done: z.boolean().describe('信息是否已足够、应停止检索进入汇总'),
  reasoning: z.string().max(600).describe('这轮判断的简短理由（中文，1-2 句）'),
  nextQueries: z
    .array(
      z.object({
        source: z.string().max(40).describe('数据源名（web / deepsearch / douyin 等）'),
        query: z.string().min(1).max(300).describe('该源这一轮要检索的具体 query'),
      }),
    )
    .max(MAX_QUERIES_PER_ROUND)
    .default([])
    .describe('下一轮要下发的检索；done=true 时应为空'),
  gaps: z
    .array(z.string().max(300))
    .max(8)
    .default([])
    .describe('当前仍缺失、影响报告完整度的信息点'),
});

export type ResearchPlan = z.infer<typeof researchPlanSchema>;

/** runner 累积、喂回 planner 的精简发现摘要（每轮一条）。 */
export interface RoundDigest {
  round: number;
  source: string;
  query: string;
  dataItems: number;
  sampleTitles: string[];
}

export interface PlanNextRoundArgs {
  /** 用户原始自然语言调研需求。 */
  description: string;
  /** 可选附加约束（如「忽略 dropshipping」）。 */
  instruction: string | null;
  /** 已注册可用的数据源名，喂给 planner 约束选源。 */
  availableSources: string[];
  /** 截至目前的多轮发现摘要。 */
  digests: RoundDigest[];
  /** 当前是第几轮（从 1 开始）。 */
  round: number;
  abortSignal?: AbortSignal;
}

function buildPlanPrompt(args: PlanNextRoundArgs): string {
  const lines: string[] = [];
  lines.push(`【调研需求】\n${args.description}`);
  if (args.instruction) lines.push(`【附加约束】\n${args.instruction}`);
  lines.push(`【可用数据源】${args.availableSources.join(' / ') || '（无）'}`);
  lines.push(`【轮次】第 ${args.round} / 最多 ${MAX_RESEARCH_ROUNDS} 轮`);
  if (args.digests.length === 0) {
    lines.push('【已累积发现】（首轮，暂无）');
  } else {
    const digest = args.digests
      .map(
        (d) =>
          `R${d.round} ${d.source}「${d.query}」→ ${d.dataItems} 条数据` +
          (d.sampleTitles.length ? `；样例：${d.sampleTitles.slice(0, 5).join(' | ')}` : ''),
      )
      .join('\n');
    lines.push(`【已累积发现】\n${digest}`);
  }
  lines.push(
    '请输出本轮规划：是否 done；若否，nextQueries 给出针对性的下一轮检索（不要重复已搜过的同义 query），并列出 gaps。',
  );
  return lines.join('\n\n');
}

/**
 * 规划下一轮。LLM 不可用时降级为「立即收尾」（done=true，不抛错），
 * 让 runner 用已采集 corpus 出报告而不是整单失败。
 */
export async function planNextRound(args: PlanNextRoundArgs): Promise<ResearchPlan> {
  try {
    const plan = await generateStructured({
      schema: researchPlanSchema,
      system: RESEARCH_SOP_SYSTEM,
      prompt: buildPlanPrompt(args),
      maxTokens: 1024,
      abortSignal: args.abortSignal,
    });
    // 撞轮次预算强制收尾，无视模型的 done（防止它一直要 nextQueries）。
    if (args.round >= MAX_RESEARCH_ROUNDS) {
      return { ...plan, done: true, nextQueries: [] };
    }
    return plan;
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return {
        platform: 'general',
        done: true,
        reasoning: '未配置可用文本模型，无法多轮规划——用已采集数据直接收尾。',
        nextQueries: [],
        gaps: ['AI 规划不可用，仅基于首轮/已采集数据'],
      };
    }
    throw err;
  }
}
