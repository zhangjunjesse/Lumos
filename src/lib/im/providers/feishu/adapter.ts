/**
 * Feishu Provider — Adapter
 *
 * 把 monitor / send / probe / targets 串起来实现 IMAdapter + IMTargetDirectory。
 * IMAdapter 是核心契约；IMTargetDirectory 是 P1 mixin（manifest.capabilities 已声明 true）。
 *
 * 关于"行为不变"：本 adapter 取代 src/lib/bridge/adapters/feishu-adapter.ts 的逻辑，
 * 但旧文件仍作为 thin wrapper 保留以兼容 bridge BaseChannelAdapter 接口。
 */

import type {
  IMAdapter,
  IMTargetDirectory,
  IMTarget,
  ListTargetsOptions,
  InboundMessage,
  OutboundMessage,
  SendResult,
  ProbeResult,
} from '../../core/types';
import type { FeishuConfig } from './config';
import { isFeishuConfigValid } from './config';
import { FeishuClient } from './client';
import { FeishuMonitor } from './monitor';
import { sendOutbound } from './send';
import { probeFeishu } from './probe';
import { listFeishuTargets, resolveFeishuTarget } from './targets';

export class FeishuAdapter implements IMAdapter, IMTargetDirectory {
  readonly id = 'feishu';

  private readonly client: FeishuClient;
  private readonly monitor: FeishuMonitor;

  constructor(private readonly config: FeishuConfig) {
    this.client = new FeishuClient(config);
    this.monitor = new FeishuMonitor(this.client);
  }

  async start(): Promise<void> {
    if (this.monitor.isRunning()) return;
    const reason = this.validateConfig();
    if (reason) throw new Error(`[feishu/adapter] cannot start: ${reason}`);
    this.monitor.start();
  }

  async stop(): Promise<void> {
    this.monitor.stop();
    this.client.reset();
  }

  isRunning(): boolean {
    return this.monitor.isRunning();
  }

  consumeOne(): Promise<InboundMessage | null> {
    return this.monitor.consumeOne();
  }

  send(message: OutboundMessage): Promise<SendResult> {
    return sendOutbound(this.client, message);
  }

  probe(): Promise<ProbeResult> {
    return probeFeishu(this.client);
  }

  validateConfig(): string | null {
    if (!isFeishuConfigValid(this.config)) return 'app_id and app_secret are required';
    return null;
  }

  // ------------- IMTargetDirectory -------------

  listTargets(opts?: ListTargetsOptions): Promise<IMTarget[]> {
    return listFeishuTargets(this.client, this.config, opts);
  }

  resolveTarget(query: string): Promise<IMTarget | null> {
    return resolveFeishuTarget(this.client, this.config, query);
  }
}
