import path from 'node:path';
import { BindingService, type BridgeBindingRecord } from './binding-service';
import {
  type BridgeEventTransportKind,
  findBridgeEventByPlatformMessage,
  getBridgeEventById,
  listBridgeEvents,
  recordBridgeEvent,
  updateBridgeEvent,
  type BridgeEventRecord,
} from '../storage/bridge-event-repo';
import { recordMessageSync } from '@/lib/db/feishu-bridge';
import {
  acquireSessionLock,
  releaseSessionLock,
  setSessionRuntimeStatus,
} from '@/lib/db';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';
import { downloadFeishuImage } from '@/lib/feishu/image-handler';
import { downloadFeishuFile } from '@/lib/feishu/file-handler';
import { getMimeType } from '@/lib/file-categories';
import type { FileAttachment } from '@/types';
import { ConversationEngine } from '../conversation-engine';
import { extractAssistantArtifactPaths } from '../file-artifact-extractor';
import {
  createFeishuStreamingCard,
  feishuSendLocalFiles,
  feishuSendMail,
  type FeishuMailDraft,
  syncMessageToFeishu,
} from '../sync-helper';
import { requireActiveFeishuUserAuth } from '../feishu-auth-guard';
import { ensureActiveFeishuToken, loadToken } from '@/lib/feishu-auth';
import { getFeishuCredentials } from '@/lib/feishu-config';
import { feishuFetch } from '@/lib/feishu/doc-content';
import {
  INBOUND_RECOVERY_INTERVAL_MS,
  STALE_INBOUND_PROCESSING_MS,
  STALE_INBOUND_RECEIVED_MS,
} from './inbound-pipeline-constants';

const FILE_DIRECTIVE_PREFIX = 'FEISHU_SEND_FILE::';
const MAIL_DIRECTIVE_PREFIX = 'FEISHU_SEND_MAIL::';
const MENTION_EMAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const SESSION_LOCK_TTL_SEC = 600;
const SESSION_LOCK_WAIT_INTERVAL_MS = 300;
const SESSION_LOCK_WAIT_TIMEOUT_MS = 15 * 60 * 1000;
const mentionEmailCache = new Map<string, { email: string; name?: string; expiresAt: number }>();

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface FeishuWebhookMessage {
  message?: {
    message_id?: string;
    chat_id?: string;
    content?: string;
    message_type?: string;
    mentions?: unknown[];
  };
  sender?: {
    sender_type?: string;
    sender_id?: {
      open_id?: string;
    };
  };
}

type SupportedMessageType = 'text' | 'post' | 'image' | 'file' | 'media' | 'audio' | 'video';

function isSupportedMessageType(value: string): value is SupportedMessageType {
  return (
    value === 'text' ||
    value === 'post' ||
    value === 'image' ||
    value === 'file' ||
    value === 'media' ||
    value === 'audio' ||
    value === 'video'
  );
}

function mapEventType(messageType: SupportedMessageType): 'message' | 'image' | 'file' | 'audio' | 'video' {
  if (messageType === 'text' || messageType === 'post') return 'message';
  if (messageType === 'image') return 'image';
  if (messageType === 'audio') return 'audio';
  if (messageType === 'video') return 'video';
  return 'file';
}

function extractPostText(parsed: Record<string, unknown> | null): string {
  if (!parsed) return '';

  const locales = Object.values(parsed).filter(
    (value): value is { content?: unknown } => Boolean(value) && typeof value === 'object',
  );

  for (const locale of locales) {
    const rows = Array.isArray(locale.content) ? locale.content : [];
    const parts: string[] = [];

    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const rowParts: string[] = [];
      for (const item of row) {
        if (!item || typeof item !== 'object') continue;
        const block = item as Record<string, unknown>;
        const tag = typeof block.tag === 'string' ? block.tag : '';
        if (tag === 'text' && typeof block.text === 'string' && block.text.trim()) {
          rowParts.push(block.text.trim());
        } else if (tag === 'a' && typeof block.text === 'string' && block.text.trim()) {
          rowParts.push(block.text.trim());
        } else if (tag === 'at') {
          const name = typeof block.user_name === 'string'
            ? block.user_name
            : typeof block.text === 'string'
              ? block.text
              : '';
          if (name.trim()) {
            rowParts.push(name.startsWith('@') ? name.trim() : `@${name.trim()}`);
          }
        }
      }
      if (rowParts.length > 0) {
        parts.push(rowParts.join(' '));
      }
    }

    if (parts.length > 0) {
      return parts.join('\n').trim();
    }
  }

  return '';
}

