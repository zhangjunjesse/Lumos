import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  createWeChatAutomation,
  deleteWeChatAutomation,
  listWeChatAutomations,
  triggerWeChatAutomation,
  updateWeChatAutomation,
  type AutomationDraft,
} from '@/lib/wechat-assistant/automations';
import {
  addManualTodo,
  deleteTodo,
  listTodos,
  setTodoStatus,
} from '@/lib/wechat-assistant/db';
import {
  getSyncState,
  readChatMessages,
  searchMessages,
  type ChatReadCandidate,
} from '@/lib/wechat-assistant/mirror-store';
import { runSync } from '@/lib/wechat-assistant/sync-engine';
import type { TodoStatus, WeChatTodo } from '@/lib/wechat-assistant/ai-types';

export const WECHAT_ASSISTANT_MCP_SERVER_NAME = 'lumos-wechat-assistant';

export const WECHAT_ASSISTANT_MCP_SYSTEM_HINT = `
You have access to built-in WeChat Assistant tools (server name: \`lumos-wechat-assistant\`) for this app.

Available tools:
- \`mcp__lumos-wechat-assistant__get_wechat_assistant_status()\`: read sync/message, follow-up, and automation status.
- \`mcp__lumos-wechat-assistant__search_wechat_messages(query, scope?, days?, limit?, offset?)\`: sync first, then search the locally mirrored WeChat messages by keyword. \`limit\` is page size, not a total cap; use \`next_offset\` while \`has_more=true\`.
- \`mcp__lumos-wechat-assistant__read_wechat_chat(chat, scope?, days?, limit?, offset?, before_ts?)\`: sync first, then read messages from one visible chat/contact/group without requiring keyword matches. \`limit\` is page size, not a total cap; use \`next_offset\` or \`before_ts\` for older pages.
- \`mcp__lumos-wechat-assistant__resolve_wechat_followup(query, status?, limit?)\`: resolve a visible follow-up title to candidate ids.
- \`mcp__lumos-wechat-assistant__list_wechat_followups(status?, limit?)\`: list WeChat follow-up tasks.
- \`mcp__lumos-wechat-assistant__create_wechat_followup(text, summary?, next_step?, due_at?)\`: create a manual follow-up.
- \`mcp__lumos-wechat-assistant__complete_wechat_followup(id)\`: mark a follow-up as done.
- \`mcp__lumos-wechat-assistant__delete_wechat_followup(id)\`: delete a follow-up.
- \`mcp__lumos-wechat-assistant__resolve_wechat_automation(query, limit?)\`: resolve a visible automation name to candidate ids.
- \`mcp__lumos-wechat-assistant__list_wechat_automations()\`: list WeChat Assistant automations.
- \`mcp__lumos-wechat-assistant__create_wechat_automation(name?, schedule_text, action_kind?, message_template?, enabled?)\`: create or update a visible automation.
- \`mcp__lumos-wechat-assistant__trigger_wechat_automation(id)\`: run an automation now.
- \`mcp__lumos-wechat-assistant__update_wechat_automation(id, schedule_text?, message_template?)\`: update schedule and/or reminder/report content.
- \`mcp__lumos-wechat-assistant__set_wechat_automation_enabled(id, enabled)\`: enable or pause an automation.
- \`mcp__lumos-wechat-assistant__batch_set_wechat_automations_enabled(ids, enabled)\`: enable or pause multiple automations.
- \`mcp__lumos-wechat-assistant__delete_wechat_automation(id)\`: delete one automation and cancel running work where possible.
- \`mcp__lumos-wechat-assistant__diagnose_wechat_automation(id)\`: explain schedule/run status and latest error.

Rules:
- Use these tools when the user asks about WeChat messages, daily summaries, reminders, automations, or follow-ups.
- Do not call raw \`wechat-export\` tools such as \`wechat_read_chat\` from Agent Chat. Use the \`lumos-wechat-assistant\` tools above because they synchronize the mirror and expose paging.
- If the user names a follow-up or automation by title, resolve or list it first. If a name is ambiguous, list matching items and ask the user to choose; do not guess an id.
- Automation \`message_template\` is the report/reminder content, not a delivery channel. If the user asks to "send it to me via WeChat/IM", explain the current boundary instead of putting that delivery request into \`message_template\` or claiming WeChat IM delivery is configured.
- Do not expose raw wxid/openim/chatroom ids unless the user explicitly asks for technical details.
- After a mutation tool succeeds, summarize the visible result and tell the user which tab can verify it.`;

