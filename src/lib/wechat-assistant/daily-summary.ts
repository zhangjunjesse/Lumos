import { generateTextFromProvider } from '@/lib/text-generator';

import type { AppSettings } from '@/components/apps/builtin/wechat/app-settings';
import { DEFAULT_PROMPTS } from '@/components/apps/builtin/wechat/default-prompts';

import { querySnapshot } from './mirror-store';
import { resolveWeChatTextGenerationTarget } from './provider-options';
import { getWeChatAssistantSettings } from './settings-store';
import type { OverviewData, OverviewRow } from './overview-types';
import type { SyncResult } from './sync-engine';
import {
  displayWechatName,
  safeSanitizedWechatText,
  sanitizeWechatText,
} from './wechat-text';

export interface DailySummaryTodo {
  text: string;
  sourceWxid?: string | null;
  sourceDisplay?: string | null;
  byWhenText?: string | null;
}

export interface DailySummaryRecentMessage {
  chatName: string;
  isGroup: boolean;
  sender: 'me' | 'them';
  content: string;
  ts: number;
}

export interface DailySummaryInput {
  automationName: string;
  messageTemplate: string;
  data: OverviewData;
  todos: DailySummaryTodo[];
  sync: SyncResult;
  recentMessages?: DailySummaryRecentMessage[];
}

export interface DailySummaryReport {
  markdown: string;
  summary: string;
  todayMessages: number;
  ai: {
    status: 'skipped' | 'success' | 'failed';
    providerId?: string;
    model?: string;
    error?: string;
  };
}