function extractFileDirectives(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const directives: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (trimmed.startsWith(FILE_DIRECTIVE_PREFIX)) {
      const filePath = trimmed.slice(FILE_DIRECTIVE_PREFIX.length).trim();
      if (filePath) directives.push(filePath);
    }
  }

  return directives;
}

function normalizeMailDraft(raw: unknown): FeishuMailDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const draft = raw as FeishuMailDraft;
  if (draft.attachments && !Array.isArray(draft.attachments)) {
    draft.attachments = [draft.attachments as unknown as string];
  }
  return draft;
}

function extractMailDirectives(text: string): FeishuMailDraft[] {
  const lines = text.split(/\r?\n/);
  const directives: FeishuMailDraft[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    if (trimmed.startsWith(MAIL_DIRECTIVE_PREFIX)) {
      const raw = trimmed.slice(MAIL_DIRECTIVE_PREFIX.length).trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const draft = normalizeMailDraft(parsed);
        if (draft) directives.push(draft);
      } catch {
        // ignore invalid directive
      }
    }
  }

  return directives;
}

function stripDirectives(text: string, prefix: string): string {
  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      output.push(line);
      continue;
    }
    if (!inCodeBlock && trimmed.startsWith(prefix)) {
      continue;
    }
    output.push(line);
  }

  return output.join('\n').trim();
}

function stripFeishuDirectives(text: string): string {
  return stripDirectives(stripDirectives(text, FILE_DIRECTIVE_PREFIX), MAIL_DIRECTIVE_PREFIX);
}

function normalizeMentionId(mention: unknown): { id?: string; type?: string; key?: string; name?: string } {
  if (!mention || typeof mention !== 'object') return {};
  const obj = mention as Record<string, unknown>;
  const key = typeof obj.key === 'string' ? obj.key : undefined;
  const name = typeof obj.name === 'string' ? obj.name : undefined;

  if (typeof obj.id === 'string') {
    const inferred = obj.id.startsWith('ou_') ? 'open_id'
      : obj.id.startsWith('on_') ? 'union_id'
        : obj.id.startsWith('u_') ? 'user_id' : undefined;
    return { id: obj.id, type: (typeof obj.id_type === 'string' ? obj.id_type : inferred), key, name };
  }

  if (obj.id && typeof obj.id === 'object') {
    const idObj = obj.id as Record<string, unknown>;
    if (typeof idObj.open_id === 'string') return { id: idObj.open_id, type: 'open_id', key, name };
    if (typeof idObj.user_id === 'string') return { id: idObj.user_id, type: 'user_id', key, name };
    if (typeof idObj.union_id === 'string') return { id: idObj.union_id, type: 'union_id', key, name };
  }

  if (typeof obj.open_id === 'string') return { id: obj.open_id, type: 'open_id', key, name };
  if (typeof obj.user_id === 'string') return { id: obj.user_id, type: 'user_id', key, name };
  if (typeof obj.union_id === 'string') return { id: obj.union_id, type: 'union_id', key, name };

  return { key, name };
}

