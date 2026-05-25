/**
 * patrol-ai.ts 共用 helper：LLM 调用 + prompt builders + 时间格式化。
 * IM 推送和报告渲染在 patrol-ai-push.ts。
 */

import { getProviderModelOptions } from '@/lib/model-metadata';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateObjectWithFallback, generateTextFromProvider } from '@/lib/text-generator';

import { ReportPosterSchema, SCHEMA_EXAMPLE, type ReportPosterData } from './report-schema';
import { tolerantParseReport } from './report-llm-tolerant';

// 重新导出 push 部分给 patrol-ai 使用
export { pushReportIfEnabled, pushReportDocxIfEnabled, formatPushSuffix, type PushReportResult, type ReportFormat } from './patrol-ai-push';

interface AIResolved { providerId: string; model: string; }

function resolveTextGen(): AIResolved | { error: string } {
  const provider = resolveProviderForCapability({ moduleKey: 'chat', capability: 'text-gen' });
  if (!provider) return { error: '未配置可用的文本生成服务商（设置 → Provider 启用一个支持 text-gen 的）。' };
  const model = getProviderModelOptions(provider)[0]?.value?.trim() ?? '';
  if (!model) return { error: `服务商 "${provider.name}" 没有可用模型。` };
  return { providerId: provider.id, model };
}

const TRANSIENT_PATTERNS = [/rate[ _-]?limit/i, /timeout/i, /ECONNRESET/i, /503/i, /504/i, /temporar/i];
function isTransient(err: string): boolean { return TRANSIENT_PATTERNS.some((p) => p.test(err)); }

export async function callTextGen(
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<{ text: string; providerId: string; model: string } | { error: string }> {
  const r = resolveTextGen();
  if ('error' in r) return r;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await generateTextFromProvider({
        providerId: r.providerId, model: r.model, system, prompt,
        maxTokens, temperature: 0.4,
        abortSignal: AbortSignal.timeout(120_000),
      });
      return { text, providerId: r.providerId, model: r.model };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI 生成失败';
      if (attempt === 0 && isTransient(msg)) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        continue;
      }
      return { error: msg };
    }
  }
  return { error: 'AI 重试后仍失败' };
}

/**
 * 让 LLM 吐 {hook, kpis, insight, quotes, actions} 结构化字段。
 *
 * 三层防御（按真实复现 NFTCPS 失败案例设计）：
 * 1. 先走 generateObjectWithFallback (schema-guided)
 * 2. schema-guided 失败 → 走纯文本调用 + tolerant parser（自动剥 {summaries:[...]} wrapper、
 *    字段类型适配、JSON 截断修复）
 * 3. tolerant 仍失败 → 返 error，并附带 LLM 原文前 500 字供诊断
 *
 * maxTokens 默认 5000（不是 3000）—— 真实 prompt 23K 字符 + 4-section insight 容易撞 3000 截断。
 */
/**
 * structured 路径全失败后的 markdown 兜底。
 * 让 IM 长图至少能推一份「降级 markdown」而不是整个 task failed。
 * 返 { poster: null, markdown } 让 patrol-ai 写库 + 推 image 长图。
 */
export async function callReportWithMarkdownFallback(
  system: string, prompt: string,
): Promise<{ poster: ReportPosterData | null; markdown: string; failureReason: string; providerId: string; model: string } | { error: string }> {
  const structured = await callStructuredReport(system, prompt, 5000);
  if (!('error' in structured)) {
    return { poster: structured.data, markdown: '', failureReason: '', providerId: structured.providerId, model: structured.model };
  }
  // schema-guided + tolerant 都失败 → callTextGen 兜底 markdown
  const text = await callTextGen(system, prompt, 4000);
  if ('error' in text) {
    return { error: `structured 失败：${structured.error.slice(0, 200)}；markdown 兜底也失败：${text.error}` };
  }
  return {
    poster: null,
    markdown: text.text,
    failureReason: `LLM 未按 schema 输出，已降级 markdown 长图（${structured.error.slice(0, 120)}）`,
    providerId: text.providerId, model: text.model,
  };
}

export async function callStructuredReport(
  system: string, prompt: string, maxTokens = 5000,
): Promise<{ data: ReportPosterData; providerId: string; model: string } | { error: string }> {
  const r = resolveTextGen();
  if ('error' in r) return r;
  const systemWithSchema = `${system}\n\n【输出 JSON 格式 - 顶层就是这 5 个字段，不要嵌套 summaries / data / accounts 这种 wrapper】\n${SCHEMA_EXAMPLE}`;

  // Layer 1: schema-guided
  try {
    const data = await generateObjectWithFallback({
      providerId: r.providerId, model: r.model,
      schema: ReportPosterSchema,
      system: systemWithSchema, prompt,
      maxTokens, temperature: 0.5,
      abortSignal: AbortSignal.timeout(180_000),
    });
    return { data, providerId: r.providerId, model: r.model };
  } catch (layer1Err) {
    const layer1Msg = layer1Err instanceof Error ? layer1Err.message : '结构化失败';
    // Layer 2: 纯文本 + tolerant parser
    try {
      const text = await generateTextFromProvider({
        providerId: r.providerId, model: r.model,
        system: `${systemWithSchema}\n\n你必须只输出 JSON 对象，不要任何 markdown 围栏、解释、注释。`,
        prompt,
        maxTokens, temperature: 0.5,
        abortSignal: AbortSignal.timeout(180_000),
      });
      const rescued = tolerantParseReport(text);
      if (rescued.ok) return { data: rescued.data, providerId: r.providerId, model: r.model };
      // Layer 2 失败：返完整诊断
      return { error: `Schema 自救失败：${rescued.reason}；LLM 原文(头500字)：${rescued.rawHead.slice(0, 500)}` };
    } catch (layer2Err) {
      const layer2Msg = layer2Err instanceof Error ? layer2Err.message : '文本兜底失败';
      if (isTransient(layer2Msg)) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        // 一次重试（layer 1 schema-guided 简化版）
        try {
          const data = await generateObjectWithFallback({
            providerId: r.providerId, model: r.model,
            schema: ReportPosterSchema, system: systemWithSchema, prompt,
            maxTokens, temperature: 0.5,
            abortSignal: AbortSignal.timeout(180_000),
          });
          return { data, providerId: r.providerId, model: r.model };
        } catch { /* fall through */ }
      }
      return { error: `LLM 调用失败：${layer1Msg}；文本兜底也失败：${layer2Msg}` };
    }
  }
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// === Prompt builders ===
// 输出走 generateObjectWithFallback + ReportPosterSchema → {hook, kpis, insight, quotes, actions}。

