import {
  BRIDGE_RUNTIME_TOKEN_HEADER,
  persistBridgeRuntimeSnapshot,
  type BridgeRuntimeConnectionSnapshot,
} from '../../src/lib/bridge/runtime-config';
import { FeishuBridgeRuntime, type FeishuRuntimeBootstrap } from './feishu-runtime';

interface BridgeBootstrapResponse {
  feishu?: FeishuRuntimeBootstrap;
}

interface BridgeRuntimeManagerOptions {
  baseUrl: string;
  token: string;
  onUiEvent?: (eventName: BridgeRuntimeUiEventName, payload: BridgeRuntimeUiEventPayload) => void;
}

const STATUS_SYNC_INTERVAL_MS = 5_000;
const MESSAGE_POLL_LOOKBACK_MS = 60_000;
const MESSAGE_POLL_PAGE_SIZE = 50;
const MESSAGE_POLL_MAX_PAGES = 4;

interface PollCursorState {
  lastPolledAt: number;
}

type BridgeRuntimeUiEventName =
  | 'inbound-processing'
  | 'inbound-completed'
  | 'inbound-failed';

interface BridgeRuntimeUiEventPayload {
  sessionId: string;
  bindingId: number;
  chatId: string;
  messageId: string;
  transportKind: 'websocket' | 'polling';
  previewText?: string;
  error?: string;
}

export class FeishuBridgeRuntimeManager {
  private readonly runtime: FeishuBridgeRuntime;
  private started = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private baseUrl: string;
  private pollCursors = new Map<string, PollCursorState>();
  private bindingsByChatId = new Map<string, NonNullable<FeishuRuntimeBootstrap['bindings']>[number]>();
  private polling = false;

