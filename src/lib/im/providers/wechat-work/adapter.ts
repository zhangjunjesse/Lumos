/**
 * WeChat Work Provider — Adapter
 *
 * M5 仅实现 IMAdapter（出站 + probe 真可用，inbound 走 monitor stub）。
 * 接通 IMTargetDirectory 与 webhook 入站留作后续任务。
 */

import type {
  IMAdapter,
  InboundMessage,
  OutboundMessage,
  SendResult,
  ProbeResult,
} from '../../core/types';
import type { WechatWorkConfig } from './config';
import { isWechatWorkConfigValid } from './config';
import { WechatWorkClient } from './client';
import { WechatWorkMonitor } from './monitor';
import { sendOutbound } from './send';
import { probeWechatWork } from './probe';

export class WechatWorkAdapter implements IMAdapter {
  readonly id = 'wechat-work';

  private readonly client: WechatWorkClient;
  private readonly monitor: WechatWorkMonitor;

  constructor(private readonly config: WechatWorkConfig) {
    this.client = new WechatWorkClient(config);
    this.monitor = new WechatWorkMonitor();
  }

  async start(): Promise<void> {
    if (this.monitor.isRunning()) return;
    const reason = this.validateConfig();
    if (reason) throw new Error(`[wechat-work/adapter] cannot start: ${reason}`);
    this.monitor.start();
  }

  async stop(): Promise<void> {
    this.monitor.stop();
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
    return probeWechatWork(this.client);
  }

  validateConfig(): string | null {
    if (!isWechatWorkConfigValid(this.config)) {
      return 'corp_id, agent_id, corp_secret are required';
    }
    return null;
  }
}
