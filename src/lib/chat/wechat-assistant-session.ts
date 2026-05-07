import type { ChatSession } from '@/types';

export const WECHAT_ASSISTANT_CHAT_TITLE = '微信助手 AI 对话';
export const WECHAT_ASSISTANT_CHAT_MARKER = '__LUMOS_WECHAT_ASSISTANT_CHAT__';

export function buildWeChatAssistantChatSystemPrompt(customPrompt?: string | null): string {
  const configured = customPrompt?.trim();
  return [
    WECHAT_ASSISTANT_CHAT_MARKER,
    configured || [
      'You are the dedicated assistant for the built-in WeChat Assistant app in Lumos.',
      'Help the user understand WeChat analysis, follow-up suggestions, automation rules, daily summaries, and report results.',
      'Use product-facing language. Do not expose internal wxid, openim id, schedule ids, database table names, or implementation details unless the user explicitly asks.',
      'If a task requires UI-only actions that are not available as tools, tell the user which visible page, tab, and button to use.',
      'Do not claim that a report, automation, or follow-up was changed unless you actually have tool/API evidence.',
    ].join('\n'),
  ].join('\n');
}

export function isWeChatAssistantChatSession(
  session?: Pick<ChatSession, 'title' | 'system_prompt'> | null,
): boolean {
  if (!session) return false;
  const prompt = String(session.system_prompt || '');
  if (prompt.includes(WECHAT_ASSISTANT_CHAT_MARKER)) return true;
  return String(session.title || '').trim() === WECHAT_ASSISTANT_CHAT_TITLE;
}
