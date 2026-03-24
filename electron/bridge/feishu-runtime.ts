import * as lark from '@larksuiteoapi/node-sdk';
import type {
  BridgeRuntimeConnectionSnapshot,
  BridgeRuntimeTransportStatus,
} from '../../src/lib/bridge/runtime-config';

export interface FeishuRuntimeBootstrap {
  configured: boolean;
  appId?: string;
  appSecret?: string;
  domain?: 'feishu' | 'lark';
  bindings?: Array<{
    bindingId: number;
    sessionId: string;
    chatId: string;
    createdAt: number;
    lastInboundAt?: number | null;
  }>;
}

interface FeishuBridgeRuntimeOptions {
  onEvent: (event: unknown) => Promise<void>;
}

const RECONNECT_GRACE_MS = 30_000;
const FORCE_RESTART_AFTER_MS = 60_000;
const FEISHU_QUERY_TIME_MS_THRESHOLD = 10_000_000_000;

export function toFeishuQueryTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '0';
  }

  if (timestamp > FEISHU_QUERY_TIME_MS_THRESHOLD) {
    return String(Math.floor(timestamp / 1000));
  }

  return String(Math.floor(timestamp));
}

function stringifyLog(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      try {
        return JSON.stringify(part);
      } catch {
        return String(part);
      }
    })
    .join(' ');
}

export class FeishuBridgeRuntime {
  private client: lark.WSClient | null = null;
  private restClient: lark.Client | null = null;
  private running = false;
  private configSignature = '';
  private lastConnectedAt: number | null = null;
  private lastDisconnectedAt: number | null = null;
  private lastEventAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastErrorMessage: string | null = null;

  constructor(private readonly options: FeishuBridgeRuntimeOptions) {}

  isRunning(): boolean {
    return this.running;
  }

  shouldRestart(now = Date.now()): boolean {
    const snapshot = this.getSnapshot();
    if (snapshot.status === 'disconnected') {
      return true;
    }
    if (snapshot.status === 'starting') {
      return Boolean(snapshot.lastDisconnectedAt && now - snapshot.lastDisconnectedAt > FORCE_RESTART_AFTER_MS);
    }
    if (snapshot.status === 'reconnecting') {
      const unhealthySince = Math.max(snapshot.lastErrorAt || 0, snapshot.lastDisconnectedAt || 0);
      return unhealthySince > 0 && now - unhealthySince > FORCE_RESTART_AFTER_MS;
    }
    return false;
  }

  matchesConfig(config: FeishuRuntimeBootstrap): boolean {
    return this.configSignature === this.toConfigSignature(config);
  }

