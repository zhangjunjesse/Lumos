import { getDb } from '@/lib/db';
import { FeishuAPI, type FeishuInteractiveCardContent } from '@/lib/bridge/adapters/feishu-api';
import { recordMessageSync, updateSessionBindingStatus } from '@/lib/db/feishu-bridge';
import { recordBridgeEvent } from '@/lib/bridge/storage/bridge-event-repo';
import { ensureActiveFeishuToken, loadToken } from '@/lib/feishu-auth';
import { getFeishuCredentials, isFeishuConfigured } from '@/lib/feishu-config';
import { feishuFetch } from '@/lib/feishu/doc-content';
import { parseMessageContent } from '@/types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireActiveFeishuUserAuth } from './feishu-auth-guard';

export type FeishuSendMode = 'text' | 'image' | 'file';
type FeishuSendError =
  | 'FEISHU_AUTH_REQUIRED'
  | 'FEISHU_AUTH_EXPIRED'
  | 'FEISHU_USER_INFO_MISSING'
  | 'FEISHU_NOT_CONFIGURED'
  | 'EMPTY_CONTENT'
  | 'MODE_NOT_IMPLEMENTED'
  | 'EMPTY_MEDIA'
  | 'NO_ACTIVE_BINDING'
  | 'FILE_NOT_FOUND'
  | 'SEND_FAILED'
  | 'MAIL_INVALID_PAYLOAD'
  | 'MAIL_SEND_FAILED';

type FeishuSendResult =
  | { ok: true; messageId?: string; messageIds?: string[] }
  | { ok: false; error: FeishuSendError };

const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.ico',
]);
const FEISHU_CARD_MAX_CONTENT_LENGTH = 12_000;
const FEISHU_CARD_UPDATE_INTERVAL_MS = 700;

function isImageFilePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTS.has(ext);
}

function markSessionBindingExpiredIfNeeded(sessionId: string): void {
  try {
    const db = getDb();
    const binding = db
      .prepare(
        'SELECT id, status FROM session_bindings WHERE lumos_session_id = ? AND platform = ? LIMIT 1',
      )
      .get(sessionId, 'feishu') as { id: number; status: string } | undefined;
    if (!binding) return;
    if (binding.status === 'expired') return;
    updateSessionBindingStatus(binding.id, 'expired');
  } catch (error) {
    console.warn('[FeishuSync] Failed to mark binding as expired:', error);
  }
}

export interface FeishuMailDraft {
  to: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  subject: string;
  body?: string;
  body_plain_text?: string;
  body_html?: string;
  attachments?: string[] | string;
}

function toFeishuDisplayText(rawContent: string): string {
  const blocks = parseMessageContent(rawContent);
  const parts: string[] = [];

  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text.trim()) parts.push(block.text.trim());
    } else if (block.type === 'reasoning') {
      if (block.summary.trim()) parts.push(`> ${block.summary.trim()}`);
    } else if (block.type === 'code') {
      if (block.code.trim()) {
        parts.push(`\`\`\`${block.language || ''}\n${block.code}\n\`\`\``.trim());
      }
    }
    // tool_use / tool_result 块不直接发给飞书
  }

  const text = parts.join('\n\n').trim();
  return text || rawContent;
}

function trimFeishuCardContent(content: string): { text: string; truncated: boolean } {
  const normalized = toFeishuDisplayText(content).trim();
  if (normalized.length <= FEISHU_CARD_MAX_CONTENT_LENGTH) {
    return { text: normalized, truncated: false };
  }
  return {
    text: normalized.slice(0, FEISHU_CARD_MAX_CONTENT_LENGTH).trimEnd(),
    truncated: true,
  };
}

function buildInteractiveCard(params: {
  role: 'user' | 'assistant';
  content: string;
  statusText?: string;
}): FeishuInteractiveCardContent {
  const { role, statusText } = params;
  const { text, truncated } = trimFeishuCardContent(params.content);
  const bodyParts: string[] = [];

  if (statusText?.trim()) {
    bodyParts.push(`> ${statusText.trim()}`);
  }

  if (text) {
    bodyParts.push(text);
  } else if (statusText?.trim()) {
    bodyParts.push('_等待输出内容..._');
  }

  if (truncated) {
    bodyParts.push('_内容过长，已截断，请回到 Lumos 查看完整回复。_');
  }

  return {
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: { tag: 'plain_text', content: role === 'user' ? '👤 用户' : '🤖 AI' },
      template: role === 'user' ? 'blue' : 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: bodyParts.join('\n\n') || '_暂无内容_',
        },
      },
    ],
  };
}