  constructor(private readonly options: BridgeRuntimeManagerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.runtime = new FeishuBridgeRuntime({
      onEvent: async (event) => {
        await this.forwardEvent(event);
      },
    });
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async start(): Promise<void> {
    if (this.started) {
      await this.syncNow();
      return;
    }

    this.started = true;
    await this.syncNow();

    this.syncTimer = setInterval(() => {
      void this.syncNow();
    }, STATUS_SYNC_INTERVAL_MS);
    this.syncTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    await this.runtime.stop();
    await this.pushStatus();
  }

  private async syncNow(): Promise<void> {
    try {
      const bootstrap = await this.fetchBootstrap();
      const config = bootstrap.feishu;
      if (!config?.configured || !config.appId || !config.appSecret) {
        if (this.runtime.isRunning()) {
          await this.runtime.stop('Bridge runtime is not configured');
        }
        await this.pushStatus();
        return;
      }

      if (!this.runtime.isRunning() || !this.runtime.matchesConfig(config)) {
        await this.runtime.start(config);
      } else if (this.runtime.shouldRestart()) {
        console.warn('[bridge-runtime] restarting unhealthy Feishu runtime');
        await this.runtime.stop('Bridge runtime unhealthy, restarting');
        await this.runtime.start(config);
      }

      this.updateBindings(config.bindings || []);
      await this.pollBindings(config.bindings || []);
      await this.pushStatus();
    } catch (error) {
      console.error('[bridge-runtime] sync failed:', error);
      const snapshot = this.runtime.getSnapshot();
      persistBridgeRuntimeSnapshot({
        ...snapshot,
        status: 'disconnected',
        lastErrorAt: Date.now(),
        lastErrorMessage: error instanceof Error ? error.message : 'Bridge runtime sync failed',
      }, this.options.token);
    }
  }

  private async fetchBootstrap(): Promise<BridgeBootstrapResponse> {
    const response = await fetch(`${this.baseUrl}/api/bridge/runtime/bootstrap`, {
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`bridge-bootstrap-${response.status}`);
    }
    return response.json() as Promise<BridgeBootstrapResponse>;
  }

  private async forwardEvent(
    event: unknown,
    transportKind: 'websocket' | 'polling' = 'websocket',
    bindingHint?: NonNullable<FeishuRuntimeBootstrap['bindings']>[number],
  ): Promise<void> {
    const bridgeEvent = this.extractBridgeEvent(event, bindingHint);
    if (bridgeEvent) {
      this.options.onUiEvent?.('inbound-processing', bridgeEvent);
    }

    const response = await fetch(`${this.baseUrl}/api/bridge/runtime/ingest`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        platform: 'feishu',
        accountId: 'default',
        receivedAt: Date.now(),
        transportKind,
        event,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (bridgeEvent) {
        this.options.onUiEvent?.('inbound-failed', {
          ...bridgeEvent,
          error: text || `bridge-ingest-${response.status}`,
        });
      }
      throw new Error(`bridge-ingest-${response.status}${text ? `:${text}` : ''}`);
    }

    if (bridgeEvent) {
      this.options.onUiEvent?.('inbound-completed', bridgeEvent);
    }
    await this.pushStatus();
  }

  private async pollBindings(bindings: NonNullable<FeishuRuntimeBootstrap['bindings']>): Promise<void> {
    if (this.polling || bindings.length === 0) {
      this.prunePollCursors(bindings);
      return;
    }

    this.polling = true;
    try {
      this.prunePollCursors(bindings);
      for (const binding of bindings) {
        await this.pollBinding(binding);
      }
    } finally {
      this.polling = false;
    }
  }

  private prunePollCursors(bindings: NonNullable<FeishuRuntimeBootstrap['bindings']>): void {
    const activeChats = new Set(bindings.map((binding) => binding.chatId));
    this.bindingsByChatId = new Map(bindings.map((binding) => [binding.chatId, binding]));
    for (const chatId of this.pollCursors.keys()) {
      if (!activeChats.has(chatId)) {
        this.pollCursors.delete(chatId);
      }
    }
  }

  private async pollBinding(binding: NonNullable<FeishuRuntimeBootstrap['bindings']>[number]): Promise<void> {
    const currentCursor = this.pollCursors.get(binding.chatId);
    const startTime = currentCursor?.lastPolledAt
      ?? Math.max(
        binding.createdAt - MESSAGE_POLL_LOOKBACK_MS,
        (binding.lastInboundAt ?? binding.createdAt) - MESSAGE_POLL_LOOKBACK_MS,
      );

    let nextCursor = startTime;
    let pageToken: string | undefined;
    let pageCount = 0;

    while (pageCount < MESSAGE_POLL_MAX_PAGES) {
      const page = await this.runtime.listChatMessages({
        chatId: binding.chatId,
        startTime,
        pageToken,
        pageSize: MESSAGE_POLL_PAGE_SIZE,
      });

      for (const item of page.items) {
        const createTime = Number(item.create_time || 0);
        const normalized = this.normalizePolledMessage(item);
        if (!normalized) {
          if (createTime > nextCursor) nextCursor = createTime;
          continue;
        }

        await this.forwardEvent(normalized, 'polling', binding);
        if (createTime > nextCursor) nextCursor = createTime;
      }

      if (!page.hasMore || !page.pageToken) {
        break;
      }

      pageToken = page.pageToken;
      pageCount += 1;
    }

    this.pollCursors.set(binding.chatId, {
      lastPolledAt: Math.max(nextCursor, Date.now() - 1_000),
    });
  }

  private normalizePolledMessage(item: {
    message_id?: string;
    msg_type?: string;
    create_time?: string;
    chat_id?: string;
    body?: { content: string };
    mentions?: Array<{ key: string; id: string; id_type: string; name: string }>;
    sender?: { id: string; id_type: string; sender_type: string };
  }): Record<string, unknown> | null {
    if (!item.message_id || !item.chat_id || !item.msg_type || !item.body?.content) {
      return null;
    }

    if (item.sender?.sender_type === 'app') {
      return null;
    }

    return {
      message: {
        message_id: item.message_id,
        chat_id: item.chat_id,
        content: item.body.content,
        message_type: item.msg_type,
        mentions: item.mentions || [],
      },
      sender: {
        sender_type: item.sender?.sender_type || 'user',
        sender_id: item.sender?.id_type === 'open_id'
          ? { open_id: item.sender.id }
          : {},
      },
    };
  }

  private updateBindings(bindings: NonNullable<FeishuRuntimeBootstrap['bindings']>): void {
    this.bindingsByChatId = new Map(bindings.map((binding) => [binding.chatId, binding]));
  }

  private extractBridgeEvent(
    event: unknown,
    bindingHint?: NonNullable<FeishuRuntimeBootstrap['bindings']>[number],
  ): BridgeRuntimeUiEventPayload | null {
    if (!event || typeof event !== 'object') {
      return null;
    }

    const record = event as {
      message?: { chat_id?: string; message_id?: string };
    };
    const chatId = record.message?.chat_id;
    const messageId = record.message?.message_id;
    if (!chatId || !messageId) {
      return null;
    }

    const binding = bindingHint || this.bindingsByChatId.get(chatId);
    if (!binding) {
      return null;
    }

    return {
      sessionId: binding.sessionId,
      bindingId: binding.bindingId,
      chatId,
      messageId,
      transportKind: bindingHint ? 'polling' : 'websocket',
      previewText: this.extractPreviewText(record),
    };
  }

  private extractPreviewText(event: { message?: { content?: string; message_type?: string } }): string | undefined {
    const messageType = event.message?.message_type;
    const rawContent = event.message?.content;
    if (!messageType) {
      return undefined;
    }

    if (messageType === 'text' && rawContent) {
      try {
        const parsed = JSON.parse(rawContent) as { text?: string };
        return parsed.text?.trim() || '[收到一条飞书消息]';
      } catch {
        return rawContent;
      }
    }

    if (messageType === 'image') {
      return '[用户发送了一张图片]';
    }
    if (messageType === 'audio') {
      return '[用户发送了一段音频]';
    }
    if (messageType === 'video') {
      return '[用户发送了一段视频]';
    }
    if (messageType === 'file') {
      return '[用户发送了一个文件]';
    }
    if (messageType === 'media') {
      return '[用户发送了一个媒体文件]';
    }

    return '[收到一条飞书消息]';
  }

  private async pushStatus(): Promise<void> {
    const snapshot = this.runtime.getSnapshot();
    persistBridgeRuntimeSnapshot(snapshot, this.options.token);
    await this.postStatus(snapshot);
  }

  private async postStatus(snapshot: BridgeRuntimeConnectionSnapshot): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/bridge/runtime/status`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`bridge-status-${response.status}${text ? `:${text}` : ''}`);
    }
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      [BRIDGE_RUNTIME_TOKEN_HEADER]: this.options.token,
    };
  }
}
