/**
 * WeChat Provider — Adapter
 *
 * 把 client / monitor / send / probe 串成 IMAdapter，外加 IMCommandHandler。
 * 不实现 IMTargetDirectory（ilink 协议没有联系人列表 API）也不实现
 * IMStreamingPreview（微信不支持编辑消息）。
 */

import type {
  IMAdapter,
  IMCommandHandler,
  IMCommand,
  IMCommandContext,
  IMCommandResult,
  InboundMessage,
  OutboundMessage,
  SendResult,
  ProbeResult,
} from '../../core/types';
import type { WechatConfig } from './config';
import { isWechatConfigValid } from './config';
import { WechatClient } from './client';
import { WechatMonitor } from './monitor';
import { sendOutbound } from './send';
import { probeWechat } from './probe';
import { WECHAT_COMMANDS, handleWechatCommand } from './commands';

export class WechatAdapter implements IMAdapter, IMCommandHandler {
  readonly id = 'wechat';

  private readonly client: WechatClient;
  private readonly monitor: WechatMonitor;

  constructor(private readonly config: WechatConfig) {
    this.client = new WechatClient({
      baseUrl: config.baseUrl,
      token: config.token,
    });
    this.monitor = new WechatMonitor(this.client, config);
  }

  async start(): Promise<void> {
    if (this.monitor.isRunning()) return;
    const reason = this.validateConfig();
    if (reason) throw new Error(`[wechat/adapter] cannot start: ${reason}`);
    this.monitor.start();
  }

  async stop(): Promise<void> {
    await this.monitor.stop();
  }

  isRunning(): boolean {
    return this.monitor.isRunning();
  }

  consumeOne(): Promise<InboundMessage | null> {
    return this.monitor.consumeOne();
  }

  send(message: OutboundMessage): Promise<SendResult> {
    return sendOutbound(this.client, message, {
      getContextToken: (peer) => this.monitor.getContextToken(peer),
    });
  }

  probe(): Promise<ProbeResult> {
    return probeWechat(this.client);
  }

  validateConfig(): string | null {
    if (!isWechatConfigValid(this.config)) {
      return 'token is required (scan QR in settings to obtain it)';
    }
    return null;
  }

  // ------------- IMCommandHandler -------------

  listCommands(): IMCommand[] {
    return [...WECHAT_COMMANDS];
  }

  handleCommand(ctx: IMCommandContext): Promise<IMCommandResult> {
    return handleWechatCommand(ctx);
  }
}
