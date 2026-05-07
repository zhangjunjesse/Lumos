import { z } from 'zod';

import type { LlmMessage } from './ai-snapshot-crop';
import type { AiPromptSourceRef } from './ai-prompt';
import type { WeChatEventInput, WeChatTodoSuggestionInput } from './ai-types';
import { displayWechatName, safeSanitizedWechatText, sanitizeWechatText } from './wechat-text';

export const aiResponseSchema = z.object({
  events: z.array(
    z.object({
      title: z.string().min(1).max(60),
      urgency: z.enum(['urgent', 'important', 'attention']),
      contactWxid: z.string(),
      contactDisplay: z.string(),
      isGroup: z.boolean(),
      evidenceMsgIds: z.array(z.number()).min(1).max(8),
      suggestedAction: z.string().min(1).max(120),
    }),
  ),
  todos: z.array(
    z.object({
      text: z.string().min(1).max(80),
      source: z.enum(['self', 'other']),
      sourceMsgId: z.number(),
      byWhenText: z.string().max(40).nullable(),
      confidence: z.enum(['high', 'medium']),
    }),
  ),
});

export type AiRawResponse = z.infer<typeof aiResponseSchema>;

export function enrichEvents(
  raw: AiRawResponse['events'],
  byIdx: Map<number, LlmMessage>,
  sourcesByKey: Map<string, AiPromptSourceRef> = new Map(),
): WeChatEventInput[] {
  const out: WeChatEventInput[] = [];
  for (const event of raw) {
    const validIds = event.evidenceMsgIds.filter((id) => byIdx.has(id));
    if (validIds.length === 0) continue;
    const sourceRef = sourcesByKey.get(event.contactWxid) ?? null;
    const firstMsg = byIdx.get(validIds[0]) ?? null;
    const contactWxid = sourceRef?.wxid ?? firstMsg?.wxid ?? event.contactWxid;
    const isGroup = sourceRef?.isGroup ?? firstMsg?.isGroup ?? event.isGroup;
    const contactDisplay = sourceRef?.display
      ?? displayWechatName(event.contactDisplay, contactWxid, {
        groupFallback: '微信群聊',
        contactFallback: '微信联系人',
      });
    const evidenceTexts = validIds.map((id) => byIdx.get(id)!.text);
    const lastAt = Math.max(...validIds.map((id) => byIdx.get(id)!.ts));
    out.push({
      title: safeSanitizedWechatText(event.title, '微信待处理事件'),
      urgency: event.urgency,
      contactWxid,
      contactDisplay,
      isGroup,
      evidenceMsgIds: validIds,
      evidenceTexts,
      suggestedAction: safeSanitizedWechatText(event.suggestedAction, '查看微信原文后处理'),
      lastAt,
    });
  }
  return out;
}

export function enrichTodos(
  raw: AiRawResponse['todos'],
  byIdx: Map<number, LlmMessage>,
): WeChatTodoSuggestionInput[] {
  const out: WeChatTodoSuggestionInput[] = [];
  for (const todo of raw) {
    const msg = byIdx.get(todo.sourceMsgId);
    if (!msg) continue;
    out.push({
      text: safeSanitizedWechatText(todo.text, '微信待跟进事项'),
      source: todo.source,
      sourceMsgId: todo.sourceMsgId,
      sourceText: sanitizeWechatText(msg.text) || null,
      sourceDisplay: displayWechatName(msg.display, msg.wxid, {
        groupFallback: '微信群聊',
        contactFallback: '微信联系人',
      }),
      sourceSenderDisplay: msg.sender === 'me' ? '我' : msg.senderDisplay ?? null,
      sourceWxid: msg.wxid,
      byWhenText: todo.byWhenText ? sanitizeWechatText(todo.byWhenText) || null : null,
      dueAt: null,
      confidence: todo.confidence,
    });
  }
  return out;
}
