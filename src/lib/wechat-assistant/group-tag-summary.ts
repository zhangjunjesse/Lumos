/**
 * 按群标签做总结的共享实现 —— 被 MCP 工具 `summarize_wechat_groups`（即时）
 * 和 wechat_summary 自动化（定时，groupTagId）共用，避免两处复制。
 *
 * 流程：解析标签 → 拉每群近 N 天文本 → 预算内拼 transcript（活跃群优先，
 * 超预算的群如实列出而非静默丢） → LLM 出结构化报告。零数据/无服务商/LLM
 * 失败都如实返回，绝不伪造（对齐项目「失败原因可见、不冒充」红线）。
 */
import type { AppSettings, GroupTag } from '@/components/apps/builtin/wechat/app-settings';
import { resolveGroupTag, type ResolvedGroupTag } from './group-tag-resolver';
import { queryMessagesForChats } from './mirror-store';
import { resolveWeChatTextGenerationTarget } from './provider-options';
import { getWeChatAssistantSettings } from './settings-store';
import { generateTextFromProvider } from '@/lib/text-generator';

const TOTAL_MSG_BUDGET = 3000;
/** 每群最少纳入条数，低于此再深挖也没上下文价值。 */
const MIN_PER_GROUP = 8;

export interface GroupTagSummaryResult {
  resolvedGroupCount: number;
  summarizedGroupCount: number;
  includedGroups: { chat: string; msgCount: number }[];
  skippedEmpty: string[];
  truncatedForBudget: string[];
  windowDays: number;
  summaryMarkdown: string;
  /** 一句话摘要（首个标题/非空行），用于通知/归档 summary 字段。 */
  summary: string;
  ai: { status: 'success' | 'failed' | 'skipped'; reason?: string; providerId?: string; model?: string };
  tagWarning: string | null;
}

export interface SummarizeGroupTagOptions {
  tag: GroupTag;
  days?: number;
  perChatLimit?: number;
  scopeNote?: string;
  settings?: AppSettings;
  signal?: AbortSignal;
  /**
   * 预解析结果。调用方（MCP 工具）可把标签解析与镜像同步并行后传入，
   * 省掉这里再 spawn 一次 api.py（两次独立 python 调用并行 → 降延迟）。
   */
  preResolved?: ResolvedGroupTag;
}

function oneLineSummary(markdown: string, fallback: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').trim();
    if (line) return line.slice(0, 120);
  }
  return fallback;
}

