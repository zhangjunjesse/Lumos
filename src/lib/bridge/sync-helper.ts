import { getDb } from '@/lib/db';
import { FeishuAPI } from '@/lib/bridge/adapters/feishu-api';
import { recordMessageSync } from '@/lib/db/feishu-bridge';
import { parseMessageContent } from '@/types';
import fs from 'node:fs/promises';
import path from 'node:path';

type FeishuSendMode = 'text' | 'image' | 'file';

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
}) {
  const { chatId, role, content, bindingId } = params;
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) return { ok: false as const };

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
  } catch {
    // ignore parse errors
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

  return { ok: true as const, messageId };
}

/**
 * Legacy helper used by实时会话绑定：按角色同步单条消息到飞书。
 */
export async function syncMessageToFeishu(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
) {
  try {
    if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
      return { ok: false as const };
    }

    const db = getDb();
    const binding = db
      .prepare(
        'SELECT id, platform_chat_id FROM session_bindings WHERE lumos_session_id = ? AND platform = ? AND status = ?',
      )
      .get(sessionId, 'feishu', 'active') as
      | { id: number; platform_chat_id: string }
      | undefined;

    if (!binding?.platform_chat_id) return { ok: false as const };

    return await sendInteractiveCard({
      chatId: binding.platform_chat_id,
      role,
      content,
      bindingId: binding.id,
    });
  } catch (err) {
    console.error('[Sync] Failed to sync message:', err);
    return { ok: false as const };
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
}) {
  const { sessionId, mode, content, mediaIds } = params;

  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    return { ok: false as const, error: 'FEISHU_NOT_CONFIGURED' as const };
  }

  if (mode === 'text') {
    if (!content?.trim()) {
      return { ok: false as const, error: 'EMPTY_CONTENT' as const };
    }
    return syncMessageToFeishu(sessionId, 'assistant', content);
  }

  if (mode !== 'file' && mode !== 'image') {
    return { ok: false as const, error: 'MODE_NOT_IMPLEMENTED' as const };
  }

  if (!mediaIds || mediaIds.length === 0) {
    return { ok: false as const, error: 'EMPTY_MEDIA' as const };
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
    return { ok: false as const, error: 'NO_ACTIVE_BINDING' as const };
  }

  const feishuApi = new FeishuAPI(appId, appSecret);
  const messageIds: string[] = [];

  for (const mediaId of mediaIds) {
    const resolvedPath = path.isAbsolute(mediaId)
      ? mediaId
      : path.resolve(process.cwd(), mediaId);

    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(resolvedPath);
    } catch {
      stat = null;
    }

    if (!stat || !stat.isFile()) {
      return { ok: false as const, error: 'FILE_NOT_FOUND' as const };
    }

    try {
      const buffer = await fs.readFile(resolvedPath);
      const fileName = path.basename(resolvedPath);
      const uploaded = await feishuApi.uploadFile(fileName, buffer);
      const sent = await feishuApi.sendFileMessage(
        binding.platform_chat_id,
        uploaded.file_key,
      );

      messageIds.push(sent.message_id);
      recordMessageSync({
        bindingId: binding.id,
        messageId: sent.message_id,
        sourcePlatform: 'lumos',
        direction: 'to_platform',
        status: 'success',
      });
    } catch (err: any) {
      console.error('[FeishuSend] Failed to send file:', err);
      recordMessageSync({
        bindingId: binding.id,
        messageId: `file:${resolvedPath}`,
        sourcePlatform: 'lumos',
        direction: 'to_platform',
        status: 'failed',
        errorMessage: err?.message || 'send failed',
      });
      return { ok: false as const, error: 'SEND_FAILED' as const };
    }
  }

  return { ok: true as const, messageId: messageIds[messageIds.length - 1], messageIds };
}
