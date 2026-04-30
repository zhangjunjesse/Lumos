/**
 * IM Runtime Manager (Multi-Provider, including Feishu)
 *
 * Phase C 起 feishu 也由这里管理，取代 legacy electron/bridge/feishu-runtime.ts。
 *
 * 工作流：
 *   1. 定期 GET /api/im/runtime/bootstrap 拿当前 enabled providers + 各自 raw config
 *   2. 比对当前在跑的 adapter，启动新增、停止移除、重启 config 改变的
 *   3. 每个 running adapter 起一个 consumeOne 循环，把消息 POST 给 /api/im/runtime/ingest
 *   4. ingest 端按 platform 派发：feishu→legacy handleFeishuMessage（保留 mentions/OAuth/multimodal）
 *      其它→dispatchInbound（generic AI 派发）
 *
 * adapter 类直接从 src/lib/im/providers/<id>/ 相对路径导入。
 * Adapter 实例化只需 plain config object，不依赖 Next.js DB（DB 读取在 bootstrap endpoint 完成）。
 */

import { BRIDGE_RUNTIME_TOKEN_HEADER } from '../../src/lib/bridge/runtime-config';
import {
  WechatAdapter,
  parseWechatConfig,
  FeishuAdapter,
  parseFeishuConfig,
} from './im-providers';

interface ManagerOptions {
  baseUrl: string;
  token: string;
}

interface BootstrapEntry {
  providerId: string;
  config: Record<string, string>;
}

interface BootstrapResponse {
  providers: BootstrapEntry[];
}

type GenericIMAdapter = {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  consumeOne(): Promise<unknown>;
};

interface RunningEntry {
  adapter: GenericIMAdapter;
  configKey: string;
  loopCancelled: boolean;
}

const SYNC_INTERVAL_MS = 8_000;

export class ImRuntimeManager {
  private started = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private baseUrl: string;
  private running = new Map<string, RunningEntry>();

  constructor(private readonly options: ManagerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
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
    }, SYNC_INTERVAL_MS);
    this.syncTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    for (const entry of this.running.values()) {
      entry.loopCancelled = true;
      try { await entry.adapter.stop(); } catch { /* swallow */ }
    }
    this.running.clear();
  }

  private async syncNow(): Promise<void> {
    let bootstrap: BootstrapResponse;
    try {
      bootstrap = await this.fetchBootstrap();
    } catch (err) {
      console.warn('[im-runtime] bootstrap failed:', err instanceof Error ? err.message : err);
      return;
    }

    const desired = new Map<string, BootstrapEntry>();
    for (const entry of bootstrap.providers) desired.set(entry.providerId, entry);

    // Stop providers that should no longer run, or whose config changed
    for (const [providerId, runningEntry] of this.running) {
      const desiredEntry = desired.get(providerId);
      const desiredKey = desiredEntry ? configKeyOf(desiredEntry.config) : null;
      if (!desiredEntry || desiredKey !== runningEntry.configKey) {
        await this.stopProvider(providerId);
      }
    }

    // Start providers that should run
    for (const [providerId, entry] of desired) {
      if (this.running.has(providerId)) continue;
      try {
        await this.startProvider(providerId, entry.config);
      } catch (err) {
        console.error(`[im-runtime] failed to start ${providerId}:`,
          err instanceof Error ? err.message : err);
      }
    }
  }

  private async startProvider(providerId: string, config: Record<string, string>): Promise<void> {
    const adapter = createAdapter(providerId, config);
    if (!adapter) {
      console.warn(`[im-runtime] no adapter implementation in main process for ${providerId}`);
      return;
    }
    await adapter.start();
    const entry: RunningEntry = {
      adapter,
      configKey: configKeyOf(config),
      loopCancelled: false,
    };
    this.running.set(providerId, entry);
    void this.consumeLoop(providerId, entry);
    console.info(`[im-runtime] started ${providerId}`);
  }

  private async stopProvider(providerId: string): Promise<void> {
    const entry = this.running.get(providerId);
    if (!entry) return;
    entry.loopCancelled = true;
    this.running.delete(providerId);
    try { await entry.adapter.stop(); } catch { /* swallow */ }
    console.info(`[im-runtime] stopped ${providerId}`);
  }

  private async consumeLoop(providerId: string, entry: RunningEntry): Promise<void> {
    while (!entry.loopCancelled && entry.adapter.isRunning()) {
      let message: unknown;
      try {
        message = await entry.adapter.consumeOne();
      } catch (err) {
        console.error(`[im-runtime] consumeOne failed for ${providerId}:`,
          err instanceof Error ? err.message : err);
        await delay(2_000);
        continue;
      }
      if (!message) return;
      try {
        await this.forwardInbound(providerId, message);
      } catch (err) {
        console.error(`[im-runtime] ingest failed for ${providerId}:`,
          err instanceof Error ? err.message : err);
      }
    }
  }

  private async forwardInbound(providerId: string, message: unknown): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/im/runtime/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [BRIDGE_RUNTIME_TOKEN_HEADER]: this.options.token,
      },
      body: JSON.stringify({ providerId, message, receivedAt: Date.now() }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`ingest-${response.status}${text ? `:${text}` : ''}`);
    }
  }

  private async fetchBootstrap(): Promise<BootstrapResponse> {
    const response = await fetch(`${this.baseUrl}/api/im/runtime/bootstrap`, {
      headers: { [BRIDGE_RUNTIME_TOKEN_HEADER]: this.options.token },
    });
    if (!response.ok) throw new Error(`bootstrap-${response.status}`);
    return response.json() as Promise<BootstrapResponse>;
  }
}

function configKeyOf(config: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(config)
      .sort()
      .map((k) => [k, config[k]]),
  );
}

function createAdapter(providerId: string, config: Record<string, string>): GenericIMAdapter | null {
  if (providerId === 'feishu') {
    return new FeishuAdapter(parseFeishuConfig(config)) as unknown as GenericIMAdapter;
  }
  if (providerId === 'wechat') {
    return new WechatAdapter(parseWechatConfig(config)) as unknown as GenericIMAdapter;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
