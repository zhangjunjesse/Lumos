/**
 * Feishu Adapter - WebSocket-based messaging
 */

import * as lark from '@larksuiteoapi/node-sdk';
import type {
  ChannelType,
  InboundMessage,
  OutboundMessage,
  SendResult,
} from '../types';
import { BaseChannelAdapter } from '../channel-adapter';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  domain?: 'feishu' | 'lark';
}

export class FeishuAdapter extends BaseChannelAdapter {
  readonly channelType: ChannelType = 'feishu';

  private config: FeishuConfig | null = null;
  private wsClient: lark.WSClient | null = null;
  private restClient: lark.Client | null = null;
  private running = false;
  private queue: InboundMessage[] = [];
  private waiters: Array<(msg: InboundMessage | null) => void> = [];
  private seenIds = new Set<string>();

  constructor(config?: FeishuConfig) {
    super();
    if (config) this.config = config;
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (!this.config) throw new Error('Config not set');

    const { appId, appSecret, domain = 'feishu' } = this.config;
    const larkDomain = domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;

    this.restClient = new lark.Client({ appId, appSecret, domain: larkDomain });

    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        await this.handleMessage(data as any);
      },
    });

    this.wsClient = new lark.WSClient({ appId, appSecret, domain: larkDomain });
    this.wsClient.start({ eventDispatcher: dispatcher });

    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.wsClient) {
      this.wsClient.close({ force: true });
      this.wsClient = null;
    }
    this.restClient = null;

    for (const w of this.waiters) w(null);
    this.waiters = [];
    this.seenIds.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  async consumeOne(): Promise<InboundMessage | null> {
    const msg = this.queue.shift();
    if (msg) return msg;
    if (!this.running) return null;

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.restClient) {
      return { ok: false, error: 'Client not initialized' };
    }

    try {
      const res = await this.restClient.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: message.address.chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: message.text }),
        },
      });

      if (res?.data?.message_id) {
        return { ok: true, messageId: res.data.message_id };
      }
      return { ok: false, error: res?.msg || 'Send failed' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Send failed' };
    }
  }

  validateConfig(): string | null {
    if (!this.config?.appId) return 'appId required';
    if (!this.config?.appSecret) return 'appSecret required';
    return null;
  }

  isAuthorized(_userId: string, _chatId: string): boolean {
    return true;
  }

  async handleMessage(data: any): Promise<void> {
    const msg = data.message;
    if (!msg || data.sender?.sender_type === 'app') return;
    if (this.seenIds.has(msg.message_id)) return;
    this.seenIds.add(msg.message_id);

    let text = '';
    if (msg.message_type === 'text') {
      try {
        const parsed = JSON.parse(msg.content);
        text = parsed.text || '';
      } catch {
        text = msg.content;
      }
    } else {
      return;
    }

    if (!text.trim()) return;

    const inbound: InboundMessage = {
      messageId: msg.message_id,
      address: {
        channelType: 'feishu',
        chatId: msg.chat_id,
        userId: data.sender?.sender_id?.open_id || '',
      },
      text: text.trim(),
      timestamp: parseInt(msg.create_time, 10) || Date.now(),
    };

    const w = this.waiters.shift();
    if (w) {
      w(inbound);
    } else {
      this.queue.push(inbound);
    }
  }

  setConfig(config: FeishuConfig): void {
    this.config = config;
  }
}
