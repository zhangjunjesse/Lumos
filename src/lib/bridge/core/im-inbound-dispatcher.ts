/**
 * IM Inbound Dispatcher (Multi-Provider, Non-Feishu)
 *
 * 把 IMAdapter 的 InboundMessage 接到 lumos AI 对话循环。
 * 与 inbound-pipeline.ts 的 handleFeishuMessage 平行，但走 IM 通用契约。
 *
 * 路由策略：
 *   - feishu: 由 inbound-pipeline 处理（不走这里）
 *   - wechat: 用「当前路由 session 指针」(route-pointer.ts)，没有就自动建。
 *             AI 回复加 session 名前缀送回（防止用户切来切去搞混）。
 *   - 其它  : 走 BindingService.getBindingByChannel（chat ↔ session 1:1 绑定）。
 */

import { BindingService } from './binding-service';
import { ConversationEngine } from '../conversation-engine';
import {
  sendToProvider,
  getOrCreateAdapter,
  hasStreamingPreview,
  parseSlashCommand,
} from '@/lib/im';
import type { InboundMessage, PreviewHandle } from '@/lib/im';
import { getSession, getAllSessions, createSession } from '@/lib/db';
import {
  isMainAgentSession,
  withSessionEntryMarker,
} from '@/lib/chat/session-entry';
import {
  getCurrentRoutedSessionId,
  setCurrentRoutedSessionId,
} from '@/lib/im/providers/wechat/route-pointer';
import { handleWechatCommand } from '@/lib/im/providers/wechat/commands';

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

  const dedupeKey = `${providerId}:${message.messageId}`;
  if (inFlight.has(dedupeKey)) {
    return { ok: false, reason: 'duplicate inflight' };
  }
  inFlight.add(dedupeKey);

  try {
    // ---- 0. wechat 斜杠命令短路 -------------------------------------------
    // 命令在 server 侧（Next.js）独立处理，不走 AI 对话；不加 session 前缀。
    if (providerId === 'wechat') {
      const parsed = parseSlashCommand(message.text);
      if (parsed) {
        const result = await handleWechatCommand({
          command: parsed.name,
          args: parsed.args,
          message,
        });
        if (result.handled) {
          if (result.reply) {
            await sendToProvider(providerId, result.reply);
          }
          return { ok: true, reason: 'command-handled' };
        }
        // not handled — fall through to AI dispatch with the raw "/xxx" text
      }
    }

    // ---- 1. 决定路由到哪个 session ----------------------------------------
    let sessionId: string;
    let needsTitlePrefix: boolean;

    if (providerId === 'wechat') {
      ({ sessionId, needsTitlePrefix } = resolveWechatSession());
    } else {
      const bindingService = deps.bindingService ?? new BindingService();
      const binding = bindingService.getBindingByChannel(
        providerId,
        message.address.chatId,
      );
      if (!binding || binding.status !== 'active') {
        return { ok: false, reason: IGNORE_REASONS.NO_BINDING };
      }
      sessionId = binding.sessionId;
      needsTitlePrefix = false;
    }

    // ---- 2. 进 AI 对话循环 ------------------------------------------------
    const conversationEngine = deps.conversationEngine ?? new ConversationEngine();

    let previewHandle: PreviewHandle | null = null;
    let streamingAdapter: ReturnType<typeof getOrCreateAdapter> | null = null;
    try {
      streamingAdapter = getOrCreateAdapter(providerId);
    } catch {
      streamingAdapter = null;
    }
    if (streamingAdapter && hasStreamingPreview(streamingAdapter)) {
      try {
        previewHandle = await streamingAdapter.startPreview(message.address, '正在思考...');
      } catch (err) {
        console.warn('[im-dispatcher] startPreview failed:', err);
        previewHandle = null;
      }
    }

    let response: Awaited<ReturnType<ConversationEngine['sendMessage']>>;
    try {
      response = await conversationEngine.sendMessage(
        sessionId,
        message.text.trim(),
        message.attachments,
        { source: providerId },
        previewHandle && streamingAdapter && hasStreamingPreview(streamingAdapter)
          ? {
              onVisibleText: (chunk) => {
                void streamingAdapter!.updatePreview(previewHandle!, chunk);
              },
            }
          : undefined,
      );
    } catch (err) {
      if (previewHandle && streamingAdapter && hasStreamingPreview(streamingAdapter)) {
        const errMsg = err instanceof Error ? err.message : 'AI failed';
        await streamingAdapter
          .finalizePreview(previewHandle, `❌ ${errMsg}`)
          .catch(() => undefined);
      }
      throw err;
    }

    const rawReply = (response.visibleText || '').trim();

    // ---- 3. 流式预览路径（feishu）独立返回 -------------------------------
    if (previewHandle && streamingAdapter && hasStreamingPreview(streamingAdapter)) {
      await streamingAdapter.finalizePreview(
        previewHandle,
        rawReply || '已处理完成。',
      );
      return { ok: true, sessionId, replyMessageId: previewHandle.cardId };
    }

    if (!rawReply) {
      return { ok: true, sessionId, reason: 'empty reply' };
    }

    // ---- 4. wechat 加 session 名前缀 ------------------------------------
    const finalText = needsTitlePrefix
      ? withSessionPrefix(sessionId, rawReply)
      : rawReply;

    const sendResult = await sendToProvider(providerId, {
      address: { providerId, chatId: message.address.chatId },
      text: finalText,
    });

    return {
      ok: sendResult.ok,
      reason: sendResult.ok ? undefined : sendResult.error,
      sessionId,
      replyMessageId: sendResult.messageId,
    };
  } finally {
    inFlight.delete(dedupeKey);
  }
}

// ---- helpers ---------------------------------------------------------------

function resolveWechatSession(): { sessionId: string; needsTitlePrefix: true } {
  // 1. 用户用 /switch 显式切到的指针优先
  const explicit = getCurrentRoutedSessionId();
  if (explicit) return { sessionId: explicit, needsTitlePrefix: true };

  // 2. 默认 = 主 agent 会话（lumos 的"主对话"）
  const main = getAllSessions().find((s) => isMainAgentSession(s));
  if (main) {
    setCurrentRoutedSessionId(main.id);
    return { sessionId: main.id, needsTitlePrefix: true };
  }

  // 3. 一个 main-agent session 都没有 → 建一个（带 marker 标记为 main-agent）
  const created = createSession(
    undefined,
    undefined,
    withSessionEntryMarker(undefined, 'main-agent'),
  );
  setCurrentRoutedSessionId(created.id);
  return { sessionId: created.id, needsTitlePrefix: true };
}

function withSessionPrefix(sessionId: string, body: string): string {
  const s = getSession(sessionId);
  const title = (s?.title || '').trim();
  const display = title && title !== 'New Chat'
    ? title
    : `(未命名 ${sessionId.slice(0, 6)})`;
  // 第一行单独是 session 名，空一行后再正文。微信渲染换行很轻，这样最干净。
  return `📂 ${display}\n\n${body}`;
}

export function __resetDispatcherForTesting(): void {
  inFlight.clear();
}
