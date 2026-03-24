import { getDb } from '@/lib/db';
import { FeishuAPI } from '../adapters/feishu-api';
import { BindingService } from '../core/binding-service';
import { BridgeHealthService } from './bridge-health-service';
import { feishuSend, type FeishuSendMode } from '../sync-helper';
import { requireActiveFeishuUserAuth } from '../feishu-auth-guard';
import { ensureActiveFeishuToken } from '@/lib/feishu-auth';
import { getFeishuCredentials, isFeishuConfigured } from '@/lib/feishu-config';
import { getInboundPipeline } from '../core/inbound-pipeline';

interface StoredMessageRow {
  role: string;
  content: string;
}

interface ChatSessionRow {
  title?: string;
}

export interface BindChannelInput {
  sessionId: string;
  platform?: 'feishu';
}

export interface SendBridgeMessageInput {
  sessionId: string;
  platform?: 'feishu';
  mode?: FeishuSendMode;
  content?: string;
  mediaIds?: string[];
}

async function syncHistoryMessages(
  feishuApi: FeishuAPI,
  sessionId: string,
  chatId: string,
): Promise<void> {
  const db = getDb();
  const messages = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as StoredMessageRow[];

  for (const msg of messages) {
    const cardContent = {
      config: { wide_screen_mode: true },
      header: {
        title: {
          tag: 'plain_text',
          content: msg.role === 'user' ? '👤 用户' : '🤖 AI',
        },
        template: msg.role === 'user' ? 'blue' : 'green',
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: msg.content } },
      ],
    };

    try {
      const token = await feishuApi.getToken();
      const response = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
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
      });
      const data = await response.json().catch(() => null) as { code?: number; msg?: string } | null;
      if (!response.ok || (data && typeof data.code === 'number' && data.code !== 0)) {
        throw new Error(
          `history-sync-failed:${response.status}:${data?.msg || 'unknown-error'}`
        );
      }
    } catch (error) {
      console.error('[BridgeService] Failed to sync history message:', {
        sessionId,
        chatId,
        role: msg.role,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export class BridgeService {
  readonly bindingService = new BindingService();
  readonly healthService = new BridgeHealthService(this.bindingService);

  async bindChannel(input: BindChannelInput): Promise<{
    chatId: string;
    shareLink: string;
  }> {
    const platform = input.platform || 'feishu';
    if (platform !== 'feishu') {
      throw new Error(`Platform not supported: ${platform}`);
    }
    if (!input.sessionId) {
      throw new Error('Missing sessionId');
    }
    if (!isFeishuConfigured()) {
      throw new Error('FEISHU_NOT_CONFIGURED');
    }

    await ensureActiveFeishuToken();
    const auth = requireActiveFeishuUserAuth();
    if (!auth.ok) {
      throw new Error(auth.code);
    }

    const existing = this.bindingService.getLatestBinding(input.sessionId, 'feishu');
    const { appId, appSecret } = getFeishuCredentials();
    const feishuApi = new FeishuAPI(appId, appSecret);
    const db = getDb();
    const session = db.prepare('SELECT title FROM chat_sessions WHERE id = ?').get(input.sessionId) as ChatSessionRow | undefined;

    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }

    if (existing?.channelId && existing.status !== 'deleted') {
      console.info('[BridgeService] Reusing existing Feishu binding', {
        sessionId: input.sessionId,
        bindingId: existing.id,
        status: existing.status,
        chatId: existing.channelId,
      });

      try {
        const link = await feishuApi.createChatLink(existing.channelId);
        this.bindingService.updateBindingMetadata(existing.id, { shareLink: link.share_link });
        return { chatId: existing.channelId, shareLink: link.share_link };
      } catch (error) {
        console.warn('[BridgeService] Failed to refresh Feishu chat link, reusing existing binding', {
          sessionId: input.sessionId,
          bindingId: existing.id,
          chatId: existing.channelId,
          error: error instanceof Error ? error.message : String(error),
        });
        return { chatId: existing.channelId, shareLink: existing.shareLink || '' };
      }
    }

    const chatName = `Lumos - ${session?.title || 'Chat'}`;
    console.info('[BridgeService] Creating Feishu binding', {
      sessionId: input.sessionId,
      chatName,
    });

    const chat = await feishuApi.createChat(chatName, 'Lumos AI助手');
    console.info('[BridgeService] Feishu chat created', {
      sessionId: input.sessionId,
      chatId: chat.chat_id,
    });

    let shareLink = '';
    try {
      const link = await feishuApi.createChatLink(chat.chat_id);
      shareLink = link.share_link;
      console.info('[BridgeService] Feishu chat link created', {
        sessionId: input.sessionId,
        chatId: chat.chat_id,
      });
    } catch (error) {
      console.warn('[BridgeService] Failed to create Feishu chat link', {
        sessionId: input.sessionId,
        chatId: chat.chat_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const binding = this.bindingService.createBinding({
      sessionId: input.sessionId,
      platform: 'feishu',
      channelId: chat.chat_id,
      channelName: chatName,
      shareLink,
      status: 'pending',
    });
    console.info('[BridgeService] Feishu binding created', {
      sessionId: input.sessionId,
      bindingId: binding.id,
      chatId: chat.chat_id,
    });

    void syncHistoryMessages(feishuApi, input.sessionId, chat.chat_id)
      .then(() => {
        console.info('[BridgeService] History sync completed', {
          sessionId: input.sessionId,
          bindingId: binding.id,
          chatId: chat.chat_id,
        });
      })
      .catch((error) => {
        console.error('[BridgeService] History sync failed', {
          sessionId: input.sessionId,
          bindingId: binding.id,
          chatId: chat.chat_id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return { chatId: chat.chat_id, shareLink };
  }

  getSessionBindings(sessionId: string, platform?: 'feishu') {
    return this.bindingService.listBindings(sessionId, platform);
  }

  getBinding(bindingId: number) {
    return this.bindingService.getBindingById(bindingId);
  }

  updateBindingStatus(bindingId: number, status: 'active' | 'inactive' | 'expired') {
    return this.bindingService.updateBindingStatus(bindingId, status);
  }

  deleteBinding(bindingId: number): void {
    this.bindingService.softDeleteBinding(bindingId);
  }

  getSyncStats(sessionId: string, platform: 'feishu' = 'feishu') {
    const binding = this.bindingService.getLatestBinding(sessionId, platform);
    if (!binding) return null;
    return this.bindingService.getSyncStats(binding.id);
  }

  getSessionHealth(sessionId: string) {
    return this.healthService.getSessionHealth(sessionId);
  }

  async retryEvent(eventId: string): Promise<void> {
    const pipeline = getInboundPipeline();
    await pipeline.retryEvent(eventId);
  }

  resolveBindingByChannel(platform: 'feishu', channelId: string) {
    return this.bindingService.getBindingByChannel(platform, channelId);
  }

  async sendMessage(input: SendBridgeMessageInput) {
    const platform = input.platform || 'feishu';
    if (platform !== 'feishu') {
      throw new Error(`Platform not supported: ${platform}`);
    }

    const result = await feishuSend({
      sessionId: input.sessionId,
      mode: input.mode || 'text',
      content: input.content,
      mediaIds: input.mediaIds,
    });
    return result;
  }
}

let bridgeService: BridgeService | null = null;

export function getBridgeService(): BridgeService {
  if (!bridgeService) {
    bridgeService = new BridgeService();
  }
  return bridgeService;
}