function getActiveFeishuBinding(
  sessionId: string,
): { id: number; platform_chat_id: string } | null {
  const db = getDb();
  const binding = db
    .prepare(
      'SELECT id, platform_chat_id FROM session_bindings WHERE lumos_session_id = ? AND platform = ? AND status = ?',
    )
    .get(sessionId, 'feishu', 'active') as
    | { id: number; platform_chat_id: string }
    | undefined;

  if (!binding?.platform_chat_id) {
    return null;
  }

  return binding;
}

async function sendInteractiveCard(params: {
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  bindingId?: number;
  statusText?: string;
}): Promise<FeishuSendResult> {
  const { chatId, role, content, bindingId, statusText } = params;
  const { appId, appSecret } = getFeishuCredentials();
  if (!appId || !appSecret) {
    return { ok: false, error: 'FEISHU_NOT_CONFIGURED' };
  }

  const feishuApi = new FeishuAPI(appId, appSecret);

  try {
    const sent = await feishuApi.sendInteractiveMessage(
      chatId,
      buildInteractiveCard({ role, content, statusText }),
    );

    if (bindingId && sent.message_id) {
      recordMessageSync({
        bindingId,
        messageId: sent.message_id,
        sourcePlatform: 'lumos',
        direction: 'to_platform',
        status: 'success',
      });
      recordBridgeEvent({
        bindingId,
        platform: 'feishu',
        direction: 'outbound',
        transportKind: 'rest',
        channelId: chatId,
        platformMessageId: sent.message_id,
        eventType: 'message',
        status: 'success',
        payload: { role, content, statusText: statusText || null },
      });
    }

    return { ok: true, messageId: sent.message_id };
  } catch (error) {
    if (bindingId) {
      recordBridgeEvent({
        bindingId,
        platform: 'feishu',
        direction: 'outbound',
        transportKind: 'rest',
        channelId: chatId,
        eventType: 'message',
        status: 'failed',
        payload: { role, content, statusText: statusText || null },
        errorCode: 'SEND_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Interactive card send failed',
      });
    }
    return { ok: false, error: 'SEND_FAILED' };
  }
}

export class FeishuStreamingCardWriter {
  private latestContent = '';
  private latestStatus = '正在思考...';
  private lastRenderedKey = '';
  private lastFlushAt = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private broken = false;

  constructor(
    private readonly feishuApi: FeishuAPI,
    private readonly messageId: string,
  ) {}

  pushContent(content: string, statusText = '实时生成中...'): void {
    if (this.broken) return;
    this.latestContent = content;
    this.latestStatus = statusText;
    this.scheduleFlush();
  }

  pushStatus(statusText: string): void {
    if (this.broken) return;
    this.latestStatus = statusText;
    this.scheduleFlush();
  }

  async complete(content: string): Promise<boolean> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.latestContent = content;
    this.latestStatus = '';
    await this.flush(true);
    return !this.broken;
  }

  async fail(errorMessage: string, content?: string): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (content !== undefined) {
      this.latestContent = content;
    }
    this.latestStatus = `生成失败：${errorMessage}`;
    await this.flush(true);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    const elapsed = Date.now() - this.lastFlushAt;
    const delay = elapsed >= FEISHU_CARD_UPDATE_INTERVAL_MS
      ? 0
      : FEISHU_CARD_UPDATE_INTERVAL_MS - elapsed;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush(false);
    }, delay);
  }

  private async flush(force: boolean): Promise<void> {
    if (this.broken) return;

    const card = buildInteractiveCard({
      role: 'assistant',
      content: this.latestContent,
      statusText: this.latestStatus || undefined,
    });
    const renderKey = JSON.stringify(card);
    if (!force && renderKey === this.lastRenderedKey) {
      return;
    }

    this.flushChain = this.flushChain
      .catch(() => undefined)
      .then(async () => {
        try {
          await this.feishuApi.updateInteractiveMessage(this.messageId, card);
          this.lastRenderedKey = renderKey;
          this.lastFlushAt = Date.now();
        } catch (error) {
          this.broken = true;
          console.warn('[FeishuSync] Streaming card update failed:', error);
        }
      });

    await this.flushChain;
  }
}

