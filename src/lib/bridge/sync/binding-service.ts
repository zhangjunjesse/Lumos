import QRCode from 'qrcode';
import { SyncManager } from './sync-manager';
import Database from 'better-sqlite3';

export class BindingService {
  private syncManager: SyncManager;
  private feishuClient: any;

  constructor(db: Database.Database, feishuClient: any) {
    this.syncManager = new SyncManager(db);
    this.feishuClient = feishuClient;
  }

  async createBinding(sessionId: string, sessionTitle: string) {
    const chatResponse = await this.feishuClient.createChat({
      name: `Lumos - ${sessionTitle}`,
      description: 'Lumos AI助手会话',
      chat_mode: 'group',
      chat_type: 'private'
    });
    const chatId = chatResponse.data.chat_id;
    const linkResponse = await this.feishuClient.createChatLink(chatId);
    const shareLink = linkResponse.data.share_link;
    const qrCode = await QRCode.toDataURL(shareLink);
    const bindingId = this.syncManager.createBinding(sessionId, chatId, 'feishu');
    return { bindingId, chatId, qrCode, shareLink };
  }
}
