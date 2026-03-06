import { getSessionBindingByPlatformChat, recordMessageSync } from '@/lib/db/feishu-bridge';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';
import { downloadFeishuImage } from '@/lib/feishu/image-handler';
import { downloadFeishuFile } from '@/lib/feishu/file-handler';
import { getMimeType } from '@/lib/file-categories';
import type { FileAttachment } from '@/types';
import path from 'node:path';
import { ConversationEngine } from './conversation-engine';
import { feishuSend, syncMessageToFeishu } from './sync-helper';

const processedMessages = new Set<string>();
const conversationEngine = new ConversationEngine();

const FILE_DIRECTIVE_PREFIX = 'FEISHU_SEND_FILE::';

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

export async function handleFeishuMessage(message: any) {
  const msg = message?.message;
  if (!msg) return;

  // Ignore messages sent by the app itself to avoid loops
  if (message.sender?.sender_type === 'app') return;

  const messageId = msg.message_id as string | undefined;
  if (!messageId || processedMessages.has(messageId)) return;

  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 60000);

  const chatId = msg.chat_id as string | undefined;
  const content = msg.content as string | undefined;
  const messageType = msg.message_type as string | undefined;

  if (!chatId || !content || !messageType) return;

  // Only handle text/image/file messages for now
  if (messageType !== 'text' && messageType !== 'image' && messageType !== 'file') return;

  const binding = getSessionBindingByPlatformChat('feishu', chatId);
  if (!binding || binding.status !== 'active') return;

  let text = '';
  let attachments: FileAttachment[] | undefined;
  let parsed: any = null;

  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = null;
  }

  try {
    if (messageType === 'text') {
      text = (parsed?.text || String(content || '')).trim();
      if (!text) return;
    } else {
      const appId = process.env.FEISHU_APP_ID;
      const appSecret = process.env.FEISHU_APP_SECRET;
      if (!appId || !appSecret) {
        console.error('[Bridge] Missing FEISHU_APP_ID/FEISHU_APP_SECRET for media download');
        return;
      }

      const feishuApi = new FeishuAPI(appId, appSecret);
      const token = await feishuApi.getToken();

      if (messageType === 'image') {
        const imageKey = parsed?.image_key;
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
      } else if (messageType === 'file') {
        const fileKey = parsed?.file_key;
        const fileName = parsed?.file_name || `feishu-file-${messageId || Date.now()}`;
        if (!fileKey || !messageId) return;
        const buffer = await downloadFeishuFile(fileKey, messageId, token);
        const ext = path.extname(fileName);
        const mime = ext ? getMimeType(ext) : 'application/octet-stream';
        attachments = [{
          id: `feishu-file-${messageId}`,
          name: fileName,
          type: mime,
          size: buffer.length,
          data: buffer.toString('base64'),
        }];
        text = `[用户发送了文件: ${fileName}]`;
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
    const response = await conversationEngine.sendMessage(sessionId, text, attachments);
    if (response) {
      const directives = extractFileDirectives(response);
      const cleanResponse = stripFileDirectives(response);

      if (cleanResponse) {
        await syncMessageToFeishu(sessionId, 'assistant', cleanResponse);
      }

      if (directives.length > 0) {
        const sentNames: string[] = [];
        const failed: string[] = [];

        for (const filePath of directives) {
          const result = await feishuSend({
            sessionId,
            mode: 'file',
            mediaIds: [filePath],
          });

          if (result.ok) {
            sentNames.push(path.basename(filePath));
          } else {
            failed.push(`${path.basename(filePath)} (${result.error || 'SEND_FAILED'})`);
          }
        }

        if (sentNames.length > 0) {
          await syncMessageToFeishu(
            sessionId,
            'assistant',
            `已发送文件：${sentNames.join('、')}`,
          );
        }
        if (failed.length > 0) {
          await syncMessageToFeishu(
            sessionId,
            'assistant',
            `发送失败：${failed.join('、')}`,
          );
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
