/**
 * IM Inbound Dispatcher (Multi-Provider, Non-Feishu)
 *
 * 把 IMAdapter 的 InboundMessage 接到 lumos AI 对话循环。
 * 与 inbound-pipeline.ts 的 handleFeishuMessage 平行，但走 IM 通用契约。
 *
 * 路由策略：
 *   - feishu: 由 inbound-pipeline 处理（不走这里）
 *   - wechat: 固定进入 Lumos 主 Agent；旧 route-pointer 不再决定入站归属。
 *   - 其它  : 走 BindingService.getBindingByChannel（chat ↔ session 1:1 绑定）。
 */

import { BindingService } from './binding-service';
import { ConversationEngine } from '../conversation-engine';
import { extractInlineAttachmentsForIm } from './extract-inline-attachments';
import {
  sendToProvider,
  getOrCreateAdapter,
  hasStreamingPreview,
  parseSlashCommand,
} from '@/lib/im';
import type { InboundMessage, OutboundMessage, PreviewHandle } from '@/lib/im';
import { getDefaultProvider } from '@/lib/db/providers';
import { getSession } from '@/lib/db';
import { parseProviderExtraEnv, resolveProviderRequestApiKey } from '@/lib/provider-model-discovery';
import { resolveProviderModelForRequest } from '@/lib/model-metadata';
import { setCurrentRoutedSessionId } from '@/lib/im/providers/wechat/route-pointer';
import { resolveWechatMainAgentSession } from '@/lib/im/providers/wechat/main-agent-route';
import { handleWechatCommand, maybeHandleWechatVoiceModePhrase } from '@/lib/im/providers/wechat/commands';
import { recordDefaultUserImTarget } from '@/lib/app/im-bridge';
import {
  isWechatNativeVoiceReplyEnabled,
  isWechatVoiceModeEnabled,
} from '@/lib/im/providers/wechat/voice-mode';
import {
  normalizeOpenAIBaseUrl,
  resolveExplicitAsrProviderTarget,
  synthesizeSpeechAttachment,
  transcribeAudioAttachmentWithTarget,
  type OpenAICompatibleAsrTarget,
} from '@/lib/im/core/speech';

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
  const hasAudioAttachment = providerId === 'wechat'
    && Boolean(message.attachments?.some((attachment) => isAudioAttachment(attachment)));
  if (!message.text?.trim() && !hasAudioAttachment) {
    return { ok: false, reason: IGNORE_REASONS.EMPTY_TEXT };
  }

  const dedupeKey = `${providerId}:${message.messageId}`;
  if (inFlight.has(dedupeKey)) {
    return { ok: false, reason: 'duplicate inflight' };
  }
  inFlight.add(dedupeKey);

  try {
    const inboundMessage = providerId === 'wechat'
      ? await normalizeWechatInboundMessage(message)
      : message;
    if (providerId === 'wechat') {
      try {
        recordDefaultUserImTarget({
          providerId,
          chatId: inboundMessage.address.chatId,
          label: '微信会话',
          source: 'wechat-inbound',
        });
      } catch (err) {
        console.warn('[im-dispatcher] failed to persist default IM target:', err);
      }
    }
    const sendReply = (reply: OutboundMessage) =>
      sendToProvider(providerId, withInboundProviderHints(providerId, inboundMessage, reply));

    // ---- 0. wechat 斜杠命令短路 -------------------------------------------
    // 命令在 server 侧（Next.js）独立处理，不走 AI 对话；不加 session 前缀。
    if (providerId === 'wechat') {
      const parsed = parseSlashCommand(inboundMessage.text);
      if (parsed) {
        const result = await handleWechatCommand({
          command: parsed.name,
          args: parsed.args,
          message: inboundMessage,
        });
        if (result.handled) {
          if (result.reply) {
            const commandSendResult = await sendReply(result.reply);
            return {
              ok: commandSendResult.ok,
              reason: commandSendResult.ok ? 'command-handled' : commandSendResult.error,
              replyMessageId: commandSendResult.messageId,
            };
          }
          return { ok: true, reason: 'command-handled' };
        }
        // not handled — fall through to AI dispatch with the raw "/xxx" text
      }

      const naturalVoiceMode = maybeHandleWechatVoiceModePhrase(inboundMessage);
      if (naturalVoiceMode?.handled) {
        if (naturalVoiceMode.reply) {
          const voiceCommandSendResult = await sendReply(naturalVoiceMode.reply);
          return {
            ok: voiceCommandSendResult.ok,
            reason: voiceCommandSendResult.ok ? 'voice-mode-command-handled' : voiceCommandSendResult.error,
            replyMessageId: voiceCommandSendResult.messageId,
          };
        }
        return { ok: true, reason: 'voice-mode-command-handled' };
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
        inboundMessage.address.chatId,
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
        previewHandle = await streamingAdapter.startPreview(inboundMessage.address, '正在思考...');
      } catch (err) {
        console.warn('[im-dispatcher] startPreview failed:', err);
        previewHandle = null;
      }
    }

    let response: Awaited<ReturnType<ConversationEngine['sendMessage']>>;
    try {
      response = await conversationEngine.sendMessage(
        sessionId,
        inboundMessage.text.trim(),
        inboundMessage.attachments,
        {
          source: providerId,
          imContext: {
            providerId,
            chatId: inboundMessage.address.chatId,
          },
        },
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

    // ---- 4. 抽出 markdown 内联图片成 attachments，让 IM 渠道发真图 -------
    // AI 生成图片时会把本地路径写成 ![alt](/api/media/serve?path=...)；如果
    // 直接当文本发到微信用户只看到 markdown 字符串。把这些图片变成附件，
    // 文本里替换成 [图片] 占位。
    const { cleanText, attachments } = await extractInlineAttachmentsForIm(rawReply);

    // ---- 5. wechat 加 session 名前缀 ------------------------------------
    const finalText = needsTitlePrefix
      ? withSessionPrefix(sessionId, cleanText)
      : cleanText;

    const voiceMode = providerId === 'wechat'
      && isWechatVoiceModeEnabled(inboundMessage.address.chatId);

    if (voiceMode) {
      let baseAttachmentsSent = false;
      if (attachments.length > 0) {
        const baseAttachmentResult = await sendReply({
          address: { providerId, chatId: inboundMessage.address.chatId },
          text: '',
          attachments,
        });
        if (baseAttachmentResult.ok) {
          baseAttachmentsSent = true;
        } else {
          console.warn('[im-dispatcher] voice reply base attachments send failed; will keep going:', baseAttachmentResult.error);
        }
      }

      const speech = await synthesizeSpeechAttachment(cleanText);
      if (speech.ok && speech.attachment) {
        const speechAttachment = withWechatNativeVoiceHint(
          speech.attachment,
          inboundMessage.address.chatId,
        );
        const voiceSendResult = await sendReply({
          address: { providerId, chatId: inboundMessage.address.chatId },
          text: '',
          attachments: [speechAttachment],
        });
        if (voiceSendResult.ok) {
          return {
            ok: true,
            sessionId,
            replyMessageId: voiceSendResult.messageId,
          };
        }
        console.warn('[im-dispatcher] voice reply send failed; falling back to text:', voiceSendResult.error);
      } else {
        console.warn('[im-dispatcher] voice reply synthesis failed; falling back to text:', speech.error);
      }

      const fallbackResult = await sendReply({
        address: { providerId, chatId: inboundMessage.address.chatId },
        text: finalText,
        attachments: baseAttachmentsSent || attachments.length === 0
          ? undefined
          : attachments,
      });
      return {
        ok: fallbackResult.ok,
        reason: fallbackResult.ok ? undefined : fallbackResult.error,
        sessionId,
        replyMessageId: fallbackResult.messageId,
      };
    }

    const sendResult = await sendReply({
      address: { providerId, chatId: inboundMessage.address.chatId },
      text: finalText,
      attachments: attachments.length > 0 ? attachments : undefined,
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

function resolveWechatSession(): { sessionId: string; needsTitlePrefix: boolean } {
  const main = resolveWechatMainAgentSession({ createIfMissing: true });
  if (!main) {
    throw new Error('Unable to create Main Agent session for WeChat inbound message');
  }
  // Keep the legacy read-only pointer aligned for existing UI/status surfaces,
  // but never read it as the source of truth for inbound routing.
  setCurrentRoutedSessionId(main.id);
  return { sessionId: main.id, needsTitlePrefix: false };
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

function isAudioAttachment(attachment: { type?: string }): boolean {
  return (attachment.type || '').toLowerCase().startsWith('audio/');
}

function withWechatNativeVoiceHint<T extends { providerHints?: { wechat?: { nativeVoice?: boolean } } }>(
  attachment: T,
  peer: string,
): T {
  return {
    ...attachment,
    providerHints: {
      ...attachment.providerHints,
      wechat: {
        ...attachment.providerHints?.wechat,
        nativeVoice: isWechatNativeVoiceReplyEnabled(peer),
      },
    },
  };
}

function withInboundProviderHints(
  providerId: string,
  inboundMessage: InboundMessage,
  reply: OutboundMessage,
): OutboundMessage {
  if (providerId !== 'wechat') return reply;
  const contextToken = extractWechatContextToken(inboundMessage.raw);
  if (!contextToken) return reply;

  return {
    ...reply,
    providerHints: {
      ...reply.providerHints,
      wechat: {
        ...reply.providerHints?.wechat,
        contextToken,
      },
    },
  };
}

function extractWechatContextToken(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const value = (raw as { context_token?: unknown }).context_token;
  return typeof value === 'string' ? value.trim() : '';
}

function isWechatVoicePlaceholderText(text: string): boolean {
  const normalized = (text || '').trim();
  return normalized.includes('未收到微信转写文本') || normalized.startsWith('[语音:');
}

async function normalizeWechatInboundMessage(message: InboundMessage): Promise<InboundMessage> {
  const attachments = message.attachments || [];
  const voiceAttachments = attachments.filter(isAudioAttachment);
  if (voiceAttachments.length === 0) return message;

  const hasRealText = Boolean(message.text?.trim()) && !isWechatVoicePlaceholderText(message.text);
  if (hasRealText) return message;

  const asrTarget = resolveWechatVoiceAsrTarget();
  if (!asrTarget) return withVoicePlaceholderIfEmpty(message);

  const transcripts: string[] = [];
  for (const attachment of voiceAttachments) {
    const transcript = await transcribeAudioAttachmentWithTarget(attachment, asrTarget);
    if (transcript) transcripts.push(transcript);
  }

  const text = transcripts.join('\n').trim();
  if (!text) return withVoicePlaceholderIfEmpty(message);

  const filteredAttachments = attachments.filter((attachment) => !isAudioAttachment(attachment));
  return {
    ...message,
    text,
    attachments: filteredAttachments.length > 0 ? filteredAttachments : undefined,
  };
}

function withVoicePlaceholderIfEmpty(message: InboundMessage): InboundMessage {
  if (message.text?.trim()) return message;
  return { ...message, text: '[语音消息，未收到转写文本]' };
}

function resolveWechatVoiceAsrTarget(): OpenAICompatibleAsrTarget | null {
  const explicit = resolveExplicitAsrProviderTarget();
  if (explicit) return explicit;

  const provider = getDefaultProvider();
  if (!provider || provider.api_protocol !== 'openai-compatible' || provider.auth_mode === 'local_auth') {
    return null;
  }

  const apiKey = resolveProviderRequestApiKey(provider);
  if (!apiKey) return null;

  const extraEnv = parseProviderExtraEnv(provider.extra_env);
  const baseUrl = normalizeOpenAIBaseUrl(
    extraEnv.OPENAI_TRANSCRIPTION_BASE_URL?.trim()
      || extraEnv.OPENAI_ASR_BASE_URL?.trim()
      || extraEnv.OPENAI_BASE_URL?.trim()
      || extraEnv.OPENAI_API_BASE?.trim()
      || provider.base_url,
  );
  if (!baseUrl) return null;

  const model = process.env.IM_VOICE_ASR_MODEL?.trim()
    || extraEnv.OPENAI_TRANSCRIPTION_MODEL?.trim()
    || extraEnv.OPENAI_ASR_MODEL?.trim()
    || resolveProviderModelForRequest(provider, undefined)
    || 'whisper-1';

  return { baseUrl, apiKey, model };
}

export function __resetDispatcherForTesting(): void {
  inFlight.clear();
}