const SHARED_ANGLE_HINT = [
  '【内容角度要求】',
  '1. hook 必须刺穿一眼记住 — 含具体数字 / 反差 / 时间对比。弱："本周 AI 热度上升"。强："AI 编程工具半年破 10 亿 ARR，传统软件 30 年没干成"',
  '2. kpis 必须用原文真实数字，带单位（亿/%/倍/天/人）。优先选有反差冲击力的',
  '3. insight ## 标题必须是"一个具体判断 / 反差"，禁止「核心趋势 / 典型讨论 / 跟进建议」套路。范例："GEO 接管 SEO 的临界点正在到来" / "97% 部署但 88% 没跑通：AI Agent 的硅墙效应"',
  '4. quotes 必须是"值得截图发朋友圈"的金句 — 短 / 反常识 / 有画面感',
  '5. actions 具体到"工具名 + 动作 + 预期"，禁止"持续关注 / 多多关注"空话',
].join('\n');

const SHARED_HARD_RULES = '【硬规则】数字/引用/名词必须出自证据，证据不足标"未决"，不要复述任务说明';

export function buildTopicPrompt(args: {
  topic: string; queries: string[]; evidenceCount: number;
  sources: { author: string; text: string; url: string }[];
}): { system: string; prompt: string } {
  const system = `你是一位 X(Twitter) 趋势研究员。基于原推证据提炼"值得做 / 值得抄"的选题方向。\n\n${SHARED_ANGLE_HINT}\n\n${SHARED_HARD_RULES}`;
  const prompt = [
    `# 任务：选题挖掘`,
    `选题：${args.topic}`,
    `查询关键词：${args.queries.join('、')}`,
    `证据数：${args.evidenceCount} 条`,
    '',
    '## 证据原文',
    ...args.sources.map((s) => `- @${s.author}：${s.text}  [原推](${s.url})`),
  ].join('\n');
  return { system, prompt };
}

export function buildDigestPrompt(args: {
  windowKind: 'daily' | 'weekly';
  cutoffMs: number; endMs: number;
  handles: string[]; totalTweets: number;
  accounts: { handle: string; tweet_count: number; tweets: { text: string; url: string }[] }[];
}): { system: string; prompt: string } {
  const system = `你是一位 X(Twitter) 关注摘要编辑，做${args.windowKind === 'weekly' ? '周报' : '日报'}。要让读者"扫一眼就知道这一${args.windowKind === 'weekly' ? '周' : '天'}最值得记住什么"。\n\n${SHARED_ANGLE_HINT}\n\n${SHARED_HARD_RULES}\n- 账号无新推时 hook 写"本期沉寂"或类似，不要硬凑`;
  const prompt = [
    `# 任务：关注摘要（${args.windowKind === 'weekly' ? '周报' : '日报'}）`,
    `窗口：${fmtDate(args.cutoffMs)} → ${fmtDate(args.endMs)}`,
    `覆盖 ${args.handles.length} 个账号 · ${args.totalTweets} 条原推`,
    '',
    '## 各账号原推',
    ...args.accounts.map((a) => {
      if (a.tweets.length === 0) return `### @${a.handle}\n本期无更新`;
      return `### @${a.handle}（${a.tweet_count} 条）\n` + a.tweets.map((t) => `- ${t.text.slice(0, 200)}  [原推](${t.url})`).join('\n');
    }),
  ].join('\n');
  return { system, prompt };
}

export function buildStatsPrompt(args: {
  target: string; targetKind: 'handle' | 'topic'; sampleDays: number;
  metrics: Record<string, unknown>;
  topThreads: { author: string; like_count: number; retweet_count: number; text: string; url: string }[];
}): { system: string; prompt: string } {
  const system = `你是一位 X(Twitter) 数据分析师。用数据讲一个反差故事。\n\n${SHARED_ANGLE_HINT}\n\n${SHARED_HARD_RULES}\n- kpis 必须直接用 metrics 里的数字`;
  const prompt = [
    `# 任务：数据拆解`,
    `分析目标：${args.target}（${args.targetKind === 'topic' ? '话题' : '账号'}）`,
    `采样窗口：最近 ${args.sampleDays} 天`,
    '',
    '## 量化指标',
    '```json',
    JSON.stringify(args.metrics, null, 2),
    '```',
    '',
    '## 热门 thread',
    ...args.topThreads.map((t) => `- @${t.author}（${t.like_count}赞/${t.retweet_count}转）：${t.text}  [原推](${t.url})`),
  ].join('\n');
  return { system, prompt };
}