  async start(config: FeishuRuntimeBootstrap): Promise<void> {
    if (!config.configured || !config.appId || !config.appSecret) {
      await this.stop('Bridge runtime is not configured');
      return;
    }

    if (this.running && this.matchesConfig(config)) {
      return;
    }

    if (this.running) {
      await this.stop();
    }

    this.configSignature = this.toConfigSignature(config);
    this.lastErrorAt = null;
    this.lastErrorMessage = null;
    this.running = true;

    const logger = this.createLogger();
    const domain = config.domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu;
    this.restClient = new lark.Client({
      appId: config.appId,
      appSecret: config.appSecret,
      domain,
    });
    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        this.lastEventAt = Date.now();
        void this.options.onEvent(data).catch((error) => {
          this.lastErrorAt = Date.now();
          this.lastErrorMessage = error instanceof Error ? error.message : 'Feishu runtime event handler failed';
          console.error('[bridge-runtime][feishu] event handler failed:', error);
        });
      },
    });

    this.client = new lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain,
      logger,
    });

    this.client.start({ eventDispatcher: dispatcher });
  }

  async stop(reason?: string): Promise<void> {
    const wasRunning = this.running || Boolean(this.client);
    this.running = false;
    this.configSignature = '';

    if (reason) {
      this.lastErrorAt = Date.now();
      this.lastErrorMessage = reason;
    } else {
      this.lastErrorAt = null;
      this.lastErrorMessage = null;
    }

    if (this.client) {
      try {
        this.client.close({ force: true });
      } catch (error) {
        console.warn('[bridge-runtime][feishu] close failed:', error);
      }
      this.client = null;
    }
    this.restClient = null;

    if (wasRunning) {
      this.lastDisconnectedAt = Date.now();
    }
  }

  async listChatMessages(params: {
    chatId: string;
    startTime: number;
    endTime?: number;
    pageSize?: number;
    pageToken?: string;
  }): Promise<{
    hasMore: boolean;
    pageToken?: string;
    items: Array<{
      message_id?: string;
      msg_type?: string;
      create_time?: string;
      chat_id?: string;
      body?: { content: string };
      mentions?: Array<{ key: string; id: string; id_type: string; name: string }>;
      sender?: { id: string; id_type: string; sender_type: string };
    }>;
  }> {
    if (!this.restClient) {
      throw new Error('Feishu REST client not initialized');
    }

    const response = await this.restClient.im.v1.message.list({
      params: {
        container_id_type: 'chat',
        container_id: params.chatId,
        // Feishu message.list expects second-based query timestamps even though
        // message.create_time in responses is millisecond-based.
        start_time: toFeishuQueryTimestamp(params.startTime),
        end_time: toFeishuQueryTimestamp(params.endTime ?? Date.now()),
        sort_type: 'ByCreateTimeAsc',
        page_size: params.pageSize ?? 20,
        ...(params.pageToken ? { page_token: params.pageToken } : {}),
      },
    });

    if (response?.code !== 0) {
      throw new Error(`feishu-message-list-failed:${response?.code ?? 'unknown'}:${response?.msg ?? 'unknown'}`);
    }

    return {
      hasMore: Boolean(response.data?.has_more),
      pageToken: response.data?.page_token,
      items: response.data?.items || [],
    };
  }

  getSnapshot(): BridgeRuntimeConnectionSnapshot {
    const status = this.resolveStatus();
    return {
      platform: 'feishu',
      accountId: 'default',
      transportKind: 'websocket',
      status,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastEventAt: this.lastEventAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      pid: process.pid,
    };
  }

  private resolveStatus(): BridgeRuntimeTransportStatus {
    if (!this.running || !this.client) {
      return 'disconnected';
    }

    const now = Date.now();
    let nextConnectTime = 0;

    try {
      const info = this.client.getReconnectInfo();
      if (info.lastConnectTime > 0 && (!this.lastConnectedAt || info.lastConnectTime > this.lastConnectedAt)) {
        this.lastConnectedAt = info.lastConnectTime;
      }
      nextConnectTime = info.nextConnectTime;
    } catch {
      // Ignore status probing failures and fall back to local lifecycle state.
    }

    const lastUnhealthyAt = Math.max(this.lastErrorAt || 0, this.lastDisconnectedAt || 0);
    const hasUnrecoveredFailure = Boolean(
      lastUnhealthyAt > 0 && (!this.lastConnectedAt || lastUnhealthyAt >= this.lastConnectedAt),
    );

    if (nextConnectTime > now) {
      return 'reconnecting';
    }

    if (hasUnrecoveredFailure) {
      return now - lastUnhealthyAt < RECONNECT_GRACE_MS ? 'reconnecting' : 'disconnected';
    }

    if (this.lastConnectedAt) {
      return 'connected';
    }

    return 'starting';
  }

  private toConfigSignature(config: FeishuRuntimeBootstrap): string {
    return JSON.stringify({
      configured: config.configured,
      appId: config.appId || '',
      appSecret: config.appSecret || '',
      domain: config.domain || 'feishu',
    });
  }

  private createLogger(): lark.Logger {
    return {
      debug: (...parts: unknown[]) => {
        const message = stringifyLog(parts);
        if (message.includes('ws connect success') || message.includes('reconnect success')) {
          this.lastConnectedAt = Date.now();
          this.lastErrorAt = null;
          this.lastErrorMessage = null;
        }
        if (message.includes('client closed')) {
          this.lastDisconnectedAt = Date.now();
        }
        console.debug('[bridge-runtime][feishu]', ...parts);
      },
      info: (...parts: unknown[]) => {
        const message = stringifyLog(parts);
        if (message.includes('reconnect')) {
          this.lastDisconnectedAt = Date.now();
        }
        console.log('[bridge-runtime][feishu]', ...parts);
      },
      warn: (...parts: unknown[]) => {
        console.warn('[bridge-runtime][feishu]', ...parts);
      },
      error: (...parts: unknown[]) => {
        this.lastDisconnectedAt = Date.now();
        this.lastErrorAt = Date.now();
        this.lastErrorMessage = stringifyLog(parts) || 'Feishu runtime error';
        console.error('[bridge-runtime][feishu]', ...parts);
      },
    };
  }
}
