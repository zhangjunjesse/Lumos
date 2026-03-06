import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuAdapter } from '../adapters/feishu-adapter';

/**
 * Singleton WebSocket manager for Feishu
 * Shares one WebSocket connection across multiple sessions
 */
export class WebSocketManager {
  private static instance: WebSocketManager;
  private wsClient: lark.WSClient | null = null;
  private adapters = new Set<FeishuAdapter>();
  private running = false;
  private onMessage?: (data: any) => Promise<void>;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  /**
   * Start WebSocket connection
   */
  async start(config: {
    appId: string;
    appSecret: string;
    domain?: 'feishu' | 'lark';
    onMessage?: (data: any) => Promise<void>;
  }) {
    if (this.running) return;

    const { appId, appSecret, domain = 'feishu', onMessage } = config;
    this.onMessage = onMessage;
    const larkDomain = domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;

    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        await this.broadcastMessage(data as any);
      },
    });

    this.wsClient = new lark.WSClient({ appId, appSecret, domain: larkDomain });
    this.wsClient.start({ eventDispatcher: dispatcher });
    this.running = true;
  }

  /**
   * Register an adapter to receive messages
   */
  registerAdapter(adapter: FeishuAdapter) {
    this.adapters.add(adapter);
  }

  /**
   * Unregister an adapter
   */
  unregisterAdapter(adapter: FeishuAdapter) {
    this.adapters.delete(adapter);
    if (this.adapters.size === 0) {
      this.stop();
    }
  }

  /**
   * Broadcast message to all registered adapters
   */
  private async broadcastMessage(data: any) {
    // Call onMessage callback if provided
    if (this.onMessage) {
      await this.onMessage(data);
    }

    // Also broadcast to adapters
    for (const adapter of this.adapters) {
      await adapter.handleMessage(data);
    }
  }

  /**
   * Stop WebSocket connection
   */
  stop() {
    if (!this.running) return;
    this.running = false;
    this.wsClient?.close({ force: true });
    this.wsClient = null;
    this.adapters.clear();
  }

  /**
   * Check if WebSocket is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
