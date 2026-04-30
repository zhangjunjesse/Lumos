/**
 * WeChat (QClaw) Provider — Adapter
 *
 * 把 monitor / send / probe / targets 串起来实现 IMAdapter + IMTargetDirectory。
 * 文件结构与 providers/feishu/adapter.ts 完全对位。
 */

import type {
  IMAdapter,
  IMTargetDirectory,
  IMCommandHandler,
  IMCommand,
  IMCommandContext,
  IMCommandResult,
  IMTarget,
  ListTargetsOptions,
  InboundMessage,
  OutboundMessage,
  SendResult,
  ProbeResult,
} from '../../core/types';
import type { QClawConfig } from './config';
import { isQClawConfigValid } from './config';
import { QClawClient } from './client';
import { QClawMonitor } from './monitor';
import { sendOutbound } from './send';
import { probeQClaw } from './probe';
import { listQClawTargets, resolveQClawTarget } from './targets';
import { BUILTIN_COMMANDS, handleBuiltinCommand } from '../../core/built-in-commands';

export class WechatQClawAdapter implements IMAdapter, IMTargetDirectory, IMCommandHandler {
  readonly id = 'wechat-qclaw';

  private readonly client: QClawClient;
  private readonly monitor: QClawMonitor;

  constructor(private readonly config: QClawConfig) {
    this.client = new QClawClient(config);
    this.monitor = new QClawMonitor(this.client, config);
  }

  async start(): Promise<void> {
    if (this.monitor.isRunning()) return;
    const reason = this.validateConfig();
    if (reason) throw new Error(`[wechat-qclaw/adapter] cannot start: ${reason}`);
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
    return probeQClaw(this.client);
  }

  validateConfig(): string | null {
    if (!isQClawConfigValid(this.config)) {
      return 'qclaw_host, bot_id and bot_secret are required';
    }
    return null;
  }

  // ------------- IMTargetDirectory -------------

  listTargets(opts?: ListTargetsOptions): Promise<IMTarget[]> {
    return listQClawTargets(this.client, opts);
  }

  resolveTarget(query: string): Promise<IMTarget | null> {
    return resolveQClawTarget(this.client, query);
  }

  // ------------- IMCommandHandler -------------

  listCommands(): IMCommand[] {
    return [...BUILTIN_COMMANDS];
  }

  async handleCommand(ctx: IMCommandContext): Promise<IMCommandResult> {
    const builtin = await handleBuiltinCommand(ctx, '微信 (QClaw)');
    if (builtin) return builtin;
    return { handled: false };
  }
}