async function resolveMentionEmails(
  mentions: unknown[],
): Promise<{
  resolved: Array<{ key?: string; name?: string; email: string }>;
  names: Array<{ key?: string; name?: string }>;
  reason?: 'permission_denied' | 'missing_email' | 'unknown';
}> {
  await ensureActiveFeishuToken();
  const token = loadToken();
  if (!token?.userAccessToken) {
    return { resolved: [], names: [], reason: 'permission_denied' };
  }

  const now = Date.now();
  const resolved: Array<{ key?: string; name?: string; email: string }> = [];
  const names: Array<{ key?: string; name?: string }> = [];
  let permissionDenied = false;
  let otherError = false;
  let missingEmail = false;
  let hadLookup = false;

  for (const mention of mentions) {
    const { id, type, key, name } = normalizeMentionId(mention);
    if (!id) continue;
    if (id === 'all' || key === '@all') continue;
    hadLookup = true;
    const idType = type || 'open_id';
    const cacheKey = `${idType}:${id}`;
    const cached = mentionEmailCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      resolved.push({ key, name: cached.name || name, email: cached.email });
      if (cached.name || name) {
        names.push({ key, name: cached.name || name });
      }
      continue;
    }

    try {
      const data = await feishuFetch<{ user?: { email?: string; name?: string } }>(
        token.userAccessToken,
        `/contact/v3/users/${id}?user_id_type=${encodeURIComponent(idType)}`,
      );
      const email = data?.user?.email;
      if (email) {
        const resolvedName = data?.user?.name || name;
        mentionEmailCache.set(cacheKey, {
          email,
          name: resolvedName,
          expiresAt: now + MENTION_EMAIL_CACHE_TTL_MS,
        });
        resolved.push({ key, name: resolvedName, email });
        if (resolvedName) {
          names.push({ key, name: resolvedName });
        }
      } else {
        const fallbackName = data?.user?.name || name;
        if (fallbackName) {
          names.push({ key, name: fallbackName });
        }
        missingEmail = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || '');
      if (/permission|forbidden|unauthorized|access denied|no permission|无权限|权限/i.test(msg)) {
        permissionDenied = true;
      } else {
        otherError = true;
      }
    }
  }

  if (resolved.length > 0) return { resolved, names };
  if (!hadLookup) return { resolved, names };
  if (permissionDenied) return { resolved, names, reason: 'permission_denied' };
  if (missingEmail) return { resolved, names, reason: 'missing_email' };
  if (otherError) return { resolved, names, reason: 'unknown' };
  return { resolved, names, reason: 'unknown' };
}

export class InboundPipeline {
  private readonly bindingService = new BindingService();
  private readonly conversationEngine = new ConversationEngine();
  private readonly inFlight = new Set<string>();
  private readonly sessionQueues = new Map<string, Promise<void>>();
  private recoveryRunning = false;

  constructor() {
    const isTestEnv = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
    if (isTestEnv) return;

    const timer = setInterval(() => {
      void this.recoverStaleInboundEvents();
    }, INBOUND_RECOVERY_INTERVAL_MS);
    timer.unref?.();

    queueMicrotask(() => {
      void this.recoverStaleInboundEvents();
    });
  }

