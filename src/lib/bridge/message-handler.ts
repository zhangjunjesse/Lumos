import { getSessionBindingByPlatformChat, recordMessageSync } from '@/lib/db/feishu-bridge';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';
import { downloadFeishuImage } from '@/lib/feishu/image-handler';
import { downloadFeishuFile } from '@/lib/feishu/file-handler';
import { getMimeType } from '@/lib/file-categories';
import type { FileAttachment } from '@/types';
import path from 'node:path';
import { ConversationEngine } from './conversation-engine';
import { extractAssistantArtifactPaths } from './file-artifact-extractor';
import { feishuSendLocalFiles, feishuSendMail, type FeishuMailDraft, syncMessageToFeishu } from './sync-helper';
import { requireActiveFeishuUserAuth } from './feishu-auth-guard';
import { loadToken } from '@/lib/feishu-auth';
import { getFeishuCredentials } from '@/lib/feishu-config';
import { feishuFetch } from '@/lib/feishu/doc-content';

const processedMessages = new Set<string>();
const conversationEngine = new ConversationEngine();

const FILE_DIRECTIVE_PREFIX = 'FEISHU_SEND_FILE::';
const MAIL_DIRECTIVE_PREFIX = 'FEISHU_SEND_MAIL::';
const MENTION_EMAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const mentionEmailCache = new Map<string, { email: string; name?: string; expiresAt: number }>();

interface FeishuWebhookMessage {
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

function stripFileDirectives(text: string): string {
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
    if (!inCodeBlock && trimmed.startsWith(FILE_DIRECTIVE_PREFIX)) {
      continue;
    }
    output.push(line);
  }

  return output.join('\n').trim();
}

function stripMailDirectives(text: string): string {
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
    if (!inCodeBlock && trimmed.startsWith(MAIL_DIRECTIVE_PREFIX)) {
      continue;
    }
    output.push(line);
  }

  return output.join('\n').trim();
}