export async function createFeishuStreamingCard(
  sessionId: string,
  options?: {
    role?: 'assistant' | 'user';
    initialContent?: string;
    statusText?: string;
  },
): Promise<FeishuStreamingCardWriter | null> {
  try {
    await ensureActiveFeishuToken();
    const auth = requireActiveFeishuUserAuth();
    if (!auth.ok) {
      markSessionBindingExpiredIfNeeded(sessionId);
      return null;
    }

    const binding = getActiveFeishuBinding(sessionId);
    if (!binding) {
      return null;
    }

    const { appId, appSecret } = getFeishuCredentials();
    if (!appId || !appSecret) {
      return null;
    }

    const feishuApi = new FeishuAPI(appId, appSecret);
    const sent = await sendInteractiveCard({
      chatId: binding.platform_chat_id,
      role: options?.role || 'assistant',
      content: options?.initialContent || '',
      bindingId: binding.id,
      statusText: options?.statusText || '正在思考...',
    });

    if (!sent.ok || !sent.messageId) {
      return null;
    }

    return new FeishuStreamingCardWriter(feishuApi, sent.messageId);
  } catch (error) {
    console.warn('[FeishuSync] Failed to create streaming card:', error);
    return null;
  }
}

/**
 * Legacy helper used by实时会话绑定：按角色同步单条消息到飞书。
 */
export async function syncMessageToFeishu(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<FeishuSendResult> {
  try {
    await ensureActiveFeishuToken();
    const auth = requireActiveFeishuUserAuth();
    if (!auth.ok) {
      markSessionBindingExpiredIfNeeded(sessionId);
      return { ok: false, error: auth.code };
    }

    if (!isFeishuConfigured()) {
      return { ok: false, error: 'FEISHU_NOT_CONFIGURED' };
    }

    const binding = getActiveFeishuBinding(sessionId);
    if (!binding) {
      return { ok: false, error: 'NO_ACTIVE_BINDING' };
    }

    return await sendInteractiveCard({
      chatId: binding.platform_chat_id,
      role,
      content,
      bindingId: binding.id,
    });
  } catch (err) {
    console.error('[Sync] Failed to sync message:', err);
    return { ok: false, error: 'SEND_FAILED' };
  }
}

/**
 * 统一的“发到飞书”能力，供 Agent / 按钮使用。
 * Phase 1/2 先支持 mode=text；image/file 预留接口。
 */
export async function feishuSend(params: {
  sessionId: string;
  mode: FeishuSendMode;
  content?: string;
  mediaIds?: string[];
}): Promise<FeishuSendResult> {
  const { sessionId, mode, content, mediaIds } = params;

  await ensureActiveFeishuToken();
  const auth = requireActiveFeishuUserAuth();
  if (!auth.ok) {
    markSessionBindingExpiredIfNeeded(sessionId);
    return { ok: false, error: auth.code };
  }

  const { appId, appSecret } = getFeishuCredentials();
  if (!appId || !appSecret) {
    return { ok: false, error: 'FEISHU_NOT_CONFIGURED' };
  }

  if (mode === 'text') {
    if (!content?.trim()) {
      return { ok: false, error: 'EMPTY_CONTENT' };
    }
    return syncMessageToFeishu(sessionId, 'assistant', content);
  }

  if (mode !== 'file' && mode !== 'image') {
    return { ok: false, error: 'MODE_NOT_IMPLEMENTED' };
  }

  if (!mediaIds || mediaIds.length === 0) {
    return { ok: false, error: 'EMPTY_MEDIA' };
  }

  const db = getDb();
  const session = db
    .prepare('SELECT working_directory FROM chat_sessions WHERE id = ?')
    .get(sessionId) as { working_directory: string } | undefined;
  const sessionWorkingDirectory = session?.working_directory || process.cwd();
  const binding = db
    .prepare(
      'SELECT id, platform_chat_id FROM session_bindings WHERE lumos_session_id = ? AND platform = ? AND status = ?',
    )
    .get(sessionId, 'feishu', 'active') as
    | { id: number; platform_chat_id: string }
    | undefined;

  if (!binding?.platform_chat_id) {
    return { ok: false, error: 'NO_ACTIVE_BINDING' };
  }

  const feishuApi = new FeishuAPI(appId, appSecret);
  const messageIds: string[] = [];

  for (const mediaId of mediaIds) {
    const resolvedPath = path.isAbsolute(mediaId)
      ? mediaId
      : path.resolve(sessionWorkingDirectory, mediaId);

    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      stat = null;
    }

    if (!stat || !stat.isFile()) {
      return { ok: false, error: 'FILE_NOT_FOUND' };
    }

    const fileName = path.basename(resolvedPath);
    const shouldSendImage = mode === 'image' && isImageFilePath(fileName);

    try {
      const buffer = await fs.readFile(resolvedPath);
      const sent = shouldSendImage
        ? await (async () => {
            const uploaded = await feishuApi.uploadImage(fileName, buffer);
            return feishuApi.sendImageMessage(binding.platform_chat_id, uploaded.image_key);
          })()
        : await (async () => {
            const uploaded = await feishuApi.uploadFile(fileName, buffer);
            return feishuApi.sendFileMessage(binding.platform_chat_id, uploaded.file_key);
          })();

      messageIds.push(sent.message_id);
      recordMessageSync({
        bindingId: binding.id,
        messageId: sent.message_id,
        sourcePlatform: 'lumos',
        direction: 'to_platform',
        status: 'success',
      });
      recordBridgeEvent({
        bindingId: binding.id,
        platform: 'feishu',
        direction: 'outbound',
        transportKind: 'rest',
        channelId: binding.platform_chat_id,
        platformMessageId: sent.message_id,
        eventType: shouldSendImage ? 'image' : 'file',
        status: 'success',
        payload: { filePath: resolvedPath, mode },
      });
    } catch (err: unknown) {
      console.error('[FeishuSend] Failed to send file:', err);
      const errorMessage = err instanceof Error ? err.message : 'send failed';
      recordMessageSync({
        bindingId: binding.id,
        messageId: `file:${resolvedPath}`,
        sourcePlatform: 'lumos',
        direction: 'to_platform',
        status: 'failed',
        errorMessage,
      });
      recordBridgeEvent({
        bindingId: binding.id,
        platform: 'feishu',
        direction: 'outbound',
        transportKind: 'rest',
        channelId: binding.platform_chat_id,
        platformMessageId: `file:${resolvedPath}`,
        eventType: shouldSendImage ? 'image' : 'file',
        status: 'failed',
        payload: { filePath: resolvedPath, mode },
        errorCode: 'SEND_FAILED',
        errorMessage,
      });
      return { ok: false, error: 'SEND_FAILED' };
    }
  }

  return { ok: true, messageId: messageIds[messageIds.length - 1], messageIds };
}

