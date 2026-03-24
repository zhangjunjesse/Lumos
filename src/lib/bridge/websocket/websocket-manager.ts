import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuAdapter } from '../adapters/feishu-adapter';
import {
  recordBridgeConnectionError,
  touchBridgeConnectionEvent,
  upsertBridgeConnection,
  type BridgeTransportStatus,
} from '../storage/bridge-connection-repo';

const FEISHU_TRANSPORT_KIND = 'websocket' as const;
const FEISHU_ACCOUNT_ID = 'default';

/**
 * Singleton WebSocket manager for Feishu
 * Shares one WebSocket connection across multiple sessions
 */
export class WebSocketManager {
  private static instance: WebSocketManager;
  private wsClient: lark.WSClient | null = null;
  private adapters = new Set<FeishuAdapter>();
  private running = false;
  private onMessage?: (data: unknown) => Promise<void>;
  private status: BridgeTransportStatus = 'disconnected';
  private lastConnectedAt: number | null = null;
  private lastDisconnectedAt: number | null = null;
  private lastEventAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastErrorMessage: string | null = null;

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
    onMessage?: (data: unknown) => Promise<void>;
  }) {
    if (this.running) return;

    const { appId, appSecret, domain = 'feishu', onMessage } = config;
    this.onMessage = onMessage;
    const larkDomain = domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
    this.status = 'starting';
    upsertBridgeConnection({
      platform: 'feishu',
      accountId: FEISHU_ACCOUNT_ID,
      transportKind: FEISHU_TRANSPORT_KIND,
      status: 'starting',
    });

    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        await this.broadcastMessage(data);
      },
    });

    this.wsClient = new lark.WSClient({ appId, appSecret, domain: larkDomain });
    await this.wsClient.start({ eventDispatcher: dispatcher });
    this.running = true;
    this.status = 'connected';
    this.lastConnectedAt = Date.now();
    this.lastErrorAt = null;
    this.lastErrorMessage = null;
    upsertBridgeConnection({
      platform: 'feishu',
      accountId: FEISHU_ACCOUNT_ID,
      transportKind: FEISHU_TRANSPORT_KIND,
      status: 'connected',
      lastConnectedAt: this.lastConnectedAt,
    });
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
  private async broadcastMessage(data: unknown) {
    this.lastEventAt = Date.now();
    touchBridgeConnectionEvent({
      platform: 'feishu',
      accountId: FEISHU_ACCOUNT_ID,
      transportKind: FEISHU_TRANSPORT_KIND,
      at: this.lastEventAt,
    });

    try {
      // Call onMessage callback if provided
      if (this.onMessage) {
        await this.onMessage(data);
      }

      // Also broadcast to adapters
      for (const adapter of this.adapters) {
        await adapter.handleMessage(data);
      }
    } catch (error) {
      this.lastErrorAt = Date.now();
      this.lastErrorMessage = error instanceof Error ? error.message : 'Failed to process Feishu event';
      recordBridgeConnectionError({
        platform: 'feishu',
        accountId: FEISHU_ACCOUNT_ID,
        transportKind: FEISHU_TRANSPORT_KIND,
        errorMessage: this.lastErrorMessage,
        at: this.lastErrorAt,
      });
      throw error;
    }
  }

  /**
   * Stop WebSocket connection
   */
  stop() {
    if (!this.running) return;
    this.running = false;
    this.status = 'disconnected';
    this.lastDisconnectedAt = Date.now();
    this.wsClient?.close({ force: true });
    this.wsClient = null;
    this.adapters.clear();
    upsertBridgeConnection({
      platform: 'feishu',
      accountId: FEISHU_ACCOUNT_ID,
      transportKind: FEISHU_TRANSPORT_KIND,
      status: 'disconnected',
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastEventAt: this.lastEventAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
    });
  }

  /**
   * Check if WebSocket is running
   */
  isRunning(): boolean {
    return this.running;
  }

  getHealthSnapshot() {
    return {
      status: this.status,
      running: this.running,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastEventAt: this.lastEventAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
    };
  }
}
