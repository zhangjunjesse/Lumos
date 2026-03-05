import { SyncManager } from './sync-manager';
import { FeishuAdapter } from '../adapters/feishu-adapter';
import Database from 'better-sqlite3';

/**
 * Sync Coordinator - manages bidirectional sync between Lumos and Feishu
 * Uses FeishuAdapter (SDK-based) for WebSocket communication
 */
export class SyncCoordinator {
  private syncManager: SyncManager;
  private adapter: FeishuAdapter;
  private running = false;

  constructor(db: Database.Database, config: { appId: string; appSecret: string; domain?: 'feishu' | 'lark' }) {
    this.syncManager = new SyncManager(db);
    this.adapter = new FeishuAdapter(config);
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.adapter.start();
    this.running = true;
    this.processMessages();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.adapter.stop();
  }

  /**
   * Process incoming messages from Feishu
   */
  private async processMessages(): Promise<void> {
    while (this.running) {
      const message = await this.adapter.consumeOne();
      if (!message) break;

      const binding = await this.syncManager.getBindingByChatId(message.address.chatId);
      if (!binding) continue;
      if (!this.syncManager.shouldSync(binding, 'from_channel')) continue;
      if (this.syncManager.isDuplicate(message.messageId)) continue;

      await this.onFeishuMessage?.(message);
      this.syncManager.logSync(
        String(binding.id),
        message.messageId,
        'feishu',
        'feishu_to_lumos',
        'success'
      );
    }
  }

  /**
   * Sync message from Lumos to Feishu
   */
  async syncToFeishu(sessionId: string, message: any): Promise<void> {
    const binding = this.syncManager.getBinding(sessionId);
    if (!this.syncManager.shouldSync(binding, 'to_channel')) return;

    try {
      const card = this.toFeishuCard(message);
      const result = await this.adapter.send({
        address: {
          channelType: 'feishu',
          chatId: binding!.platform_chat_id,
          userId: '',
        },
        text: JSON.stringify(card),
      });

      if (result.ok) {
        this.syncManager.logSync(
          String(binding!.id),
          message.id,
          'lumos',
          'lumos_to_feishu',
          'success'
        );
      } else {
        this.syncManager.logSync(
          String(binding!.id),
          message.id,
          'lumos',
          'lumos_to_feishu',
          'failed',
          result.error
        );
      }
    } catch (error: any) {
      this.syncManager.logSync(
        String(binding!.id),
        message.id,
        'lumos',
        'lumos_to_feishu',
        'failed',
        error.message
      );
    }
  }

  private toFeishuCard(message: any) {
    const isUser = message.role === 'user';
    return {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: isUser ? '👤 用户' : '🤖 AI' },
          template: isUser ? 'blue' : 'green',
        },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: message.content } }],
      },
    };
  }

  onFeishuMessage?: (message: any) => Promise<void>;
}
