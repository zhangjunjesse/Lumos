import WebSocket from 'ws';
import { SyncManager } from './sync-manager';

interface FeishuMessage {
  messageId: string;
  chatId: string;
  content: string;
  senderId: string;
}

export class FeishuEventListener {
  private ws: WebSocket | null = null;
  private syncManager: SyncManager;
  private appToken: string;
  private reconnectAttempts = 0;
  private maxReconnects = 10;
  onMessageReceived?: (message: FeishuMessage) => Promise<void>;

  constructor(syncManager: SyncManager, appToken: string) {
    this.syncManager = syncManager;
    this.appToken = appToken;
  }

  async start(): Promise<void> {
    const wsUrl = await this.getWebSocketUrl();
    this.connect(wsUrl);
  }

  private async getWebSocketUrl(): Promise<string> {
    const response = await fetch('https://open.feishu.cn/open-api/im/v1/stream/open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.appToken}`,
        'Content-Type': 'application/json'
      }
    });
    const data = await response.json();
    return data.data.url;
  }

  private connect(url: string): void {
    this.ws = new WebSocket(url);
    this.ws.on('open', () => {
      console.log('[FeishuSync] Connected');
      this.reconnectAttempts = 0;
    });
    this.ws.on('message', async (data) => await this.handleMessage(data.toString()));
    this.ws.on('close', () => this.reconnect());
    this.ws.on('error', (err) => console.error('[FeishuSync] Error:', err));
  }

  private async handleMessage(data: string): Promise<void> {
    const event = JSON.parse(data);
    if (event.type === 'im.message.receive_v1') {
      await this.handleMessageReceive(event);
    } else if (event.type === 'im.chat.member.user.added_v1') {
      await this.syncManager.activateBinding(event.event.chat_id);
    }
  }

  private async handleMessageReceive(event: any): Promise<void> {
    const { chat_id, message_id, content, sender } = event.event.message;
    if (sender.sender_type === 'app') return;
    const binding = await this.syncManager.getBindingByChatId(chat_id);
    if (!this.syncManager.shouldSync(binding, 'from_channel')) return;
    if (this.syncManager.isDuplicate(message_id)) return;
    const text = JSON.parse(content).text;
    await this.onMessageReceived?.({ messageId: message_id, chatId: chat_id, content: text, senderId: sender.sender_id.open_id });
    this.syncManager.logSync(binding!.id, message_id, 'feishu', 'feishu_to_lumos', 'success');
  }

  private reconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnects) return;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    setTimeout(async () => {
      const wsUrl = await this.getWebSocketUrl();
      this.connect(wsUrl);
    }, delay);
  }

  stop(): void {
    this.ws?.close();
    this.ws = null;
  }
}