export async function buildDailySummaryReport(
  input: DailySummaryInput,
  options: {
    abortSignal?: AbortSignal;
    settings?: AppSettings;
  } = {},
): Promise<DailySummaryReport> {
  const base = buildDeterministicDailySummaryReport(input);
  const settings = options.settings ?? getWeChatAssistantSettings();
  const target = resolveWeChatTextGenerationTarget(settings, 'sonnet');
  if (!target.ok) {
    return withSkippedAiStatus(base, target.message);
  }

  try {
    const markdown = normalizeEnhancedMarkdown(
      await generateTextFromProvider({
        providerId: target.providerId,
        model: target.model,
        system: renderDailyReporterSystem(settings, input),
        prompt: buildDailyReporterPrompt(input, base),
        maxTokens: 2200,
        temperature: 0.25,
        abortSignal: options.abortSignal,
      }),
      input.automationName,
    );
    const summary = extractSummaryFromMarkdown(markdown, base.summary);
    return {
      ...base,
      markdown,
      summary,
      ai: {
        status: 'success',
        providerId: target.providerId,
        model: target.model,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
      markdown: [
        base.markdown,
        '',
        '## AI 增强状态',
        '',
        `AI 增强失败，已使用基础统计报告：${truncate(message, 180)}`,
      ].join('\n'),
      ai: {
        status: 'failed',
        providerId: target.providerId,
        model: target.model,
        error: message,
      },
    };
  }
}

export function buildDeterministicDailySummaryReport(input: DailySummaryInput): DailySummaryReport {
  const { data, todos } = input;
  const topChats = data.rows.slice(0, 6);
  const todayMessages = countTodayMessages(data.rows);
  const topName = topChats[0] ? rowDisplayName(topChats[0]) : '暂无活跃会话';
  const summary = [
    `今日微信新增 ${todayMessages} 条消息`,
    `${data.totals.activeChats} 个活跃会话`,
    `近 ${data.windowDays} 天共 ${data.totals.messagesInWindow} 条消息`,
    topChats[0] ? `最活跃会话是「${topName}」` : '',
  ].filter(Boolean).join('，') + '。';

  const topChatLines = topChats.length > 0
    ? topChats.map((row, index) => `${index + 1}. ${rowDisplayName(row)}：${row.messageCount} 条，最近 ${formatTs(row.lastTs)}`)
    : ['暂无可分析会话。'];
  const todoLines = formatTodoLines(todos);

  const markdown = [
    `# ${input.automationName}`,
    '',
    `生成时间：${formatTs(data.generatedAt)}`,
    `执行要求：${input.messageTemplate}`,
    '',
    '## 今日概览',
    '',
    summary,
    '',
    `- 同步状态：${syncLabel(input.sync)}`,
    `- 活跃会话：${data.totals.activeChats}`,
    `- 近 ${data.windowDays} 天消息：${data.totals.messagesInWindow}`,
    `- 今日消息：${todayMessages}`,
    `- 沉默 14 天以上会话：${data.totals.silentCount}`,
    '',
    '## 活跃会话',
    '',
    ...topChatLines,
    '',
    '## 待跟进',
    '',
    ...todoLines,
    '',
    '## 下一步',
    '',
    '- 优先处理待跟进列表中的高时效事项。',
    '- 对最活跃会话做人工确认，避免把群聊闲聊误判为重要任务。',
  ].join('\n');

  return {
    markdown,
    summary,
    todayMessages,
    ai: { status: 'skipped' },
  };
}

export function collectRecentMessagesForDailySummary(
  windowDays: number,
  limit = 80,
  nowMs = Date.now(),
  options: { excludedIds?: string[] } = {},
): DailySummaryRecentMessage[] {
  try {
    const snapshot = querySnapshot(windowDays, Math.floor(nowMs / 1000));
    const excluded = new Set(options.excludedIds ?? []);
    const sessions = new Map(snapshot.sessions.map((session) => [
      session.wxid,
      {
        name: displayWechatName(session.display, session.wxid, {
          groupFallback: '微信群聊',
          contactFallback: '微信联系人',
        }),
        isGroup: session.is_group,
      },
    ]));
    return snapshot.messages
      .filter((message) => !excluded.has(message.wxid))
      .filter((message) => isUsefulTextMessage(message.content))
      .slice(0, limit)
      .map((message) => {
        const session = sessions.get(message.wxid);
        return {
          chatName: displayWechatName(session?.name, message.wxid, {
            groupFallback: '微信群聊',
            contactFallback: '微信联系人',
          }),
          isGroup: session?.isGroup ?? message.wxid.endsWith('@chatroom'),
          sender: message.sender,
          content: truncate(cleanMessageContent(message.content), 120),
          ts: message.ts * 1000,
        };
      });
  } catch {
    return [];
  }
}

export function selectTodosForDailySummary(
  todos: DailySummaryTodo[],
  excludedIds: string[] = [],
  limit = 8,
): DailySummaryTodo[] {
  const excluded = new Set(excludedIds);
  return todos
    .filter((todo) => !todo.sourceWxid || !excluded.has(todo.sourceWxid))
    .slice(0, limit);
}

function renderDailyReporterSystem(settings: AppSettings, input: DailySummaryInput): string {
  const template = settings.ai.prompts.dailyReporter || DEFAULT_PROMPTS.dailyReporter;
  return template
    .replaceAll('{windowDays}', String(input.data.windowDays))
    .replaceAll('{messageTemplate}', input.messageTemplate);
}

function withSkippedAiStatus(base: DailySummaryReport, reason: string): DailySummaryReport {
  return {
    ...base,
    markdown: [
      base.markdown,
      '',
      '## AI 增强状态',
      '',
      `AI 增强已跳过：${truncate(reason, 180)}`,
    ].join('\n'),
    ai: {
      status: 'skipped',
      error: reason,
    },
  };
}

function buildDailyReporterPrompt(input: DailySummaryInput, base: DailySummaryReport): string {
  const payload = {
    generatedAt: new Date(input.data.generatedAt).toISOString(),
    request: input.messageTemplate,
    baseSummary: base.summary,
    sync: {
      status: input.sync.status,
      reason: input.sync.reason ?? '',
      inserted: input.sync.inserted,
      seen: input.sync.seen,
    },
    totals: input.data.totals,
    todayMessages: base.todayMessages,
    topChats: input.data.rows.slice(0, 10).map((row) => ({
      name: rowDisplayName(row),
      type: row.isGroup ? 'group' : 'personal',
      messageCount: row.messageCount,
      yourShare: Number(row.yourShare.toFixed(2)),
      todayMessages: row.interactionDays.find((day) => day.daysAgo === 0)?.count ?? 0,
      lastMessageAt: row.lastTs ? new Date(row.lastTs).toISOString() : null,
    })),
    todos: input.todos.slice(0, 12).map((todo) => ({
      text: safeSanitizedWechatText(todo.text, '微信待跟进事项'),
      source: todo.sourceDisplay
        ? displayWechatName(todo.sourceDisplay, todo.sourceWxid, {
          groupFallback: '微信群聊',
          contactFallback: '微信联系人',
        })
        : '',
      byWhen: todo.byWhenText ? sanitizeWechatText(todo.byWhenText) : '',
    })),
    recentMessages: (input.recentMessages ?? []).slice(0, 80).map((message) => ({
      chat: safeSanitizedWechatText(message.chatName, message.isGroup ? '微信群聊' : '微信联系人'),
      type: message.isGroup ? 'group' : 'personal',
      sender: message.sender,
      at: new Date(message.ts).toISOString(),
      content: safeSanitizedWechatText(message.content, '[消息内容已隐藏]'),
    })),
  };

  return [
    '请根据下面 JSON 数据生成最终 Markdown 报告。',
    '不要复述 JSON 字段名；不要输出代码块；不要编造数据中没有的项目、关系或结论。',
    '如果 recentMessages 为空，主要基于统计和待办写报告，并明确说明缺少消息片段。',
    '',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

/**
 * 唯一的总结通知构建器（收敛自 workflow-handlers 的
 * buildDailySummaryNotificationMessage 与本文件原 buildNotification——后者
 * 产出的 report.notification 早已被 handler 用 markdown 覆盖，是死代码、
 * 也是发散源）。通知正文 = 报告 markdown 本身；空报告给可见失败指引。
 */
export function buildSummaryNotification(markdown: string): string {
  const body = markdown.trim();
  if (!body) {
    return '微信助手：每日微信总结\n报告正文未生成，请打开微信助手「自动化 > 最近结果」查看失败原因。';
  }
  return body;
}

function formatTodoLines(todos: DailySummaryTodo[]): string[] {
  if (todos.length === 0) return ['暂无未完成跟进事项。'];
  return todos.map((todo, index) => {
    const sourceName = todo.sourceDisplay
      ? displayWechatName(todo.sourceDisplay, todo.sourceWxid, {
        groupFallback: '微信群聊',
        contactFallback: '微信联系人',
      })
      : '';
    const source = sourceName ? `（${sourceName}）` : '';
    const dueText = todo.byWhenText ? sanitizeWechatText(todo.byWhenText) : '';
    const due = dueText ? `，时间：${dueText}` : '';
    return `${index + 1}. ${safeSanitizedWechatText(todo.text, '微信待跟进事项')}${source}${due}`;
  });
}

function countTodayMessages(rows: OverviewRow[]): number {
  return rows.reduce((sum, row) => (
    sum + (row.interactionDays.find((day) => day.daysAgo === 0)?.count ?? 0)
  ), 0);
}

function normalizeEnhancedMarkdown(text: string, title: string): string {
  const cleaned = text
    .replace(/```(?:markdown|md)?/gi, '')
    .replace(/```/g, '')
    .split(/\r?\n/)
    .map((line) => sanitizeWechatText(line))
    .join('\n')
    .trim();
  if (!cleaned) throw new Error('AI summary returned empty markdown');
  return cleaned.startsWith('# ') ? cleaned : `# ${title}\n\n${cleaned}`;
}

function extractSummaryFromMarkdown(markdown: string, fallback: string): string {
  const line = markdown
    .split(/\r?\n/)
    .map((item) => item.replace(/^#{1,6}\s+/, '').replace(/^[-*\d.、\s]+/, '').trim())
    .find((item) => (
      item.length >= 12
      && !item.startsWith('生成时间')
      && !item.startsWith('执行要求')
      && !['今日要点', '重点会话', '待跟进', '建议行动'].includes(item)
    ));
  return line ? `${truncate(line, 140)}。`.replace(/。。$/, '。') : fallback;
}

function isUsefulTextMessage(content: string): boolean {
  const cleaned = cleanMessageContent(content);
  if (cleaned.length < 2) return false;
  return !/^\[(图片|语音|视频|表情|文件|位置|链接)\]$/.test(cleaned);
}

function cleanMessageContent(content: string): string {
  return sanitizeWechatText(content.replace(/\s+/g, ' '));
}

function rowDisplayName(row: OverviewRow): string {
  return displayWechatName(row.name, row.id, {
    groupFallback: '微信群聊',
    contactFallback: '微信联系人',
  });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function syncLabel(sync: SyncResult): string {
  if (sync.status === 'completed') return `已同步，新增 ${sync.inserted} 条，扫描 ${sync.seen} 条`;
  if (sync.status === 'skipped') return `跳过同步（${sync.reason ?? '未知原因'}）`;
  return `同步失败：${sync.error ?? '未知错误'}`;
}

function formatTs(ts: number): string {
  if (!ts) return '未知时间';
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
