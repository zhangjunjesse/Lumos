import { getSessionBindingByPlatformChat, recordMessageSync } from '@/lib/db/feishu-bridge';
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

  // Only handle text messages for now
  if (messageType !== 'text') return;

  const binding = getSessionBindingByPlatformChat('feishu', chatId);
  if (!binding || binding.status !== 'active') return;

  let text = '';
  try {
    const parsed = JSON.parse(content);
    text = (parsed.text || '').trim();
  } catch {
    text = String(content || '').trim();
  }

  if (!text) return;

  const sessionId = binding.lumos_session_id;

  try {
    const response = await conversationEngine.sendMessage(sessionId, text);
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
