import type { ChannelType, InboundMessage } from './types';
import { BaseChannelAdapter } from './channel-adapter';
import './adapters'; // 确保注册代码执行
import { createAdapter } from './adapters/adapter-factory';
import { ChannelRouter } from './channel-router';
import { DeliveryLayer } from './delivery-layer';
import { ConversationEngine } from './conversation-engine';
import type Database from 'better-sqlite3';

type MessageHandler = (sessionId: string, userMessage: string, aiResponse: string) => void;

export class BridgeManager {
  private adapters = new Map<ChannelType, BaseChannelAdapter>();
  private router: ChannelRouter;
  private delivery = new DeliveryLayer();
  private conversation = new ConversationEngine();
  private running = false;
  private onMessageHandled?: MessageHandler;

  constructor(database: Database.Database) {
    this.router = new ChannelRouter(database);
  }

  setMessageHandler(handler: MessageHandler) {
    this.onMessageHandled = handler;
  }

  async start(enabledAdapters: ChannelType[]) {
    if (this.running) return;
    this.running = true;

    for (const type of enabledAdapters) {
      const adapter = createAdapter(type);
      await adapter.start();
      this.adapters.set(type, adapter);
    }

    this.processMessages();
  }

  async stop() {
    this.running = false;
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
    this.adapters.clear();
  }

  private async processMessages() {
    while (this.running) {
      for (const adapter of this.adapters.values()) {
        const message = await adapter.consumeOne();
        if (message) await this.handleMessage(adapter, message);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private async handleMessage(adapter: BaseChannelAdapter, message: InboundMessage) {
    try {
      const binding = await this.router.resolve(message.address);
      if (!this.conversation.hasSession(binding.lumos_session_id)) {
        await this.conversation.createSession(binding.lumos_session_id);
      }
      const response = await this.conversation.sendMessage(binding.lumos_session_id, message.text);
      await this.delivery.deliver(adapter, { address: message.address, text: response });

      if (this.onMessageHandled) {
        this.onMessageHandled(binding.lumos_session_id, message.text, response);
      }
    } catch (error) {
      console.error('Failed to handle message:', error);
    }
  }
}
