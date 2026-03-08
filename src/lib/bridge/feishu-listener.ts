import * as lark from '@larksuiteoapi/node-sdk';

interface FeishuListenerConfig {
  appId: string;
  appSecret: string;
  serverPort: number;
  onMessage: (chatId: string, text: string, messageId: string) => void;
}

export class FeishuListener {
  private client: lark.WSClient | null = null;
  private config: FeishuListenerConfig;
  private processedMessages = new Set<string>();

  constructor(config: FeishuListenerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': this.handleMessage.bind(this)
    });

    this.client = new lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    });

    await this.client.start({ eventDispatcher: dispatcher });
    console.log('[FeishuListener] Started');
  }

  private async handleMessage(data: any): Promise<void> {
    const msg = data.message;

    // Filter bot's own messages
    if (data.sender?.sender_type === 'app') return;

    // Deduplication
    if (this.processedMessages.has(msg.message_id)) return;
    this.processedMessages.add(msg.message_id);

    // Only text messages
    if (msg.message_type !== 'text') return;

    const content = JSON.parse(msg.content);
    const text = content.text?.trim();
    if (!text) return;

    this.config.onMessage(msg.chat_id, text, msg.message_id);
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.close({ force: true });
      this.client = null;
    }
  }
}
