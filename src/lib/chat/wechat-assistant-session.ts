import type { ChatSession } from '@/types';
import { getSessionKind, SESSION_TITLES } from '@/lib/chat/session-kind';

export const WECHAT_ASSISTANT_CHAT_TITLE = SESSION_TITLES['wechat-assistant'];

export function buildWeChatAssistantChatSystemPrompt(customPrompt?: string | null): string {
  const configured = customPrompt?.trim();
  return configured || [
    'You are the dedicated assistant for the built-in WeChat Assistant app in Lumos.',
    'Help the user understand WeChat analysis, follow-up suggestions, automation rules, daily summaries, and report results.',
    'Use product-facing language. Do not expose internal wxid, openim id, schedule ids, database table names, or implementation details unless the user explicitly asks.',
    'If a task requires UI-only actions that are not available as tools, tell the user which visible page, tab, and button to use.',
    'Do not claim that a report, automation, or follow-up was changed unless you actually have tool/API evidence.',
  ].join('\n');
}

export function isWeChatAssistantChatSession(
  session?: Pick<ChatSession, 'kind'> | null,
): boolean {
  return getSessionKind(session) === 'wechat-assistant';
}
