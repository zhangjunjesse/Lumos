/**
 * 多模态消息处理器
 */

import { downloadFeishuImage, imageToBase64 } from './image-handler';
import { downloadFeishuFile, extractTextFromFile } from './file-handler';
import { parseCommand } from './command-parser';
import { executeCommand } from './command-handlers';

export interface ProcessedMessage {
  type: 'text' | 'command' | 'multimodal';
  text: string;
  attachments?: Array<{ type: string; data: string }>;
}

export async function processFeishuMessage(
  messageType: string,
  content: string,
  messageId: string,
  token: string,
  sessionId: string,
  chatId: string
): Promise<ProcessedMessage> {
  const parsed = JSON.parse(content);

  // 检查是否为命令
  if (messageType === 'text') {
    const command = parseCommand(parsed.text);
    if (command) {
      const result = await executeCommand(command, { sessionId, chatId });
      return { type: 'command', text: result };
    }
    return { type: 'text', text: parsed.text };
  }

  // 处理图片
  if (messageType === 'image') {
    const imageBuffer = await downloadFeishuImage(parsed.image_key, token, messageId);
    const imageBase64 = imageToBase64(imageBuffer);
    return {
      type: 'multimodal',
      text: '[用户发送了一张图片]',
      attachments: [{ type: 'image', data: imageBase64 }]
    };
  }

  // 处理文件
  if (messageType === 'file') {
    const fileBuffer = await downloadFeishuFile(parsed.file_key, messageId, token);
    const fileText = await extractTextFromFile(fileBuffer, parsed.file_type);
    return {
      type: 'multimodal',
      text: `[文件: ${parsed.file_name}]\n\n${fileText}`,
      attachments: [{ type: 'file', data: fileText }]
    };
  }

  return { type: 'text', text: '[不支持的消息类型]' };
}
