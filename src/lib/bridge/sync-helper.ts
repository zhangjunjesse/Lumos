import { getDb } from '@/lib/db';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';
import { recordMessageSync, updateSessionBindingStatus } from '@/lib/db/feishu-bridge';
import { loadToken } from '@/lib/feishu-auth';
import { getFeishuCredentials, isFeishuConfigured } from '@/lib/feishu-config';
import { feishuFetch } from '@/lib/feishu/doc-content';
import { parseMessageContent } from '@/types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireActiveFeishuUserAuth } from './feishu-auth-guard';

type FeishuSendMode = 'text' | 'image' | 'file';
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

async function sendInteractiveCard(params: {
  chatId: string;
  role: 'user' | 'assistant';
  content: string;
  bindingId?: number;
}): Promise<FeishuSendResult> {
  const { chatId, role, content, bindingId } = params;
  const { appId, appSecret } = getFeishuCredentials();
  if (!appId || !appSecret) {
    return { ok: false, error: 'FEISHU_NOT_CONFIGURED' };
  }

  const feishuApi = new FeishuAPI(appId, appSecret);
  const displayText = toFeishuDisplayText(content);
  const cardContent = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: role === 'user' ? '👤 用户' : '🤖 AI' },
      template: role === 'user' ? 'blue' : 'green',
    },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: displayText } }],
  };

  const token = await feishuApi.getToken();
  const res = await fetch(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(cardContent),
      }),
    },
  );

  let messageId = '';
  try {
    const data = await res.json();
    messageId = data?.data?.message_id || '';
    if (!res.ok || (typeof data?.code === 'number' && data.code !== 0)) {
      return { ok: false, error: 'SEND_FAILED' };
    }
  } catch {
    if (!res.ok) {
      return { ok: false, error: 'SEND_FAILED' };
    }
  }

  if (bindingId && messageId) {
    recordMessageSync({
      bindingId,
      messageId,
      sourcePlatform: 'lumos',
      direction: 'to_platform',
      status: 'success',
    });
  }

  return { ok: true, messageId };
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
    const auth = requireActiveFeishuUserAuth();
    if (!auth.ok) {
      markSessionBindingExpiredIfNeeded(sessionId);
      return { ok: false, error: auth.code };
    }

    if (!isFeishuConfigured()) {
      return { ok: false, error: 'FEISHU_NOT_CONFIGURED' };
    }

    const db = getDb();
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

    try {
      const buffer = await fs.readFile(resolvedPath);
      const fileName = path.basename(resolvedPath);
      const shouldSendImage = mode === 'image' && isImageFilePath(fileName);
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
    const auth = requireActiveFeishuUserAuth();
    if (!auth.ok) {
      return { ok: false, error: auth.code };
    }

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
