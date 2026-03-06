import { getSessionBindingByPlatformChat } from '@/lib/db/feishu-bridge';
import { getDb } from '@/lib/db';
import { FeishuAdapter } from './adapters/feishu-adapter';

const processedMessages = new Set<string>();

export async function handleFeishuMessage(message: any) {
  const messageId = message.message?.message_id;
  if (!messageId || processedMessages.has(messageId)) return;

  processedMessages.add(messageId);
  setTimeout(() => processedMessages.delete(messageId), 60000);

  const chatId = message.message?.chat_id;
  const senderId = message.sender?.sender_id?.user_id;
  const content = message.message?.content;

  if (!chatId || !content) return;

  const db = getDb();
  const binding = getSessionBindingByPlatformChat(db, 'feishu', chatId);
  if (!binding) return;

  const contentObj = JSON.parse(content);
  const text = contentObj.text?.trim();
  if (!text) return;

  const adapter = new FeishuAdapter(
    process.env.FEISHU_APP_ID!,
    process.env.FEISHU_APP_SECRET!
  );

  const botInfo = await adapter.getBotInfo();
  if (senderId === botInfo.open_id) return;

  // TODO: Call chat logic here
  console.log('[Bridge] Received message:', { chatId, text, sessionId: binding.session_id });
}