export const WECHAT_ASSISTANT_READONLY_MCP_SYSTEM_HINT = `
You have read-only access to local WeChat message history through the built-in WeChat Assistant tools (server name: \`lumos-wechat-assistant\`).

Available read-only tools:
- \`mcp__lumos-wechat-assistant__get_wechat_assistant_status()\`: check whether the local WeChat mirror has synced messages and read basic status.
- \`mcp__lumos-wechat-assistant__search_wechat_messages(query, scope?, days?, limit?, offset?)\`: sync first, then search the locally mirrored WeChat messages by keyword and return visible chat names, speakers, timestamps, and snippets. \`limit\` is page size, not a total cap.
- \`mcp__lumos-wechat-assistant__read_wechat_chat(chat, scope?, days?, limit?, offset?, before_ts?)\`: sync first, then read messages from one visible chat/contact/group without requiring keyword matches. \`limit\` is page size, not a total cap.

Rules:
- When the user asks to search by keyword, use \`search_wechat_messages\`; when the user names a contact/group and asks for recent/all messages, use \`read_wechat_chat\` instead of keyword-searching the contact name.
- If the user asks to read WeChat history, use these tools instead of saying you do not have this capability.
- Do not call raw \`wechat-export\` tools such as \`wechat_read_chat\`; those direct database tools can hit locked decrypted files and do not provide the same mirror sync + paging contract.
- Both message tools try to sync the local WeChat mirror before reading. If the tool reports sync failure, explain that result instead of treating older results as complete.
- The 200-message limit is one page only. If \`has_more=true\`, keep reading with \`next_offset\` or an older \`before_ts\` instead of telling the user there is a hard 200-message history cap.
- If you are unsure whether WeChat data is available, call \`get_wechat_assistant_status\` first and explain the sync state in product-facing terms.
- Do not expose raw wxid/openim/chatroom ids unless the user explicitly asks for technical details.
- This Agent Chat access is read-only. If the user asks to send WeChat messages, create/edit automations, or change follow-ups, explain that this chat can read WeChat history but those write actions must be handled in the dedicated WeChat Assistant UI or a future confirmed write-capability path.`;

interface CreateWeChatAssistantMcpServerOptions {
  readOnly?: boolean;
}

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function createWeChatAssistantMcpServer(options: CreateWeChatAssistantMcpServerOptions = {}) {
  const readOnlyTools = [
    createGetWeChatAssistantStatusTool(),
    createSearchWeChatMessagesTool(),
    createReadWeChatChatTool(),
  ];
  const tools = options.readOnly
    ? readOnlyTools
    : [
        ...readOnlyTools,
        createResolveWeChatFollowupTool(),
        createListWeChatFollowupsTool(),
        createCreateWeChatFollowupTool(),
        createCompleteWeChatFollowupTool(),
        createDeleteWeChatFollowupTool(),
        createResolveWeChatAutomationTool(),
        createListWeChatAutomationsTool(),
        createCreateWeChatAutomationTool(),
        createTriggerWeChatAutomationTool(),
        createUpdateWeChatAutomationTool(),
        createSetWeChatAutomationEnabledTool(),
        createBatchSetWeChatAutomationsEnabledTool(),
        createDeleteWeChatAutomationTool(),
        createDiagnoseWeChatAutomationTool(),
      ];

  return createSdkMcpServer({
    name: WECHAT_ASSISTANT_MCP_SERVER_NAME,
    tools,
  });
}

