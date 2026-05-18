/**
 * 单一总结引擎门面（收敛 review 证据 #5：两套引擎 + handler 里 fork）。
 *
 * 按 scope 内部分派——group_tag → 走 group-tag-summary 范围版；all → 走
 * daily-summary 通用版——对外只暴露 produceSummary，返回归一结果。handler
 * 不再两路分叉、不再各自拼 metrics/ok 判定；sync/overview 前置与 write/
 * archive/notify 后置仍归 handler，引擎只负责"产出总结"。
 *
 * 底层两条 pipeline 的行为保持不变，仅统一入口与结果形（绞杀式：可回滚、
 * 不重写生成逻辑）。group-tag-summary 仍走动态 import（沿用既有模块图
 * 污染规避，见 workflow-handlers 注释/记忆）。
 */
import type { AppSettings } from '@/components/apps/builtin/wechat/app-settings';

import {
  buildDailySummaryReport,
  collectRecentMessagesForDailySummary,
  selectTodosForDailySummary,
} from './daily-summary';
import { listTodos } from './db';
import type { OverviewData } from './overview-types';
import type { SyncResult } from './sync-engine';

export interface SummaryProduction {
  markdown: string;
  summary: string;
  /** 是否成功（group-tag 的「标签空/无消息」算正常成功，非 error）。 */
  ok: boolean;
  /** ok=false 时的可见原因（写归档/输出，保证失败可见）。 */
  errorReason?: string;
  ai: {
    status: 'success' | 'failed' | 'skipped';
    providerId?: string;
    model?: string;
    error?: string;
  };
  metrics: Record<string, unknown>;
}

export interface ProduceSummaryArgs {
  /** 空 = 全部会话(scope all)；非空 = 该群标签范围(scope group_tag)。 */
  groupTagId: string;
  /** SummarySpec.emptyMessage：标签空/无消息时用户指定的话术（如"今日无工作"）。 */
  emptyMessage?: string;
  automationName: string;
  /** 用户原始指令（scopeNote / 执行要求），由 deriveSummarySpec 透传。 */
  messageTemplate: string;
  overviewData: OverviewData;
  sync: SyncResult;
  settings: AppSettings;
  signal?: AbortSignal;
}

export async function produceSummary(args: ProduceSummaryArgs): Promise<SummaryProduction> {
  if (args.groupTagId) {
    return produceGroupTagSummary(args);
  }
  return produceGenericSummary(args);
}

async function produceGroupTagSummary(args: ProduceSummaryArgs): Promise<SummaryProduction> {
  const tag = args.settings.groupTags.find((t) => t.id === args.groupTagId);
  if (!tag) {
    const reason = `群标签未找到（id=${args.groupTagId}）；请到微信助手设置→群标签确认后再启用本自动化`;
    return { markdown: '', summary: reason, ok: false, errorReason: reason, ai: { status: 'skipped' }, metrics: {} };
  }
  // 动态 import：沿用既有模块图污染规避（group-tag 依赖链含 setup-state 的
  // dataDir 模块级求值，曾导致单测加载失败）。
  const { summarizeGroupTag } = await import('./group-tag-summary');
  const r = await summarizeGroupTag({
    tag,
    days: args.settings.ai.windowDays,
    scopeNote: args.messageTemplate,
    settings: args.settings,
    signal: args.signal,
  });
  // 标签空 / 无消息是正常结果（安静工作群），不报 error；只有真 LLM 失败 /
  // 解析失败 / 未配服务商才算 error。
  const normalEmpty =
    r.ai.status === 'skipped' && (r.ai.reason === 'tag_empty' || r.ai.reason === 'no_messages');
  const ok = r.ai.status === 'success' || normalEmpty;
  const emptyBody = normalEmpty && args.emptyMessage ? args.emptyMessage : null;
  const markdown = emptyBody
    ? `# ${tag.name} 日报\n\n${emptyBody}`
    : r.summaryMarkdown || `# ${tag.name} 日报\n\n${r.summary}`;
  return {
    markdown,
    summary: emptyBody ?? r.summary,
    ok,
    errorReason: ok ? undefined : (r.tagWarning ?? r.ai.reason ?? '未生成 AI 总结'),
    ai: { status: r.ai.status, providerId: r.ai.providerId, model: r.ai.model, error: r.ai.reason },
    metrics: {
      tag: tag.name,
      resolvedGroups: r.resolvedGroupCount,
      summarizedGroups: r.summarizedGroupCount,
      skippedEmpty: r.skippedEmpty.length,
      truncatedForBudget: r.truncatedForBudget.length,
      aiSummaryStatus: r.ai.status,
    },
  };
}

async function produceGenericSummary(args: ProduceSummaryArgs): Promise<SummaryProduction> {
  const todos = selectTodosForDailySummary(
    listTodos({ status: ['open', 'suggested'] }),
    args.settings.excludedPersonIds,
    8,
  );
  const report = await buildDailySummaryReport(
    {
      automationName: args.automationName,
      messageTemplate: args.messageTemplate,
      data: args.overviewData,
      todos,
      sync: args.sync,
      recentMessages: collectRecentMessagesForDailySummary(
        args.settings.ai.windowDays,
        80,
        Date.now(),
        { excludedIds: args.settings.excludedPersonIds },
      ),
    },
    { abortSignal: args.signal, settings: args.settings },
  );
  return {
    markdown: report.markdown,
    summary: report.summary,
    ok: true,
    ai: {
      status: report.ai.status,
      providerId: report.ai.providerId,
      model: report.ai.model,
      error: report.ai.error,
    },
    metrics: {
      activeChats: args.overviewData.totals.activeChats,
      messagesInWindow: args.overviewData.totals.messagesInWindow,
      todayMessages: report.todayMessages,
      todoCount: todos.length,
      aiSummaryStatus: report.ai.status,
    },
  };
}