export async function summarizeGroupTag(
  opts: SummarizeGroupTagOptions,
): Promise<GroupTagSummaryResult> {
  const settings = opts.settings ?? getWeChatAssistantSettings();
  const days = opts.days ?? 1;
  const perChatLimit = opts.perChatLimit ?? 120;

  const resolved = opts.preResolved ?? (await resolveGroupTag(opts.tag));
  const base: GroupTagSummaryResult = {
    resolvedGroupCount: resolved.groupWxids.length,
    summarizedGroupCount: 0,
    includedGroups: [],
    skippedEmpty: [],
    truncatedForBudget: [],
    windowDays: days,
    summaryMarkdown: '',
    summary: '',
    ai: { status: 'skipped' },
    tagWarning: resolved.warning ?? null,
  };

  if (resolved.groupWxids.length === 0) {
    // 有 warning（如 contact.db 不可读）说明是"解析失败"而非"真没群"，
    // 透出真实原因，不掩盖（失败原因可见红线）。
    const why = resolved.warning ? `resolve_error: ${resolved.warning}` : 'tag_empty';
    base.summary = resolved.warning
      ? `标签「${opts.tag.name}」解析失败：${resolved.warning}`
      : `标签「${opts.tag.name}」未匹配任何群`;
    base.ai = { status: 'skipped', reason: why };
    return base;
  }

  const bundles = queryMessagesForChats(
    resolved.groupWxids,
    days,
    Math.floor(Date.now() / 1000),
  );
  const withMsgs = bundles
    .filter((b) => b.messages.length > 0)
    .sort((a, b) => b.messages.length - a.messages.length);
  base.skippedEmpty = resolved.groups
    .filter((g) => !withMsgs.some((b) => b.wxid === g.wxid))
    .map((g) => g.name);

  if (withMsgs.length === 0) {
    base.summary = `标签「${opts.tag.name}」下 ${resolved.groupWxids.length} 个群近 ${days} 天无文本消息`;
    base.ai = { status: 'skipped', reason: 'no_messages' };
    return base;
  }

  // 广度优先：一份"工作群日报"要覆盖每个群的要点，而不是被几个话痨群
  // 吃光预算。每群按公平份额取最近 N 条（份额 = 预算/活跃群数，下限保证
  // 仍有上下文，上限不超过 per_chat_limit），保证尽量多的群都被纳入。
  const fairShare = Math.max(
    MIN_PER_GROUP,
    Math.min(perChatLimit, Math.floor(TOTAL_MSG_BUDGET / withMsgs.length) || perChatLimit),
  );
  const transcripts: string[] = [];
  let budget = TOTAL_MSG_BUDGET;
  for (const b of withMsgs) {
    if (budget < MIN_PER_GROUP) {
      base.truncatedForBudget.push(b.display);
      continue;
    }
    const take = Math.min(b.messages.length, fairShare, budget);
    budget -= take;
    base.includedGroups.push({ chat: b.display, msgCount: take });
    const lines = b.messages
      .slice(-take)
      .map((m) => {
        const who = m.sender === 'me' ? '我' : m.senderDisplay || '对方';
        return `[${new Date(m.ts * 1000).toLocaleString('zh-CN')}] ${who}: ${m.content}`;
      })
      .join('\n');
    transcripts.push(`## 群：${b.display}\n${lines}`);
  }
  base.summarizedGroupCount = base.includedGroups.length;

  const target = resolveWeChatTextGenerationTarget(settings, 'sonnet');
  if (!target.ok) {
    base.summary = `已聚合 ${base.summarizedGroupCount} 群，但未配置文本生成服务商`;
    base.ai = { status: 'skipped', reason: target.message };
    return base;
  }

  const hasUserStructure = !!opts.scopeNote?.trim();
  const system = [
    `你是微信群聊摘要助手。把给定的多个群（标签「${opts.tag.name}」）的近期聊天记录整理成一份中文 Markdown 摘要。`,
    '严格要求：只依据提供的消息，不臆造；没有内容的方面不写；不复述系统消息。不要揣测这些群的用途——标签可能是工作、家人、生活、同学等任意分类，绝不默认是工作场景、绝不套用工作型措辞。',
    hasUserStructure
      ? '报告的结构、栏目和侧重完全按下面「用户要求」来组织：用户要提炼什么就提炼什么，不要套用任何固定模板。'
      : `用户没指定结构，用中性默认：# ${opts.tag.name} 摘要 / ## 要点 / ## 需要我留意或处理的事 / ## 分群要点（每群1-3条）。`,
    '用户要求里若出现"发给我/通过微信发送/转发/通知我/如果没有就说…"这类，是系统自动负责的投递动作，不归你执行：你只产出报告正文，绝不复述这些投递要求，绝不就发送方式或你的 AI 身份作任何说明、致歉或免责。',
  ].join('\n');
  const prompt = [
    `标签：${opts.tag.name}；时间窗：近 ${days} 天；纳入 ${base.summarizedGroupCount} 个群。`,
    opts.scopeNote ? `用户要求（按此组织报告的结构与侧重）：${opts.scopeNote}` : '',
    base.truncatedForBudget.length
      ? `（另有 ${base.truncatedForBudget.length} 个活跃群因预算未纳入，请在末尾提示可缩小时间窗或拆分标签）`
      : '',
    '',
    transcripts.join('\n\n'),
  ].filter(Boolean).join('\n');

  try {
    const markdown = await generateTextFromProvider({
      providerId: target.providerId,
      model: target.model,
      system,
      prompt,
      maxTokens: 2600,
      temperature: 0.3,
      abortSignal: opts.signal,
    });
    base.summaryMarkdown = markdown;
    base.summary = oneLineSummary(markdown, `${opts.tag.name}：${base.summarizedGroupCount} 群日报`);
    base.ai = { status: 'success', providerId: target.providerId, model: target.model };
  } catch (err) {
    base.ai = {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
      providerId: target.providerId,
      model: target.model,
    };
    base.summary = `标签「${opts.tag.name}」AI 总结失败`;
  }
  return base;
}