function stripFeishuDirectives(text: string): string {
  return stripMailDirectives(stripFileDirectives(text));
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

export async function handleFeishuMessage(message: FeishuWebhookMessage) {
  const msg = message?.message;
  if (!msg) return;

  // Ignore messages sent by the app itself to avoid loops
  if (message.sender?.sender_type === 'app') return;

  const auth = requireActiveFeishuUserAuth();
  if (!auth.ok) {
    console.warn('[Bridge] Ignore incoming Feishu message: user auth missing or expired', auth.code);
    return;
  }

  const senderOpenId = message.sender?.sender_id?.open_id as string | undefined;
  if (!senderOpenId) {
    console.warn('[Bridge] Ignore incoming Feishu message: missing sender open_id');
    return;
  }
  if (senderOpenId !== auth.openId) {
    console.warn(
      `[Bridge] Ignore incoming Feishu message from unauthorized sender ${senderOpenId}; expected ${auth.openId}`,
    );
    return;
  }

  const messageId = msg.message_id as string | undefined;
  if (!messageId || processedMessages.has(messageId)) return;

  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 60000);

  const chatId = msg.chat_id as string | undefined;
  const content = msg.content as string | undefined;
  const messageType = msg.message_type as string | undefined;

  if (!chatId || !content || !messageType) return;

  // Only handle text/image/file/media/audio/video messages for now
  if (
    messageType !== 'text' &&
    messageType !== 'image' &&
    messageType !== 'file' &&
    messageType !== 'media' &&
    messageType !== 'audio' &&
    messageType !== 'video'
  ) return;

  const binding = getSessionBindingByPlatformChat('feishu', chatId);
  if (!binding || binding.status !== 'active') return;

  let text = '';
  let attachments: FileAttachment[] | undefined;
  let parsed: Record<string, unknown> | null = null;

  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  const messageMentions = Array.isArray(msg?.mentions) ? msg?.mentions : [];

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
    if (messageType === 'text') {
      text = (getParsedString('text') || String(content || '')).trim();
      if (!text) return;

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
    } else {
      const { appId, appSecret } = getFeishuCredentials();
      if (!appId || !appSecret) {
        console.error('[Bridge] Missing FEISHU_APP_ID/FEISHU_APP_SECRET for media download');
        return;
      }

      const feishuApi = new FeishuAPI(appId, appSecret);
      const token = await feishuApi.getToken();

      if (messageType === 'image') {
        const imageKey = getParsedString('image_key');
        if (!imageKey || !messageId) return;
        const buffer = await downloadFeishuImage(imageKey, token, messageId);
        const base64 = buffer.toString('base64');
        const fileName = `feishu-image-${messageId}.jpg`;
        attachments = [{
          id: `feishu-image-${messageId}`,
          name: fileName,
          type: 'image/jpeg',
          size: buffer.length,
          data: base64,
        }];
        text = '[用户发送了一张图片]';
      } else if (
        messageType === 'file' ||
        messageType === 'media' ||
        messageType === 'audio' ||
        messageType === 'video'
      ) {
        const fileKey = getParsedString('file_key', 'media_key', 'video_key', 'audio_key');
        let fileName = getParsedString('file_name', 'name') || `feishu-${messageType}-${messageId || Date.now()}`;
        if (!fileKey || !messageId) return;
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
      }
    }
  } catch (err) {
    console.error('[Bridge] Failed to download media:', err);
    if (binding?.lumos_session_id) {
      try {
        await syncMessageToFeishu(
          binding.lumos_session_id,
          'assistant',
          '图片/文件下载失败，请重试或更换图片。',
        );
      } catch {
        // ignore
      }
    }
    return;
  }

  const sessionId = binding.lumos_session_id;

  try {
    const response = await conversationEngine.sendMessage(sessionId, text, attachments, { source: 'feishu' });
    if (response) {
      const responseText = response.visibleText || '';
      const responseRawContent = response.rawContent || responseText;
      const fileDirectives = extractFileDirectives(responseText);
      const mailDirectives = extractMailDirectives(responseText);
      const cleanResponse = stripFeishuDirectives(responseText);

      if (cleanResponse) {
        await syncMessageToFeishu(sessionId, 'assistant', cleanResponse);
      }

      const autoMediaPaths = fileDirectives.length > 0
        ? []
        : extractAssistantArtifactPaths(responseRawContent).mediaPaths;
      const mediaPathsToSend = Array.from(new Set([...fileDirectives, ...autoMediaPaths]));

      if (mediaPathsToSend.length > 0) {
        const { sent, failed } = await feishuSendLocalFiles({
          sessionId,
          filePaths: mediaPathsToSend,
        });

        if (fileDirectives.length > 0 && sent.length > 0) {
          await syncMessageToFeishu(
            sessionId,
            'assistant',
            `已发送文件：${sent.join('、')}`,
          );
        }
        if (fileDirectives.length > 0 && failed.length > 0) {
          await syncMessageToFeishu(
            sessionId,
            'assistant',
            `发送失败：${failed.join('、')}`,
          );
        }
      }

      if (mailDirectives.length > 0) {
        for (const draft of mailDirectives) {
          const result = await feishuSendMail({ sessionId, draft });
          if (result.ok) {
            const recipients = Array.isArray(draft.to) ? draft.to.join('、') : draft.to;
            await syncMessageToFeishu(
              sessionId,
              'assistant',
              `邮件已发送给：${recipients}`,
            );
          } else {
            await syncMessageToFeishu(
              sessionId,
              'assistant',
              `邮件发送失败：${result.error || 'SEND_FAILED'}`,
            );
          }
        }
      }

      if (binding.id) {
        recordMessageSync({
          bindingId: binding.id,
          messageId,
          sourcePlatform: 'feishu',
          direction: 'from_platform',
          status: 'success',
        });
      }
    }
  } catch (error) {
    console.error('[Bridge] Failed to handle Feishu message:', error);
  }
}
