/**
 * WeChat Work Provider — Inbound Monitor (M5 stub)
 *
 * 企业微信入站需要在企微管理后台配置接收消息 Webhook URL，并实现
 * AES-CBC 解密 + 签名校验链路（参考 https://developer.work.weixin.qq.com/document/path/90930）。
 *
 * M5 范围只暴露 IMAdapter 接口 + queue/consumeOne 形式，**不真正订阅事件**。
 * 这样做的好处：架构完整，send 路径可用；接收链路作为独立任务后续接入
 * （需要新 API 路由 + WXBizMsgCrypt 解密实现）。
 */

import type { InboundMessage } from '../../core/types';

export class WechatWorkMonitor {
  private running = false;
  private queue: InboundMessage[] = [];
  private waiters: Array<(msg: InboundMessage | null) => void> = [];

  start(): void {
    if (this.running) return;
    this.running = true;
    // 真正的 webhook 监听由独立 API 路由触发；本 monitor 只承载 queue/waiter。
    // 后续在 src/app/api/im/webhooks/wechat-work/route.ts 中调用 ingestEvent 注入消息。
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const w of this.waiters) w(null);
    this.waiters = [];
    this.queue = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  consumeOne(): Promise<InboundMessage | null> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    if (!this.running) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /**
   * 给将来的 webhook 路由调用：注入解密后的 inbound 事件。
   * 现在 M5 没有路由调用，仅作为接口定义占位。
   */
  ingestEvent(message: InboundMessage): void {
    if (!this.running) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.queue.push(message);
  }
}