  async handleFeishuMessage(
    message: FeishuWebhookMessage,
    options?: { retryEventId?: string; transportKind?: BridgeEventTransportKind },
  ): Promise<void> {
    const msg = message?.message;
    if (!msg) return;

    if (message.sender?.sender_type === 'app') return;

    const messageId = typeof msg.message_id === 'string' ? msg.message_id : '';
    const chatId = typeof msg.chat_id === 'string' ? msg.chat_id : '';
    const content = typeof msg.content === 'string' ? msg.content : '';
    const messageType = typeof msg.message_type === 'string' ? msg.message_type : '';

    if (!messageId || !chatId || !content || !messageType || !isSupportedMessageType(messageType)) {
      return;
    }

    if (!options?.retryEventId && this.inFlight.has(messageId)) {
      return;
    }

    const lookupBinding = options?.retryEventId
      ? (() => {
          const existingEvent = getBridgeEventById(options.retryEventId);
          return existingEvent ? this.bindingService.getBindingById(existingEvent.binding_id) : null;
        })()
      : this.bindingService.getBindingByChannel('feishu', chatId);

    if (!lookupBinding || lookupBinding.status !== 'active') {
      console.warn('[Bridge] Ignore incoming Feishu message: no active binding for chat', chatId);
      return;
    }

    const event = options?.retryEventId
      ? getBridgeEventById(options.retryEventId)
      : this.ensureInboundEvent(
          lookupBinding,
          messageId,
          chatId,
          messageType,
          message,
          options?.transportKind || 'websocket',
        );

    if (!event) return;

    if (!options?.retryEventId && (event.status === 'success' || event.status === 'processing')) {
      return;
    }

    if (!options?.retryEventId) {
      void this.recoverStaleInboundEvents({ bindingId: lookupBinding.id, excludeEventId: event.id });
    }

    this.inFlight.add(messageId);
    try {
      await this.enqueueSessionWork(lookupBinding.sessionId, async () => {
        const latestBinding = this.bindingService.getBindingById(lookupBinding.id);
        if (!latestBinding || latestBinding.status !== 'active') {
          this.failEvent(event.id, 'BINDING_INACTIVE', 'Binding is no longer active');
          return;
        }

        const latestEvent = getBridgeEventById(event.id);
        if (!latestEvent) {
          return;
        }
        if (latestEvent.status === 'success') {
          return;
        }

        await this.processFeishuInboundEvent(latestBinding, latestEvent, messageType, message);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unhandled inbound pipeline error';
      console.error('[Bridge] Unhandled inbound pipeline error:', {
        eventId: event.id,
        bindingId: lookupBinding.id,
        sessionId: lookupBinding.sessionId,
        chatId,
        messageId,
        messageType,
        retryEventId: options?.retryEventId || null,
        error: errorMessage,
      });
      this.failEvent(event.id, 'UNHANDLED_PIPELINE_ERROR', errorMessage);
    } finally {
      this.inFlight.delete(messageId);
    }
  }

  async retryEvent(eventId: string): Promise<void> {
    const event = getBridgeEventById(eventId);
    if (!event) throw new Error('Bridge event not found');
    if (event.direction !== 'inbound') throw new Error('Only inbound events can be retried');
    if (event.platform !== 'feishu') throw new Error(`Unsupported platform retry: ${event.platform}`);

    let payload: FeishuWebhookMessage;
    try {
      payload = JSON.parse(event.payload_json) as FeishuWebhookMessage;
    } catch {
      throw new Error('Bridge event payload is invalid');
    }

    await this.handleFeishuMessage(payload, { retryEventId: eventId });

    const refreshed = getBridgeEventById(eventId);
    if (!refreshed) {
      throw new Error('Bridge event not found after retry');
    }
    if (refreshed.status !== 'success') {
      throw new Error(refreshed.error_message || 'Bridge event retry failed');
    }
  }

  async recoverStaleInboundEvents(options?: {
    bindingId?: number;
    excludeEventId?: string;
    limit?: number;
  }): Promise<void> {
    if (this.recoveryRunning) return;
    this.recoveryRunning = true;

    try {
      const staleEvents = this.collectStaleInboundEvents(options);
      for (const event of staleEvents) {
        if (options?.excludeEventId && event.id === options.excludeEventId) {
          continue;
        }
        if (!event.platform_message_id || this.inFlight.has(event.platform_message_id)) {
          continue;
        }

        let payload: FeishuWebhookMessage;
        try {
          payload = JSON.parse(event.payload_json) as FeishuWebhookMessage;
        } catch {
          this.failEvent(event.id, 'INVALID_PAYLOAD', 'Bridge event payload is invalid');
          continue;
        }

        console.warn('[Bridge] Recovering stale inbound event', {
          eventId: event.id,
          bindingId: event.binding_id,
          platformMessageId: event.platform_message_id,
          status: event.status,
          updatedAt: event.updated_at,
        });

        try {
          await this.handleFeishuMessage(payload, { retryEventId: event.id });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to recover stale inbound event';
          console.error('[Bridge] Failed to recover stale inbound event:', {
            eventId: event.id,
            bindingId: event.binding_id,
            platformMessageId: event.platform_message_id,
            status: event.status,
            error: errorMessage,
          });
          this.failEvent(event.id, 'RECOVERY_FAILED', errorMessage);
        }
      }
    } finally {
      this.recoveryRunning = false;
    }
  }

  private ensureInboundEvent(
    binding: BridgeBindingRecord,
    messageId: string,
    chatId: string,
    messageType: SupportedMessageType,
    payload: FeishuWebhookMessage,
    transportKind: BridgeEventTransportKind,
  ): BridgeEventRecord {
    const existing = findBridgeEventByPlatformMessage({
      platform: 'feishu',
      direction: 'inbound',
      channelId: chatId,
      platformMessageId: messageId,
    });
    if (existing) return existing;

    try {
      return recordBridgeEvent({
        bindingId: binding.id,
        platform: 'feishu',
        direction: 'inbound',
        transportKind,
        channelId: chatId,
        platformMessageId: messageId,
        eventType: mapEventType(messageType),
        status: 'received',
        payload,
      });
    } catch (error) {
      const concurrent = findBridgeEventByPlatformMessage({
        platform: 'feishu',
        direction: 'inbound',
        channelId: chatId,
        platformMessageId: messageId,
      });
      if (concurrent) return concurrent;
      throw error;
    }
  }

  private async processFeishuInboundEvent(
    binding: BridgeBindingRecord,
    event: BridgeEventRecord,
    messageType: SupportedMessageType,
    message: FeishuWebhookMessage,
  ): Promise<void> {
    const isRetryAttempt =
      event.last_attempt_at !== null
      || event.status === 'failed'
      || event.status === 'dead_letter';

    updateBridgeEvent({
      id: event.id,
      status: 'processing',
      errorCode: null,
      errorMessage: null,
      retryCount: event.retry_count + (isRetryAttempt ? 1 : 0),
      lastAttemptAt: Date.now(),
    });

    console.info('[Bridge] Processing inbound event', {
      eventId: event.id,
      bindingId: binding.id,
      sessionId: binding.sessionId,
      platformMessageId: event.platform_message_id,
      chatId: event.channel_id,
      messageType,
      status: event.status,
      retryCount: event.retry_count,
    });

    await ensureActiveFeishuToken();
    const auth = requireActiveFeishuUserAuth();
    if (!auth.ok) {
      return this.failEvent(event.id, auth.code, `User auth unavailable: ${auth.code}`);
    }

    const payload = await this.buildConversationInput(message, messageType, event.id, binding.sessionId);
    if (!payload) {
      return this.failEvent(event.id, 'EMPTY_MESSAGE', 'No usable message payload');
    }

    let streamingCard: Awaited<ReturnType<typeof createFeishuStreamingCard>> = null;
    const releaseLock = await this.acquireConversationLock(binding.sessionId);
    try {
      streamingCard = await createFeishuStreamingCard(binding.sessionId, {
        role: 'assistant',
        statusText: '正在思考...',
      });
      const activeStreamingCard = streamingCard;
      const response = await this.conversationEngine.sendMessage(
        binding.sessionId,
        payload.text,
        payload.attachments,
        { source: 'feishu' },
        activeStreamingCard
          ? {
              onVisibleText: (text) => {
                activeStreamingCard.pushContent(text);
              },
            }
          : undefined,
      );
      const finalCardText = (() => {
        const cleanVisibleText = stripFeishuDirectives(response.visibleText || '').trim();
        if (cleanVisibleText && cleanVisibleText !== 'No response') {
          return cleanVisibleText;
        }
        return '已处理完成，请查看后续结果。';
      })();
      const streamedToFeishu = activeStreamingCard
        ? await activeStreamingCard.complete(finalCardText)
        : false;
      await this.syncConversationResponse(
        binding.sessionId,
        response.visibleText || '',
        response.rawContent || response.visibleText || '',
        { sendPrimaryText: !streamedToFeishu },
      );

      recordMessageSync({
        bindingId: binding.id,
        messageId: event.platform_message_id,
        sourcePlatform: 'feishu',
        direction: 'from_platform',
        status: 'success',
      });

      updateBridgeEvent({
        id: event.id,
        status: 'success',
        errorCode: null,
        errorMessage: null,
      });

      console.info('[Bridge] Inbound event processed', {
        eventId: event.id,
        bindingId: binding.id,
        sessionId: binding.sessionId,
        platformMessageId: event.platform_message_id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to process Feishu message';
      if (streamingCard) {
        await streamingCard.fail(errorMessage);
      }
      console.error('[Bridge] Failed to handle Feishu message:', error);
      return this.failEvent(event.id, 'PIPELINE_FAILED', errorMessage);
    } finally {
      releaseLock();
    }
  }

  private async enqueueSessionWork(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    let resolveCurrent: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    const chain = previous.catch(() => undefined).then(() => current);
    this.sessionQueues.set(sessionId, chain);

    try {
      await previous.catch(() => undefined);
      await task();
    } finally {
      resolveCurrent();
      if (this.sessionQueues.get(sessionId) === chain) {
        this.sessionQueues.delete(sessionId);
      }
    }
  }

  private async acquireConversationLock(sessionId: string): Promise<() => void> {
    const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const startedAt = Date.now();

    while (Date.now() - startedAt < SESSION_LOCK_WAIT_TIMEOUT_MS) {
      const acquired = acquireSessionLock(
        sessionId,
        lockId,
        `bridge-${process.pid}`,
        SESSION_LOCK_TTL_SEC,
      );
      if (acquired) {
        setSessionRuntimeStatus(sessionId, 'running');
        return () => {
          try {
            releaseSessionLock(sessionId, lockId);
          } finally {
            setSessionRuntimeStatus(sessionId, 'idle');
          }
        };
      }
      await waitFor(SESSION_LOCK_WAIT_INTERVAL_MS);
    }

    throw new Error('Timed out waiting for the session runtime lock');
  }

  private async buildConversationInput(
    message: FeishuWebhookMessage,
    messageType: SupportedMessageType,
    messageId: string,
    sessionId: string,
  ): Promise<{ text: string; attachments?: FileAttachment[] } | null> {
    const content = message.message?.content;
    if (!content) return null;

    let text = '';
    let attachments: FileAttachment[] | undefined;
    let parsed: Record<string, unknown> | null = null;

    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    const messageMentions = Array.isArray(message.message?.mentions) ? message.message?.mentions : [];

    const getParsedString = (...keys: string[]): string => {
      if (!parsed) return '';
      for (const key of keys) {
        const value = parsed[key];
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }
      return '';
    };

    const getParsedMentions = (): unknown[] => {
      const mentions = parsed ? parsed.mentions : undefined;
      if (Array.isArray(mentions) && mentions.length > 0) return mentions;
      return messageMentions;
    };

    try {
      if (messageType === 'text' || messageType === 'post') {
        text = (
          messageType === 'post'
            ? extractPostText(parsed)
            : getParsedString('text')
        || String(content || '')
        ).trim();
        if (!text) return null;

        const mentions = getParsedMentions();
        if (mentions.length > 0) {
          for (const mention of mentions) {
            const { key, name } = normalizeMentionId(mention);
            if (!key || !name) continue;
            text = text.split(key).join(`@${name}`);
          }

          const { resolved, names, reason } = await resolveMentionEmails(mentions);
          if (names.length > 0) {
            for (const entry of names) {
              if (!entry.key || !entry.name) continue;
              text = text.split(entry.key).join(`@${entry.name}`);
            }
          }
          if (resolved.length > 0) {
            const hint = `<!--feishu_mentions:${JSON.stringify(resolved)}-->`;
            text = `${hint}${text}`;
          } else if (reason) {
            const hint = `<!--feishu_mentions_error:${reason}-->`;
            text = `${hint}${text}`;
          }
        }
        return { text };
      }

      const { appId, appSecret } = getFeishuCredentials();
      if (!appId || !appSecret) {
        throw new Error('Missing FEISHU_APP_ID/FEISHU_APP_SECRET for media download');
      }

      const feishuApi = new FeishuAPI(appId, appSecret);
      const token = await feishuApi.getToken();

      if (messageType === 'image') {
        const imageKey = getParsedString('image_key');
        if (!imageKey) return null;
        const buffer = await downloadFeishuImage(imageKey, token, messageId);
        const fileName = `feishu-image-${messageId}.jpg`;
        attachments = [{
          id: `feishu-image-${messageId}`,
          name: fileName,
          type: 'image/jpeg',
          size: buffer.length,
          data: buffer.toString('base64'),
        }];
        text = '[用户发送了一张图片]';
        return { text, attachments };
      }

      const fileKey = getParsedString('file_key', 'media_key', 'video_key', 'audio_key');
      let fileName = getParsedString('file_name', 'name') || `feishu-${messageType}-${messageId || Date.now()}`;
      if (!fileKey) return null;
      const buffer = await downloadFeishuFile(fileKey, messageId, token);
      let ext = path.extname(fileName);
      if (!ext) {
        if (messageType === 'video') ext = '.mp4';
        else if (messageType === 'audio') ext = '.mp3';
        if (ext) fileName = `${fileName}${ext}`;
      }
      const mime = ext ? getMimeType(ext) : 'application/octet-stream';
      attachments = [{
        id: `feishu-file-${messageId}`,
        name: fileName,
        type: mime,
        size: buffer.length,
        data: buffer.toString('base64'),
      }];
      text = `[用户发送了${messageType === 'video' ? '视频' : messageType === 'audio' ? '音频' : '文件'}: ${fileName}]`;
      return { text, attachments };
    } catch (error) {
      console.error('[Bridge] Failed to download media:', error);
      try {
        await syncMessageToFeishu(sessionId, 'assistant', '图片/文件下载失败，请重试或更换图片。');
      } catch {
        // ignore sync failures
      }
      throw error;
    }
  }

  private async syncConversationResponse(
    sessionId: string,
    responseText: string,
    rawContent: string,
    options?: { sendPrimaryText?: boolean },
  ): Promise<void> {
    const fileDirectives = extractFileDirectives(responseText);
    const mailDirectives = extractMailDirectives(responseText);
    const cleanResponse = stripFeishuDirectives(responseText);

    if ((options?.sendPrimaryText ?? true) && cleanResponse) {
      await syncMessageToFeishu(sessionId, 'assistant', cleanResponse);
    }

    const autoMediaPaths = fileDirectives.length > 0 ? [] : extractAssistantArtifactPaths(rawContent).mediaPaths;
    const mediaPathsToSend = Array.from(new Set([...fileDirectives, ...autoMediaPaths]));

    if (mediaPathsToSend.length > 0) {
      const { sent, failed } = await feishuSendLocalFiles({
        sessionId,
        filePaths: mediaPathsToSend,
      });

      if (fileDirectives.length > 0 && sent.length > 0) {
        await syncMessageToFeishu(sessionId, 'assistant', `已发送文件：${sent.join('、')}`);
      }
      if (fileDirectives.length > 0 && failed.length > 0) {
        await syncMessageToFeishu(sessionId, 'assistant', `发送失败：${failed.join('、')}`);
      }
    }

    if (mailDirectives.length > 0) {
      for (const draft of mailDirectives) {
        const result = await feishuSendMail({ sessionId, draft });
        if (result.ok) {
          const recipients = Array.isArray(draft.to) ? draft.to.join('、') : draft.to;
          await syncMessageToFeishu(sessionId, 'assistant', `邮件已发送给：${recipients}`);
        } else {
          await syncMessageToFeishu(
            sessionId,
            'assistant',
            `邮件发送失败：${result.error || 'SEND_FAILED'}`,
          );
        }
      }
    }
  }

  private failEvent(eventId: string, errorCode: string, errorMessage: string): void {
    try {
      updateBridgeEvent({
        id: eventId,
        status: 'failed',
        errorCode,
        errorMessage,
      });
    } catch (error) {
      console.error('[Bridge] Failed to persist event failure:', {
        eventId,
        errorCode,
        errorMessage,
        persistError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private collectStaleInboundEvents(options?: { bindingId?: number; limit?: number }): BridgeEventRecord[] {
    const now = Date.now();
    const limit = options?.limit ?? 10;
    const staleReceived = listBridgeEvents({
      bindingId: options?.bindingId,
      direction: 'inbound',
      statuses: ['received'],
      updatedBefore: now - STALE_INBOUND_RECEIVED_MS,
      limit,
    });
    const staleProcessing = listBridgeEvents({
      bindingId: options?.bindingId,
      direction: 'inbound',
      statuses: ['processing'],
      updatedBefore: now - STALE_INBOUND_PROCESSING_MS,
      limit,
    });

    return [...staleReceived, ...staleProcessing]
      .sort((left, right) => left.updated_at - right.updated_at)
      .slice(0, limit);
  }
}

let inboundPipeline: InboundPipeline | null = null;

export function getInboundPipeline(): InboundPipeline {
  if (!inboundPipeline) {
    inboundPipeline = new InboundPipeline();
  }
  return inboundPipeline;
}
