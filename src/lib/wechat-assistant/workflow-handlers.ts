import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  getCodeHandler,
  registerCodeHandler,
} from '@/lib/workflow/code-handler-registry';
import type { CodeHandlerContext } from '@/lib/workflow/code-handler-types';
import type { StepResult } from '@/lib/workflow/types';

import {
  buildDailySummaryReport,
  collectRecentMessagesForDailySummary,
  selectTodosForDailySummary,
} from './daily-summary';
import { listTodos } from './db';
import { loadWeChatOverview } from './overview-loader';
import { archiveWeChatAutomationReport } from './report-archive';
import { getWeChatAssistantSettings } from './settings-store';
import { runSync, type SyncResult } from './sync-engine';

const DAILY_SUMMARY_HANDLER_ID = 'wechat-assistant.daily-summary';

export function registerWeChatAssistantWorkflowHandlers(): void {
  if (getCodeHandler(DAILY_SUMMARY_HANDLER_ID)) return;
  registerCodeHandler({
    id: DAILY_SUMMARY_HANDLER_ID,
    name: '微信助手每日总结',
    description: '同步本机微信消息镜像，生成摘要报告并交给后续通知节点。',
    execute: runDailySummaryHandler,
  });
}

registerWeChatAssistantWorkflowHandlers();

async function runDailySummaryHandler(ctx: CodeHandlerContext): Promise<StepResult> {
  const automationId = normalizeParam(ctx.params.automationId, '');
  const automationName = normalizeParam(ctx.params.automationName, '每日微信总结');
  const messageTemplate = normalizeParam(
    ctx.params.messageTemplate,
    '汇总今天微信消息，提炼重点、待办和需要跟进的人。',
  );
  const sync = await runSync({ signal: ctx.signal });
  if (sync.status === 'failed') {
    const message = `微信消息同步失败：${sync.error ?? '未知错误'}`;
    await archiveDailySummary(ctx, {
      automationId,
      automationName,
      status: 'error',
      summary: message,
      error: message,
    });
    return failed(message, sync);
  }

  const overview = await loadWeChatOverview();
  if (!overview.ready) {
    const message = `微信助手暂不可用：${reasonLabel(overview.reason)}`;
    await archiveDailySummary(ctx, {
      automationId,
      automationName,
      status: 'error',
      summary: message,
      error: message,
    });
    return failed(message, sync);
  }

  const settings = getWeChatAssistantSettings();

  // 群标签范围由 summarySpec 在创建期解析、经 DSL params 传入（automations.ts
  // deriveSummarySpec 单一真源）。handler 不再从指令文本反推——旧的运行时
  // resolveGroupTagFromInstruction 已删，意图解析收敛到唯一归一点。
  const groupTagId = normalizeParam(ctx.params.groupTagId, '');
  if (groupTagId) {
    const tag = settings.groupTags.find((t) => t.id === groupTagId);
    if (!tag) {
      const message = `群标签未找到（id=${groupTagId}）；请到微信助手设置→群标签确认后再启用本自动化`;
      await archiveDailySummary(ctx, {
        automationId, automationName, status: 'error', summary: message, error: message,
      });
      return failed(message, sync);
    }
    // 动态 import：群标签路径较少触发，避免顶层拉入解析/总结依赖链
    // （含 setup-state 的 path.join(dataDir,…) 模块级求值），以免污染
    // workflow-handlers 的模块图（曾导致单测 dataDir undefined 加载失败）。
    const { summarizeGroupTag } = await import('./group-tag-summary');
    const r = await summarizeGroupTag({
      tag,
      days: settings.ai.windowDays,
      scopeNote: messageTemplate,
      settings,
      signal: ctx.signal,
    });
    const md = r.summaryMarkdown || `# ${tag.name} 日报\n\n${r.summary}`;
    const reportPath = path.join(ctx.outputDir, 'wechat-daily-summary.md');
    await mkdir(ctx.outputDir, { recursive: true });
    await writeFile(reportPath, md, 'utf8');
    // 「没消息/标签空」是正常结果（周末工作群安静），不能误报 error；
    // 只有真 LLM 失败、或解析失败/未配服务商（配置问题，需可见）才算 error。
    const normalEmpty =
      r.ai.status === 'skipped' &&
      (r.ai.reason === 'tag_empty' || r.ai.reason === 'no_messages');
    const ok = r.ai.status === 'success' || normalEmpty;
    await archiveDailySummary(ctx, {
      automationId,
      automationName,
      status: ok ? 'success' : 'error',
      summary: r.summary,
      reportMarkdown: md,
      reportFileName: 'wechat-daily-summary.md',
      error: ok ? undefined : (r.tagWarning ?? r.ai.reason ?? '未生成 AI 总结'),
    });
    return {
      success: ok,
      output: {
        summary: r.summary,
        notification: buildDailySummaryNotificationMessage(md),
        reportPath,
        reportMarkdown: md,
        metrics: {
          tag: tag.name,
          resolvedGroups: r.resolvedGroupCount,
          summarizedGroups: r.summarizedGroupCount,
          skippedEmpty: r.skippedEmpty.length,
          truncatedForBudget: r.truncatedForBudget.length,
          aiSummaryStatus: r.ai.status,
        },
      },
      metadata: {
        syncStatus: sync.status,
        syncReason: sync.reason ?? '',
        inserted: sync.inserted,
        seen: sync.seen,
        reportPath,
        aiSummaryStatus: r.ai.status,
        aiSummaryProviderId: r.ai.providerId ?? '',
        aiSummaryModel: r.ai.model ?? '',
        aiSummaryError: r.ai.reason ?? '',
      },
    };
  }

  const todos = selectTodosForDailySummary(
    listTodos({ status: ['open', 'suggested'] }),
    settings.excludedPersonIds,
    8,
  );
  const report = await buildDailySummaryReport({
    automationName,
    messageTemplate,
    data: overview.data,
    todos,
    sync,
    recentMessages: collectRecentMessagesForDailySummary(settings.ai.windowDays, 80, Date.now(), {
      excludedIds: settings.excludedPersonIds,
    }),
  }, {
    abortSignal: ctx.signal,
    settings,
  });
  const reportPath = path.join(ctx.outputDir, 'wechat-daily-summary.md');
  // The workflow runtime sets up outputDir, but on first run / cross-device
  // moves the parent may not exist yet. mkdir is cheap and idempotent.
  await mkdir(ctx.outputDir, { recursive: true });
  await writeFile(reportPath, report.markdown, 'utf8');
  await archiveDailySummary(ctx, {
    automationId,
    automationName,
    status: 'success',
    summary: report.summary,
    reportMarkdown: report.markdown,
    reportFileName: 'wechat-daily-summary.md',
  });

  const notification = buildDailySummaryNotificationMessage(report.markdown);
  return {
    success: true,
    output: {
      summary: report.summary,
      notification,
      reportPath,
      reportMarkdown: report.markdown,
      metrics: {
        activeChats: overview.data.totals.activeChats,
        messagesInWindow: overview.data.totals.messagesInWindow,
        todayMessages: report.todayMessages,
        todoCount: todos.length,
        aiSummaryStatus: report.ai.status,
      },
    },
    metadata: {
      syncStatus: sync.status,
      syncReason: sync.reason ?? '',
      inserted: sync.inserted,
      seen: sync.seen,
      reportPath,
      aiSummaryStatus: report.ai.status,
      aiSummaryProviderId: report.ai.providerId ?? '',
      aiSummaryModel: report.ai.model ?? '',
      aiSummaryError: report.ai.error ?? '',
    },
  };
}

