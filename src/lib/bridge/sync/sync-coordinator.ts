import { SyncManager } from './sync-manager';
import { FeishuEventListener } from './feishu-listener';
import Database from 'better-sqlite3';

export class SyncCoordinator {
  private syncManager: SyncManager;
  private listener: FeishuEventListener;
  private feishuClient: any;

  constructor(db: Database.Database, feishuClient: any, appToken: string) {
    this.syncManager = new SyncManager(db);
    this.listener = new FeishuEventListener(this.syncManager, appToken);
    this.feishuClient = feishuClient;
    this.listener.onMessageReceived = async (msg) => await this.onFeishuMessage?.(msg);
  }

  async start(): Promise<void> {
    await this.listener.start();
  }

  stop(): void {
    this.listener.stop();
  }

  async syncToFeishu(sessionId: string, message: any): Promise<void> {
    const binding = this.syncManager.getBinding(sessionId);
    if (!this.syncManager.shouldSync(binding, 'to_channel')) return;
    try {
      const card = this.toFeishuCard(message);
      await this.feishuClient.sendMessage(binding!.platform_chat_id, card);
      this.syncManager.logSync(String(binding!.id), message.id, 'lumos', 'lumos_to_feishu', 'success');
    } catch (error: any) {
      this.syncManager.logSync(String(binding!.id), message.id, 'lumos', 'lumos_to_feishu', 'failed', error.message);
    }
  }

  private toFeishuCard(message: any) {
    const isUser = message.role === 'user';
    return {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: isUser ? '👤 用户' : '🤖 AI' }, template: isUser ? 'blue' : 'green' },
        elements: [{ tag: 'div', text: { tag: 'lark_md', content: message.content } }]
      }
    };
  }

  onFeishuMessage?: (message: any) => Promise<void>;
}
