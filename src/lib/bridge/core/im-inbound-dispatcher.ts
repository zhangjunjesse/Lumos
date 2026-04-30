/**
 * IM Inbound Dispatcher (Multi-Provider, Non-Feishu)
 *
 * 把 IMAdapter 的 InboundMessage 接到 lumos AI 对话循环。
 * 与 inbound-pipeline.ts 的 handleFeishuMessage 平行，但走 IM 通用契约。
 *
 * 对每条消息：
 *   1. 通过 BindingService 查 binding（platform=providerId, channel_id=chatId）
 *   2. 没有 binding → 跳过（要求用户显式绑定，不主动建群对话）
 *   3. binding.sessionId → ConversationEngine.sendMessage 进 AI 循环
 *   4. 回复 visibleText → @/lib/im sendToProvider 送回用户
 *
 * 与 feishu pipeline 的差异：
 *   - 不做 streaming card（feishu 特有）
 *   - 不做 user OAuth token 校验（IM 用应用凭据，不依赖个人 token）
 *   - 不做事件去重表跟踪（先简单实现；M10+ 再加 inFlight set 防重）
 */

import { BindingService } from './binding-service';
import { ConversationEngine } from '../conversation-engine';
import { sendToProvider } from '@/lib/im';
import type { InboundMessage } from '@/lib/im';

export interface DispatchResult {
  ok: boolean;
  reason?: string;
  sessionId?: string;
  replyMessageId?: string;
}

const IGNORE_REASONS = {
  NO_BINDING: 'no active binding for this chat',
  EMPTY_TEXT: 'empty message text',
} as const;

const inFlight = new Set<string>();

export async function dispatchInbound(
  providerId: string,
  message: InboundMessage,
  deps: {
    bindingService?: BindingService;
    conversationEngine?: ConversationEngine;
  } = {},
): Promise<DispatchResult> {
  if (!message.text?.trim()) {
    return { ok: false, reason: IGNORE_REASONS.EMPTY_TEXT };
  }

  // 简单的进程内去重：避免同 messageId 在 race 下被双发
  const dedupeKey = `${providerId}:${message.messageId}`;
  if (inFlight.has(dedupeKey)) {
    return { ok: false, reason: 'duplicate inflight' };
  }
  inFlight.add(dedupeKey);

  try {
    const bindingService = deps.bindingService ?? new BindingService();
    const binding = bindingService.getBindingByChannel(providerId, message.address.chatId);
    if (!binding || binding.status !== 'active') {
      return { ok: false, reason: IGNORE_REASONS.NO_BINDING };
    }

    const conversationEngine = deps.conversationEngine ?? new ConversationEngine();
    const response = await conversationEngine.sendMessage(
      binding.sessionId,
      message.text.trim(),
      undefined,
      { source: providerId },
    );

    const replyText = (response.visibleText || '').trim();
    if (!replyText) {
      return { ok: true, sessionId: binding.sessionId, reason: 'empty reply' };
    }

    const sendResult = await sendToProvider(providerId, {
      address: { providerId, chatId: message.address.chatId },
      text: replyText,
    });

    return {
      ok: sendResult.ok,
      reason: sendResult.ok ? undefined : sendResult.error,
      sessionId: binding.sessionId,
      replyMessageId: sendResult.messageId,
    };
  } finally {
    inFlight.delete(dedupeKey);
  }
}

export function __resetDispatcherForTesting(): void {
  inFlight.clear();
}
