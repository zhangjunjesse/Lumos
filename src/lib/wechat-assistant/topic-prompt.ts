/**
 * Prompt construction + response schema for AI topic extraction.
 *
 * Pure module — `topic-extractor.ts` calls the provider; this file just
 * builds the user prompt from a chunk of messages and exposes the zod
 * schema the LLM output must validate against.
 */

import { z } from 'zod';

import type { ChatMessagesBundle } from './mirror-store';
import type { TopicScope } from './mirror-store';
import { displayWechatName, safeSanitizedWechatText } from './wechat-text';

export const topicResponseSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(1).max(40),
        summary: z.string().min(1).max(200),
        messageCount: z.number().int().min(0).default(0),
      }),
    )
    .max(20),
});

export type TopicResponse = z.infer<typeof topicResponseSchema>;

/**
 * Render a single chunk of chat messages as the user prompt.
 *
 * Layout:
 *   --- 私聊：张三 ---
 *   2026-05-04 14:32  对方  这周末有空吗
 *   2026-05-04 14:33  我    应该可以
 *   ...
 *
 * Group chats include the best available member display name; old mirror
 * data may still fall back to "群成员" until the user rebuilds the mirror.
 */
export function buildUserPrompt(input: {
  scope: TopicScope;
  bundles: ChatBundleSlice[];
  windowDays: number;
}): string {
  const lines: string[] = [];
  lines.push(`分析窗口：最近 ${input.windowDays} 天`);
  lines.push(`类型：${input.scope === 'personal' ? '私聊' : '群聊'}`);
  lines.push('');

  for (const bundle of input.bundles) {
    const display = displayWechatName(bundle.display, bundle.wxid, {
      groupFallback: '微信群聊',
      contactFallback: '微信联系人',
    });
    const header = bundle.isGroup ? `群聊：${display}` : `私聊：${display}`;
    lines.push(`--- ${header} ---`);
    for (const m of bundle.messages) {
      const date = formatTimestamp(m.ts);
      const who = m.sender === 'me'
        ? '我'
        : bundle.isGroup
          ? displayWechatName(m.senderDisplay, null, { contactFallback: '群成员' })
          : '对方';
      const content = safeSanitizedWechatText(m.content, '[消息内容已隐藏]');
      lines.push(`${date}  ${who}  ${truncate(content, 240)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Slice of a chat bundle — used when chunking large bundles into batches. */
export interface ChatBundleSlice {
  wxid: string;
  display: string;
  isGroup: boolean;
  messages: ChatMessagesBundle['messages'];
}

export function renderSystemPrompt(template: string, vars: { scope: TopicScope; windowDays: number }): string {
  return template
    .replaceAll('{scope}', vars.scope === 'personal' ? '一对一私聊' : '群聊')
    .replaceAll('{windowDays}', String(vars.windowDays));
}

function formatTimestamp(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