function buildDailySummaryNotificationMessage(markdown: string): string {
  const body = markdown.trim();
  if (!body) {
    return '微信助手：每日微信总结\n报告正文未生成，请打开微信助手「自动化 > 最近结果」查看失败原因。';
  }
  return body;
}

async function archiveDailySummary(
  ctx: CodeHandlerContext,
  input: {
    automationId: string;
    automationName: string;
    status: 'success' | 'error';
    summary: string;
    error?: string;
    reportMarkdown?: string;
    reportFileName?: string;
  },
): Promise<void> {
  try {
    archiveWeChatAutomationReport({
      automationId: input.automationId,
      automationName: input.automationName,
      workflowSessionId: ctx.runtimeContext.sessionId,
      workflowRunId: ctx.workflowRunId,
      status: input.status,
      completedAt: new Date().toISOString(),
      summary: input.summary,
      error: input.error ?? '',
      reportMarkdown: input.reportMarkdown ?? '',
      reportFileName: input.reportFileName ?? null,
    });
  } catch (error) {
    console.warn('[wechat-assistant] Failed to archive daily summary report:', error);
  }
}

function failed(message: string, sync?: SyncResult): StepResult {
  return {
    success: false,
    output: {
      summary: message,
      notification: `微信助手运行失败：${message}`,
    },
    error: message,
    metadata: sync
      ? {
        syncStatus: sync.status,
        syncReason: sync.reason ?? '',
        inserted: sync.inserted,
        seen: sync.seen,
      }
      : undefined,
  };
}

function normalizeParam(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    unsupported_platform: '当前平台暂不支持读取微信',
    consent_required: '需要先完成微信数据授权',
    no_key: '需要先完成微信密钥恢复',
    no_sync_yet: '还没有同步过微信消息',
    snapshot_failed: '读取本地微信镜像失败',
  };
  return labels[reason] ?? reason;
}