/**
 * Send multiple local files to Feishu.
 * - Image files are sent as image messages for inline preview.
 * - Other files are sent as file messages.
 */
export async function feishuSendLocalFiles(params: {
  sessionId: string;
  filePaths: string[];
}): Promise<{ sent: string[]; failed: string[] }> {
  const { sessionId, filePaths } = params;
  const sent: string[] = [];
  const failed: string[] = [];

  for (const filePath of filePaths) {
    const mode: FeishuSendMode = isImageFilePath(filePath) ? 'image' : 'file';
    const result = await feishuSend({
      sessionId,
      mode,
      mediaIds: [filePath],
    });
    if (result.ok) {
      sent.push(path.basename(filePath));
    } else {
      failed.push(`${path.basename(filePath)} (${result.error || 'SEND_FAILED'})`);
    }
  }

  return { sent, failed };
}

/**
 * Best-effort sync of session title -> Feishu chat name.
 */
export async function syncSessionTitleToFeishu(sessionId: string, title: string): Promise<FeishuSendResult> {
  try {
    const { appId, appSecret } = getFeishuCredentials();
    if (!appId || !appSecret) {
      return { ok: false, error: 'FEISHU_NOT_CONFIGURED' };
    }

    const db = getDb();
    const binding = db
      .prepare(
        'SELECT platform_chat_id FROM session_bindings WHERE lumos_session_id = ? AND platform = ? AND status = ?',
      )
      .get(sessionId, 'feishu', 'active') as { platform_chat_id: string } | undefined;

    if (!binding?.platform_chat_id) {
      return { ok: false, error: 'NO_ACTIVE_BINDING' };
    }

    const feishuApi = new FeishuAPI(appId, appSecret);
    const name = `Lumos - ${title || 'Chat'}`;
    await feishuApi.updateChat(binding.platform_chat_id, { name });
    return { ok: true };
  } catch (err) {
    console.error('[Sync] Failed to update Feishu chat title:', err);
    return { ok: false, error: 'SEND_FAILED' };
  }
}