function createGetWeChatAssistantStatusTool() {
  return tool(
    'get_wechat_assistant_status',
    'Read current WeChat Assistant sync, follow-up, and automation status visible in the app.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const sync = getSyncState();
        const followups = listTodos({ status: ['open', 'in_progress', 'suggested'] });
        const automations = listWeChatAutomations();
        return jsonResult({
          schema: 'wechat-assistant-status/v1',
          sync: {
            total_messages: sync.totalMessages,
            last_finished_at: sync.lastFinishedAt ? new Date(sync.lastFinishedAt).toLocaleString('zh-CN') : null,
            last_error: sync.lastError,
            has_synced: sync.totalMessages > 0 || sync.lastFinishedAt > 0,
          },
          followups: {
            active_count: followups.length,
            suggested_count: followups.filter((item) => item.status === 'suggested').length,
          },
          automations: {
            count: automations.length,
            enabled_count: automations.filter((item) => item.enabled).length,
            latest_error_count: automations.filter((item) => item.lastRunError || item.scheduleError).length,
          },
          verify_in_ui: '微信助手 > 概况 / 跟进 / 自动化',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createSearchWeChatMessagesTool() {
  return tool(
    'search_wechat_messages',
    'Search the local WeChat message mirror. Returns product-facing chat names, speakers, timestamps and snippets.',
    {
      query: z.string().min(1).describe('Keyword to search in message text, chat name, or source id.'),
      scope: z.enum(['all', 'personal', 'group']).optional().describe('Search scope. Defaults to all.'),
      days: z.number().int().min(1).max(3650).optional().describe('Optional recent-day window. Omit for all history.'),
      limit: z.number().int().min(1).max(200).optional().describe('Page size. Defaults to 20, max 200. Use next_offset to continue.'),
      offset: z.number().int().min(0).max(10000).optional().describe('Pagination offset. Defaults to 0.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const sync = await syncMirrorBeforeMessageAccess();
        const sinceTs = typeof args.days === 'number'
          ? Math.floor(Date.now() / 1000) - args.days * 86400
          : null;
        const limit = normalizePageLimit(args.limit, 20);
        const offset = normalizeOffset(args.offset);
        const results = searchMessages({
          query: args.query,
          scope: args.scope ?? 'all',
          sinceTs,
          limit,
          offset,
        });
        return jsonResult({
          schema: 'wechat-assistant-message-search/v1',
          query: args.query,
          count: results.length,
          limit,
          offset,
          has_more: results.length >= limit,
          next_offset: results.length >= limit ? offset + limit : null,
          sync,
          results: results.map((item) => ({
            chat: item.display,
            kind: item.isGroup ? '群聊' : '私聊',
            speaker: item.sender === 'me' ? '我' : item.senderDisplay || '对方',
            time: new Date(item.ts * 1000).toLocaleString('zh-CN'),
            message_type: wechatMessageTypeLabel(item.msgType),
            content: wechatMessageContentPreview(item.content, item.msgType),
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createReadWeChatChatTool() {
  return tool(
    'read_wechat_chat',
    'Read recent local WeChat messages from one visible chat/contact/group without keyword matching message text.',
    {
      chat: z.string().min(1).describe('Visible contact/group/chat name, or wxid only if the user explicitly provided it.'),
      scope: z.enum(['all', 'personal', 'group']).optional().describe('Restrict matching to personal chats or groups. Defaults to all.'),
      days: z.number().int().min(1).max(3650).optional().describe('Optional recent-day window. Omit for all history.'),
      limit: z.number().int().min(1).max(200).optional().describe('Page size. Defaults to 50, max 200. Use next_offset or before_ts to continue.'),
      offset: z.number().int().min(0).max(10000).optional().describe('Pagination offset for older messages. Defaults to 0.'),
      before_ts: z.number().int().positive().optional().describe('Optional unix-seconds cursor; read messages older than this timestamp.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const sync = await syncMirrorBeforeMessageAccess();
        const sinceTs = typeof args.days === 'number'
          ? Math.floor(Date.now() / 1000) - args.days * 86400
          : null;
        const limit = normalizePageLimit(args.limit, 50);
        const offset = normalizeOffset(args.offset);
        const result = readChatMessages({
          chat: args.chat,
          scope: args.scope ?? 'all',
          sinceTs,
          beforeTs: args.before_ts ?? null,
          limit,
          offset,
        });
        return jsonResult({
          schema: 'wechat-assistant-chat-read/v1',
          query: args.chat,
          status: result.status,
          chat: result.chat ? chatCandidateSummary(result.chat) : null,
          candidates: result.status === 'ok'
            ? []
            : result.candidates.map((candidate, index) => chatCandidateSummary(candidate, index + 1)),
          count: result.messages.length,
          limit: result.limit,
          offset: result.offset,
          has_more: result.hasMore,
          next_offset: result.nextOffset,
          sync,
          guidance: chatReadGuidance(result.status),
          messages: result.messages.map((message) => ({
            speaker: message.sender === 'me' ? '我' : message.senderDisplay || '对方',
            time: new Date(message.ts * 1000).toLocaleString('zh-CN'),
            message_type: wechatMessageTypeLabel(message.msgType),
            content: wechatMessageContentPreview(message.content, message.msgType),
            attachment: message.attachment
              ? {
                  kind: message.attachment.kind,
                  title: message.attachment.title,
                  size: message.attachment.size ?? null,
                  size_label: message.attachment.sizeLabel ?? null,
                  ext: message.attachment.ext ?? null,
                  exists: message.attachment.exists ?? null,
                }
              : null,
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

async function syncMirrorBeforeMessageAccess() {
  const before = getSyncState();
  const result = await runSync();
  const after = getSyncState();
  return {
    attempted: true,
    status: result.status,
    reason: result.reason ?? null,
    inserted: result.inserted,
    seen: result.seen,
    error: result.error ?? null,
    previous_finished_at: before.lastFinishedAt ? new Date(before.lastFinishedAt).toLocaleString('zh-CN') : null,
    last_finished_at: after.lastFinishedAt ? new Date(after.lastFinishedAt).toLocaleString('zh-CN') : null,
    total_messages: after.totalMessages,
  };
}

function createResolveWeChatFollowupTool() {
  return tool(
    'resolve_wechat_followup',
    'Resolve a user-facing follow-up title or description to candidate follow-up ids.',
    {
      query: z.string().min(1).describe('Visible title, contact, or phrase mentioned by the user.'),
      status: z.enum(['open', 'in_progress', 'done', 'suggested', 'dismissed']).optional()
        .describe('Optional status filter. Defaults to active follow-ups.'),
      limit: z.number().int().min(1).max(10).optional().describe('Max candidates. Defaults to 5.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const statuses: TodoStatus | TodoStatus[] = args.status ?? ['open', 'in_progress', 'suggested'];
        const items = listTodos({ status: statuses });
        const candidates = rankFollowups(items, args.query).slice(0, args.limit ?? 5);
        return jsonResult({
          schema: 'wechat-assistant-followup-resolve/v1',
          query: args.query,
          count: candidates.length,
          ambiguous: candidates.length !== 1 || (candidates[0]?.score ?? 0) < 60,
          candidates: candidates.map(({ item, score }) => followupSummary(item, score)),
          guidance: candidates.length === 0
            ? '没有匹配到跟进任务，可先列出跟进或创建新跟进。'
            : candidates.length === 1 && candidates[0].score >= 60
              ? '可以使用这个 id 执行后续操作。'
              : '请让用户按可见标题选择一个候选，不要猜 id。',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createListWeChatFollowupsTool() {
  return tool(
    'list_wechat_followups',
    'List WeChat follow-up tasks visible in the Follow-ups tab.',
    {
      status: z.enum(['open', 'in_progress', 'done', 'suggested', 'dismissed']).optional()
        .describe('Optional status filter. Defaults to open and in_progress.'),
      limit: z.number().int().min(1).max(30).optional().describe('Max tasks. Defaults to 10.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const statuses: TodoStatus | TodoStatus[] = args.status ?? ['open', 'in_progress'];
        const items = listTodos({ status: statuses }).slice(0, args.limit ?? 10);
        return jsonResult({
          schema: 'wechat-assistant-followups/v1',
          count: items.length,
          followups: items.map((item) => ({
            id: item.id,
            title: item.text,
            status: item.status,
            summary: item.summary,
            next_step: item.nextStep,
            source: item.sourceDisplay,
            due_at: item.dueAt ? new Date(item.dueAt).toLocaleString('zh-CN') : null,
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createCreateWeChatFollowupTool() {
  return tool(
    'create_wechat_followup',
    'Create a manual WeChat follow-up task.',
    {
      text: z.string().min(1).describe('Short follow-up title.'),
      summary: z.string().optional().describe('Optional background summary.'),
      next_step: z.string().optional().describe('Optional next action.'),
      by_when_text: z.string().optional().describe('Optional human-readable deadline.'),
      due_at: z.number().int().positive().optional().describe('Optional deadline timestamp in milliseconds.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const item = addManualTodo({
          text: args.text,
          summary: args.summary ?? null,
          nextStep: args.next_step ?? null,
          byWhenText: args.by_when_text ?? null,
          dueAt: args.due_at ?? null,
          followupType: 'other',
        });
        return jsonResult({
          schema: 'wechat-assistant-followup-created/v1',
          followup: {
            id: item.id,
            title: item.text,
            status: item.status,
            summary: item.summary,
            next_step: item.nextStep,
          },
          verify_in_ui: '微信助手 > 跟进',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createCompleteWeChatFollowupTool() {
  return tool(
    'complete_wechat_followup',
    'Mark a WeChat follow-up task as done.',
    {
      id: z.string().min(1).describe('Follow-up id from list_wechat_followups.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const item = setTodoStatus(args.id, 'done');
        if (!item) throw new Error('未找到这个跟进任务');
        return jsonResult({
          schema: 'wechat-assistant-followup-completed/v1',
          followup: {
            id: item.id,
            title: item.text,
            status: item.status,
          },
          verify_in_ui: '微信助手 > 跟进',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createDeleteWeChatFollowupTool() {
  return tool(
    'delete_wechat_followup',
    'Delete a WeChat follow-up task visible in the Follow-ups tab.',
    {
      id: z.string().min(1).describe('Follow-up id from list_wechat_followups or resolve_wechat_followup.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const current = listTodos().find((item) => item.id === args.id) ?? null;
        if (!current) throw new Error('未找到这个跟进任务');
        const deleted = deleteTodo(args.id);
        if (!deleted) throw new Error('删除失败');
        return jsonResult({
          schema: 'wechat-assistant-followup-deleted/v1',
          followup: {
            id: current.id,
            title: current.text,
            status: current.status,
          },
          verify_in_ui: '微信助手 > 跟进',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createResolveWeChatAutomationTool() {
  return tool(
    'resolve_wechat_automation',
    'Resolve a user-facing automation name to candidate automation ids.',
    {
      query: z.string().min(1).describe('Visible automation name or phrase mentioned by the user.'),
      limit: z.number().int().min(1).max(10).optional().describe('Max candidates. Defaults to 5.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const candidates = rankAutomations(listWeChatAutomations(), args.query).slice(0, args.limit ?? 5);
        return jsonResult({
          schema: 'wechat-assistant-automation-resolve/v1',
          query: args.query,
          count: candidates.length,
          ambiguous: candidates.length !== 1 || (candidates[0]?.score ?? 0) < 60,
          candidates: candidates.map(({ item, score }) => automationSummary(item, score)),
          guidance: candidates.length === 0
            ? '没有匹配到自动化，可先列出自动化或创建新自动化。'
            : candidates.length === 1 && candidates[0].score >= 60
              ? '可以使用这个 id 执行后续操作。'
              : '请让用户按可见名称选择一个候选，不要猜 id。',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createListWeChatAutomationsTool() {
  return tool(
    'list_wechat_automations',
    'List WeChat Assistant automations visible in the Automations tab.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const automations = listWeChatAutomations();
        return jsonResult({
          schema: 'wechat-assistant-automations/v1',
          count: automations.length,
          automations: automations.map((item) => ({
            id: item.id,
            name: item.name,
            enabled: item.enabled,
            schedule: item.cronLabel || item.cron,
            action: item.action.kind,
            message_template: item.action.messageTemplate,
            latest_run_status: item.lastRunStatus ?? null,
            latest_run_error: item.lastRunError ?? null,
            schedule_error: item.scheduleError ?? null,
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createCreateWeChatAutomationTool() {
  return tool(
    'create_wechat_automation',
    'Create a WeChat Assistant automation. If the visible name already exists, update that automation instead of creating a duplicate.',
    {
      name: z.string().min(1).max(60).optional()
        .describe('Visible automation name. Defaults to 每日微信总结 for summary reports, otherwise a short reminder name.'),
      schedule_text: z.string().min(1).max(120)
        .describe('Natural language schedule, e.g. "每天晚上 9 点", "每周一 09:00", "明天 15:30".'),
      action_kind: z.enum(['wechat_summary', 'custom']).optional()
        .describe('wechat_summary generates a daily WeChat report; custom sends a reminder notification. Defaults by name/content.'),
      message_template: z.string().min(1).max(500).optional()
        .describe('Report requirement or reminder text.'),
      enabled: z.boolean().optional().describe('Whether the automation should be enabled. Defaults to true.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const actionKind = args.action_kind ?? inferAutomationActionKind(
          `${args.name ?? ''}\n${args.message_template ?? ''}`,
        );
        const draft = buildAutomationDraftFromToolArgs({
          name: args.name,
          scheduleText: args.schedule_text,
          actionKind,
          messageTemplate: args.message_template,
          enabled: args.enabled ?? true,
        });
        const existing = listWeChatAutomations()
          .find((item) => normalizeLookupText(item.name) === normalizeLookupText(draft.name)) ?? null;
        const item = existing
          ? await updateWeChatAutomation(existing.id, draft)
          : await createWeChatAutomation(draft);
        if (!item) throw new Error('自动化创建失败');
        return jsonResult({
          schema: existing
            ? 'wechat-assistant-automation-updated/v1'
            : 'wechat-assistant-automation-created/v1',
          created: !existing,
          automation: automationSummary(item),
          verify_in_ui: '微信助手 > 自动化',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createTriggerWeChatAutomationTool() {
  return tool(
    'trigger_wechat_automation',
    'Run a WeChat Assistant automation now.',
    {
      id: z.string().min(1).describe('Automation id from list_wechat_automations.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const item = await triggerWeChatAutomation(args.id);
        if (!item) throw new Error('未找到这条自动化');
        return jsonResult({
          schema: 'wechat-assistant-automation-triggered/v1',
          automation: {
            id: item.id,
            name: item.name,
            enabled: item.enabled,
            latest_run_status: item.lastRunStatus ?? 'running',
          },
          verify_in_ui: '微信助手 > 自动化 > 最近结果',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createUpdateWeChatAutomationTool() {
  return tool(
    'update_wechat_automation',
    'Update schedule and/or reminder/report content for a WeChat Assistant automation.',
    {
      id: z.string().min(1).describe('Automation id from list_wechat_automations.'),
      schedule_text: z.string().min(1).max(120).optional()
        .describe('Natural language schedule, e.g. "每天晚上 10 点", "每周一 09:00", "明天 15:30".'),
      message_template: z.string().min(1).max(500).optional()
        .describe('New reminder text or daily summary requirement.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const current = listWeChatAutomations().find((item) => item.id === args.id) ?? null;
        if (!current) throw new Error('未找到这条自动化');
        const patch: Partial<Omit<AutomationLite, 'id' | 'createdAt'>> = {};
        if (args.schedule_text?.trim()) {
          Object.assign(patch, buildSchedulePatch(args.schedule_text, current));
        }
        if (args.message_template?.trim()) {
          patch.action = {
            ...current.action,
            messageTemplate: args.message_template.trim(),
          };
        }
        if (Object.keys(patch).length === 0) {
          throw new Error('没有可更新的时间或内容');
        }
        const item = await updateWeChatAutomation(args.id, patch);
        if (!item) throw new Error('未找到这条自动化');
        return jsonResult({
          schema: 'wechat-assistant-automation-updated/v1',
          automation: automationSummary(item),
          verify_in_ui: '微信助手 > 自动化',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createSetWeChatAutomationEnabledTool() {
  return tool(
    'set_wechat_automation_enabled',
    'Enable or pause a WeChat Assistant automation.',
    {
      id: z.string().min(1).describe('Automation id from list_wechat_automations.'),
      enabled: z.boolean().describe('true to enable, false to pause.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const item = await updateWeChatAutomation(args.id, { enabled: args.enabled });
        if (!item) throw new Error('未找到这条自动化');
        return jsonResult({
          schema: 'wechat-assistant-automation-updated/v1',
          automation: {
            id: item.id,
            name: item.name,
            enabled: item.enabled,
            schedule: item.cronLabel || item.cron,
          },
          verify_in_ui: '微信助手 > 自动化',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createBatchSetWeChatAutomationsEnabledTool() {
  return tool(
    'batch_set_wechat_automations_enabled',
    'Enable or pause multiple WeChat Assistant automations.',
    {
      ids: z.array(z.string().min(1)).min(1).max(20).describe('Automation ids from list_wechat_automations.'),
      enabled: z.boolean().describe('true to enable, false to pause.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const updated = [];
        const missing = [];
        for (const id of args.ids) {
          const item = await updateWeChatAutomation(id, { enabled: args.enabled });
          if (item) updated.push(automationSummary(item));
          else missing.push(id);
        }
        return jsonResult({
          schema: 'wechat-assistant-automation-batch-updated/v1',
          enabled: args.enabled,
          updated_count: updated.length,
          missing_count: missing.length,
          updated,
          missing,
          verify_in_ui: '微信助手 > 自动化',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createDeleteWeChatAutomationTool() {
  return tool(
    'delete_wechat_automation',
    'Delete one WeChat Assistant automation. Running executions are cancelled by the automation service where possible.',
    {
      id: z.string().min(1).describe('Automation id from list_wechat_automations.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const current = listWeChatAutomations().find((item) => item.id === args.id) ?? null;
        if (!current) throw new Error('未找到这条自动化');
        const deleted = await deleteWeChatAutomation(args.id);
        if (!deleted) throw new Error('删除失败');
        return jsonResult({
          schema: 'wechat-assistant-automation-deleted/v1',
          automation: {
            id: current.id,
            name: current.name,
          },
          verify_in_ui: '微信助手 > 自动化',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createDiagnoseWeChatAutomationTool() {
  return tool(
    'diagnose_wechat_automation',
    'Read one WeChat Assistant automation schedule and latest run diagnostic state.',
    {
      id: z.string().min(1).describe('Automation id from list_wechat_automations.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const item = listWeChatAutomations().find((automation) => automation.id === args.id) ?? null;
        if (!item) throw new Error('未找到这条自动化');
        return jsonResult({
          schema: 'wechat-assistant-automation-diagnostic/v1',
          automation: automationSummary(item),
          diagnostic: {
            schedule_state: item.scheduleError
              ? '调度未正常接入'
              : item.scheduleId
                ? '已接入调度'
                : '仅保存规则，暂未接入调度',
            latest_run: item.lastRunStatus ? runStatusText(item.lastRunStatus) : '尚未触发',
            latest_run_at: item.lastRunAt ? new Date(item.lastRunAt).toLocaleString('zh-CN') : null,
            latest_error: item.lastRunError ?? null,
            next_run_at: item.nextRunAt ? new Date(item.nextRunAt).toLocaleString('zh-CN') : null,
            ui_hint: item.latestRunId && item.scheduleId
              ? '可在自动化卡片里点“最新结果”或“记录”查看完整执行详情。'
              : '可在自动化页查看这条规则的当前状态。',
          },
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

type AutomationLite = ReturnType<typeof listWeChatAutomations>[number];

function normalizePageLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.min(200, Math.floor(value ?? fallback)));
}

function normalizeOffset(value: number | undefined): number {
  return Math.max(0, Math.min(10000, Math.floor(value ?? 0)));
}

function chatCandidateSummary(candidate: ChatReadCandidate, index?: number) {
  return {
    ...(typeof index === 'number' ? { index } : {}),
    name: candidate.display,
    kind: candidate.isGroup ? '群聊' : '私聊',
    last_message_at: candidate.lastTs ? new Date(candidate.lastTs * 1000).toLocaleString('zh-CN') : null,
    message_count: candidate.messageCount,
    unread_count: candidate.unreadCount,
    summary: candidate.summary || null,
  };
}

function chatReadGuidance(status: 'ok' | 'not_found' | 'ambiguous'): string {
  if (status === 'ok') return '已按聊天对象读取消息；如还需要更早记录，可继续使用 next_offset 或 before_ts。';
  if (status === 'not_found') return '没有匹配到这个可见联系人或群名。可以先到微信助手的会话列表确认名称，或放宽 scope。';
  return '匹配到多个候选，请让用户按可见名称、群聊/私聊和最近消息时间选择，不要猜。';
}

function wechatMessageTypeLabel(msgType: number): string {
  switch (msgType) {
    case 1: return '文本';
    case 3: return '图片';
    case 34: return '语音';
    case 43: return '视频';
    case 47: return '表情';
    case 49: return '链接/卡片';
    case 10000:
    case 10002:
      return '系统';
    default:
      return msgType > 0 ? `非文本消息 type=${msgType}` : '未知';
  }
}

function wechatMessageContentPreview(content: string, msgType: number): string {
  const text = content.trim();
  if (looksBinaryWechatText(text)) return msgType === 1 ? '[暂不支持的消息]' : `[${wechatMessageTypeLabel(msgType)}]`;
  if (msgType === 1) return text;
  if (text && text.length <= 200 && !text.startsWith('<')) return text;
  return `[${wechatMessageTypeLabel(msgType)}]`;
}

function looksBinaryWechatText(text: string): boolean {
  if (!text) return false;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  let controlCount = 0;
  let visibleCount = 0;
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    const code = ch.charCodeAt(0);
    if ((code >= 0 && code < 32) || (code >= 127 && code <= 159)) controlCount += 1;
    else visibleCount += 1;
  }
  const length = Math.max(text.length, 1);
  if (replacementCount >= 3 || replacementCount / length > 0.03) return true;
  return controlCount >= 3 && controlCount > visibleCount * 0.15;
}

function followupSummary(item: WeChatTodo, score?: number) {
  return {
    id: item.id,
    title: item.text,
    status: item.status,
    summary: item.summary,
    next_step: item.nextStep,
    source: item.sourceDisplay,
    due_at: item.dueAt ? new Date(item.dueAt).toLocaleString('zh-CN') : null,
    ...(typeof score === 'number' ? { match_score: score } : {}),
  };
}

function automationSummary(item: AutomationLite, score?: number) {
  return {
    id: item.id,
    name: item.name,
    enabled: item.enabled,
    kind: item.kind,
    schedule: item.cronLabel || item.cron,
    next_run_at: item.nextRunAt ? new Date(item.nextRunAt).toLocaleString('zh-CN') : null,
    action: item.action.kind,
    message_template: item.action.messageTemplate,
    latest_run_status: item.lastRunStatus ?? null,
    latest_run_error: item.lastRunError ?? null,
    schedule_error: item.scheduleError ?? null,
    ...(typeof score === 'number' ? { match_score: score } : {}),
  };
}

function rankFollowups(items: WeChatTodo[], query: string): Array<{ item: WeChatTodo; score: number }> {
  return items
    .map((item) => ({
      item,
      score: bestTextScore(query, [
        item.text,
        item.summary,
        item.nextStep,
        item.sourceDisplay,
        item.sourceSenderDisplay,
        item.byWhenText,
      ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt);
}

function rankAutomations(items: AutomationLite[], query: string): Array<{ item: AutomationLite; score: number }> {
  return items
    .map((item) => ({
      item,
      score: bestTextScore(query, [
        item.name,
        item.cronLabel,
        item.action.kind === 'wechat_summary' ? '每日微信总结 微信日报 微信报告 微信总结' : '提醒 自动化',
        item.action.messageTemplate,
      ]),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.createdAt - a.item.createdAt);
}

function bestTextScore(query: string, fields: Array<string | null | undefined>): number {
  const q = normalizeLookupText(query);
  if (!q) return 0;
  let best = 0;
  for (const field of fields) {
    const text = normalizeLookupText(field || '');
    if (!text) continue;
    if (text === q) best = Math.max(best, 100);
    else if (text.includes(q)) best = Math.max(best, Math.min(95, 70 + Math.floor(q.length / 2)));
    else if (q.includes(text) && text.length >= 2) best = Math.max(best, Math.min(90, 60 + Math.floor(text.length / 2)));
    else best = Math.max(best, overlapScore(q, text));
  }
  return best;
}

function overlapScore(query: string, text: string): number {
  const tokens = tokenizeLookupText(query);
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const token of tokens) {
    if (token.length >= 2 && text.includes(token)) hits += 1;
  }
  if (hits === 0) return 0;
  return Math.min(58, Math.round((hits / tokens.length) * 58));
}

function tokenizeLookupText(value: string): string[] {
  const text = normalizeLookupText(value);
  const tokens = new Set<string>();
  for (const part of text.split(/[^a-z0-9\u4e00-\u9fa5]+/i)) {
    if (part.length >= 2) tokens.add(part);
  }
  for (let i = 0; i < text.length - 1; i += 1) {
    const token = text.slice(i, i + 2);
    if (/[\u4e00-\u9fa5]{2}/.test(token)) tokens.add(token);
  }
  return Array.from(tokens);
}

function normalizeLookupText(value: string): string {
  return value
    .replace(/[\s"'“”‘’「」『』《》【】（）()\[\]{}:：,，.。!！?？/\\_-]/g, '')
    .toLowerCase();
}

function inferAutomationActionKind(text: string): 'wechat_summary' | 'custom' {
  return /微信.{0,8}(总结|汇总|日报|报告)|(?:总结|汇总|日报|报告).{0,8}微信/.test(text)
    ? 'wechat_summary'
    : 'custom';
}

function buildAutomationDraftFromToolArgs(input: {
  name?: string;
  scheduleText: string;
  actionKind: 'wechat_summary' | 'custom';
  messageTemplate?: string;
  enabled: boolean;
}): AutomationDraft {
  const scheduleText = input.scheduleText.trim();
  const time = inferSchedule(scheduleText) ?? '09:00';
  const recurring = input.actionKind === 'wechat_summary'
    || /每天|每日|每周|每隔|每\d+\s*小时/.test(scheduleText);
  const name = normalizeAutomationName(input.name, input.actionKind, input.messageTemplate);
  const messageTemplate = (input.messageTemplate || defaultAutomationMessage(input.actionKind)).trim();
  return {
    name,
    kind: recurring ? 'reminder_recurring' : 'reminder_once',
    cron: recurring ? inferCron(scheduleText, time) : cronFromTime(time),
    cronLabel: recurring ? cronLabel(scheduleText, time) : `${relativeDateLabel(scheduleText)} ${time}`,
    action: {
      kind: input.actionKind,
      messageTemplate,
    },
    enabled: input.enabled,
    nextRunAt: recurring ? undefined : inferOneTimeTs(scheduleText, time),
  };
}

function normalizeAutomationName(
  name: string | undefined,
  actionKind: 'wechat_summary' | 'custom',
  messageTemplate: string | undefined,
): string {
  const raw = (name || '').trim()
    || (actionKind === 'wechat_summary' ? '每日微信总结' : '')
    || (messageTemplate || '').trim()
    || '微信提醒';
  return raw
    .replace(/^[：:，,\s"'“”‘’「」『』《》【】]+/, '')
    .replace(/["'“”‘’「」『』《》【】]+$/, '')
    .slice(0, 60)
    || (actionKind === 'wechat_summary' ? '每日微信总结' : '微信提醒');
}

function defaultAutomationMessage(actionKind: 'wechat_summary' | 'custom'): string {
  return actionKind === 'wechat_summary'
    ? '汇总今天微信消息，提炼重点、待办和需要跟进的人。'
    : '微信助手提醒。';
}

function buildSchedulePatch(
  scheduleText: string,
  target: AutomationLite,
): Partial<Omit<AutomationLite, 'id' | 'createdAt'>> {
  const text = scheduleText.trim();
  const time = inferSchedule(text) ?? inferTimeFromCron(target.cron) ?? '09:00';
  const recurring = /每天|每日|每周|每隔|每\d+\s*小时/.test(text)
    || (!/明天|后天|今天|今晚|明早|明晚/.test(text) && target.kind === 'reminder_recurring');
  return {
    kind: recurring ? 'reminder_recurring' : 'reminder_once',
    cron: recurring ? inferCron(text, time) : cronFromTime(time),
    cronLabel: recurring ? cronLabel(text, time) : `${relativeDateLabel(text)} ${time}`,
    nextRunAt: recurring ? undefined : inferOneTimeTs(text, time),
  };
}

function inferSchedule(message: string): string | null {
  const colon = /(\d{1,2})\s*[:：]\s*(\d{1,2})/.exec(message);
  if (colon) return formatTime(adjustMeridiem(Number(colon[1]), message), Number(colon[2]));
  const hourOnly = /(\d{1,2})\s*(点|时)/.exec(message);
  if (hourOnly) return formatTime(adjustMeridiem(Number(hourOnly[1]), message), 0);
  return null;
}

function inferCron(message: string, time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  const hourStep = /每(?:隔)?\s*(\d{1,2})\s*小时/.exec(message);
  if (hourStep) return `${minute || 0} */${Math.max(1, Number(hourStep[1]))} * * *`;
  const weekly = /每周([日天一二三四五六0-6])/.exec(message);
  if (weekly) return `${minute || 0} ${hour || 9} * * ${weekdayNumber(weekly[1])}`;
  return `${minute || 0} ${hour || 9} * * *`;
}

function cronFromTime(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute || 0} ${hour || 9} * * *`;
}

function inferTimeFromCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour] = parts;
  if (!/^\d{1,2}$/.test(minute) || !/^\d{1,2}$/.test(hour)) return null;
  return formatTime(Number(hour), Number(minute));
}

function inferOneTimeTs(message: string, time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  const d = new Date();
  if (/后天/.test(message)) d.setDate(d.getDate() + 2);
  else if (/明天|明早|明晚/.test(message)) d.setDate(d.getDate() + 1);
  d.setHours(hour || 9, minute || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function relativeDateLabel(message: string): string {
  if (/后天/.test(message)) return '后天';
  if (/明天|明早|明晚/.test(message)) return '明天';
  if (/今天|今晚/.test(message)) return '今天';
  return '明天';
}

function cronLabel(message: string, time: string): string {
  const hourStep = /每(?:隔)?\s*(\d{1,2})\s*小时/.exec(message);
  if (hourStep) return `每 ${Number(hourStep[1])} 小时`;
  const weekly = /每周([日天一二三四五六0-6])/.exec(message);
  if (weekly) return `每周${weekly[1]} ${time}`;
  return `每天 ${time}`;
}

function weekdayNumber(raw: string): number {
  const map: Record<string, number> = {
    日: 0,
    天: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
  };
  if (/^[0-6]$/.test(raw)) return Number(raw);
  return map[raw] ?? 1;
}

function adjustMeridiem(hour: number, message: string): number {
  if (/(下午|晚上|傍晚|今晚|夜里)/.test(message) && hour >= 1 && hour <= 11) {
    return hour + 12;
  }
  if (/(中午)/.test(message) && hour >= 1 && hour <= 10) {
    return hour + 12;
  }
  return hour;
}

function formatTime(hour: number, minute: number): string {
  return `${String(Math.min(23, Math.max(0, hour))).padStart(2, '0')}:${String(
    Math.min(59, Math.max(0, minute)),
  ).padStart(2, '0')}`;
}

function runStatusText(status: AutomationLite['lastRunStatus']): string {
  if (status === 'running') return '运行中';
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  if (status === 'cancelled') return '已取消';
  return '未运行';
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2),
    }],
    isError: true,
  };
}
