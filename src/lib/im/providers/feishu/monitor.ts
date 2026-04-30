/**
 * Feishu Provider — Inbound Monitor
 *
 * 通过 lark WSClient 监听 im.message.receive_v1 事件，
 * 把消息塞进队列；adapter.consumeOne() 从队列取出。
 * 自带去重（最近 N 条 message_id）。
 */

import * as lark from '@larksuiteoapi/node-sdk';
import type { InboundMessage } from '../../core/types';
import type { FeishuClient } from './client';

const SEEN_LIMIT = 1000;

export class FeishuMonitor {
  private running = false;
  private queue: InboundMessage[] = [];
  private waiters: Array<(msg: InboundMessage | null) => void> = [];
  private seenIds = new Set<string>();

  constructor(private readonly client: FeishuClient) {}

  start(): void {
    if (this.running) return;

    const dispatcher = new lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data) => {
        this.handleEvent(data);
      },
    });

    this.client.startWebSocket(dispatcher);
    this.running = true;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.client.stopWebSocket();
    for (const w of this.waiters) w(null);
    this.waiters = [];
    this.seenIds.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  async consumeOne(): Promise<InboundMessage | null> {
    const queued = this.queue.shift();
    if (queued) return queued;
    if (!this.running) return null;
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  // exported for test
  handleEvent(rawEvent: unknown): void {
    const event = rawEvent as FeishuReceiveEvent;
    const msg = event?.message;
    if (!msg) return;

    // Filter bot self-messages
    if (event?.sender?.sender_type === 'app') return;

    if (this.seenIds.has(msg.message_id)) return;
    this.seenIds.add(msg.message_id);
    if (this.seenIds.size > SEEN_LIMIT) {
      // Trim oldest entries to keep memory bounded
      const oldest = this.seenIds.values().next().value;
      if (oldest) this.seenIds.delete(oldest);
    }

    let text = '';
    if (msg.message_type === 'text') {
      try {
        const parsed = JSON.parse(msg.content) as { text?: string };
        text = (parsed.text || '').trim();
      } catch {
        text = msg.content;
      }
    } else {
      // M2 范围：仅 text 入站。媒体/文件后续扩展。
      return;
    }
    if (!text) return;

    const inbound: InboundMessage = {
      messageId: msg.message_id,
      address: {
        providerId: 'feishu',
        chatId: msg.chat_id,
        userId: event.sender?.sender_id?.open_id || '',
      },
      text,
      timestamp: parseInt(msg.create_time, 10) || Date.now(),
      raw: rawEvent,
    };

    const waiter = this.waiters.shift();
    if (waiter) waiter(inbound);
    else this.queue.push(inbound);
  }
}

interface FeishuReceiveEvent {
  message?: {
    message_id: string;
    chat_id: string;
    message_type: string;
    content: string;
    create_time: string;
  };
  sender?: {
    sender_type?: string;
    sender_id?: { open_id?: string };
  };
}