export async function cleanupSessionFeishuChat(sessionId: string): Promise<{
  attempted: boolean;
  deleted: boolean;
  reason?: string;
}> {
  try {
    const { appId, appSecret } = getFeishuCredentials();
    if (!appId || !appSecret) {
      return { attempted: false, deleted: false, reason: 'FEISHU_NOT_CONFIGURED' };
    }

    const db = getDb();
    const binding = db
      .prepare(
        `SELECT platform_chat_id
           FROM session_bindings
          WHERE lumos_session_id = ? AND platform = ? AND status != 'deleted'
          ORDER BY updated_at DESC, id DESC
          LIMIT 1`,
      )
      .get(sessionId, 'feishu') as { platform_chat_id: string } | undefined;

    if (!binding?.platform_chat_id) {
      return { attempted: false, deleted: false, reason: 'NO_ACTIVE_BINDING' };
    }

    const feishuApi = new FeishuAPI(appId, appSecret);
    await feishuApi.deleteChat(binding.platform_chat_id);
    return { attempted: true, deleted: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DELETE_CHAT_FAILED';
    console.error('[Sync] Failed to delete Feishu chat for session:', {
      sessionId,
      error: message,
    });
    return { attempted: true, deleted: false, reason: message };
  }
}

function normalizeEmailList(value?: string[] | string): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(v => v.trim()).filter(Boolean);
  }
  return value
    .split(/[;,]/g)
    .map(v => v.trim())
    .filter(Boolean);
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Send Feishu email using user_access_token (mail API).
 */
export async function feishuSendMail(params: {
  sessionId?: string;
  draft: FeishuMailDraft;
}): Promise<FeishuSendResult> {
  const { sessionId, draft } = params;

  const auth = requireActiveFeishuUserAuth();
  if (!auth.ok) {
    return { ok: false, error: auth.code };
  }

  const token = loadToken();
  if (!token?.userAccessToken) {
    return { ok: false, error: 'FEISHU_AUTH_REQUIRED' };
  }

  const to = normalizeEmailList(draft.to);
  const cc = normalizeEmailList(draft.cc);
  const bcc = normalizeEmailList(draft.bcc);
  const subject = (draft.subject || '').trim();
  const bodyPlain = (draft.body_plain_text || draft.body || '').trim();
  const bodyHtml = (draft.body_html || '').trim();

  if (to.length === 0 || !subject || (!bodyPlain && !bodyHtml)) {
    return { ok: false, error: 'MAIL_INVALID_PAYLOAD' };
  }

  const payload: Record<string, unknown> = {
    subject,
    to,
  };

  if (cc.length > 0) payload.cc = cc;
  if (bcc.length > 0) payload.bcc = bcc;
  if (bodyPlain) payload.body_plain_text = bodyPlain;
  if (bodyHtml) payload.body_html = bodyHtml;

  const attachmentList = Array.isArray(draft.attachments)
    ? draft.attachments
    : draft.attachments
      ? [draft.attachments]
      : [];

  if (attachmentList.length > 0) {
    const db = getDb();
    const session = sessionId
      ? (db
          .prepare('SELECT working_directory FROM chat_sessions WHERE id = ?')
          .get(sessionId) as { working_directory: string } | undefined)
      : undefined;
    const sessionWorkingDirectory = session?.working_directory || process.cwd();
    const attachments: Array<{ filename: string; body: string }> = [];

    for (const filePath of attachmentList) {
      if (!filePath) continue;
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(sessionWorkingDirectory, filePath);

      let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
      try {
        stat = await fs.stat(resolvedPath);
      } catch {
        stat = null;
      }

      if (!stat || !stat.isFile()) {
        return { ok: false, error: 'FILE_NOT_FOUND' };
      }

      const buffer = await fs.readFile(resolvedPath);
      attachments.push({
        filename: path.basename(resolvedPath),
        body: toBase64Url(buffer),
      });
    }

    if (attachments.length > 0) {
      payload.attachments = attachments;
    }
  }

  try {
    const data = await feishuFetch<{ message_id?: string }>(
      token.userAccessToken,
      '/mail/v1/user_mailboxes/me/messages/send',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
    return { ok: true, messageId: data?.message_id };
  } catch (err) {
    console.error('[FeishuMail] Failed to send email:', err);
    return { ok: false, error: 'MAIL_SEND_FAILED' };
  }
}
