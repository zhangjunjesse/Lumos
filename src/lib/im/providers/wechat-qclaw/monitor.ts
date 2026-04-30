/**
 * WeChat (QClaw) Provider — Inbound Monitor
 *
 * 通过 WebSocket 长连接订阅 QClaw 事件流；transport='longpoll' 时退化为 HTTP 轮询。
 * 收到的 JSON 转成 InboundMessage 入队，adapter.consumeOne() 取走。
 */

import WebSocket from 'ws';
import type { InboundMessage } from '../../core/types';
import type { QClawClient, QClawIncomingEvent } from './client';
import type { QClawConfig } from './config';

const SEEN_LIMIT = 1000;
const RECONNECT_DELAY_MS = 3_000;
const LONGPOLL_INTERVAL_MS = 2_000;

export class QClawMonitor {
  private running = false;
  private queue: InboundMessage[] = [];
  private waiters: Array<(msg: InboundMessage | null) => void> = [];
  private seenIds = new Set<string>();
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private longpollTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly client: QClawClient,
    private readonly config: QClawConfig,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.config.transport === 'websocket') this.connectWs();
    else this.startLongpoll();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.longpollTimer) {
      clearTimeout(this.longpollTimer);
      this.longpollTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
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

  /** Exposed for tests — converts a raw event JSON into queued InboundMessage. */
  ingestEvent(event: QClawIncomingEvent | unknown): void {
    const ev = event as QClawIncomingEvent;
    if (!ev || ev.type !== 'message') return;
    const id = ev.messageId || `${ev.chatId || ''}:${ev.timestamp || ''}`;
    if (!id || this.seenIds.has(id)) return;
    this.seenIds.add(id);
    if (this.seenIds.size > SEEN_LIMIT) {
      const oldest = this.seenIds.values().next().value;
      if (oldest) this.seenIds.delete(oldest);
    }
    if (!ev.text || !ev.text.trim()) return;
    if (!ev.chatId) return;

    const inbound: InboundMessage = {
      messageId: id,
      address: {
        providerId: 'wechat-qclaw',
        chatId: ev.chatId,
        userId: ev.userId,
      },
      text: ev.text.trim(),
      timestamp: ev.timestamp || Date.now(),
      raw: ev.raw ?? ev,
    };

    const waiter = this.waiters.shift();
    if (waiter) waiter(inbound);
    else this.queue.push(inbound);
  }

  // -------- WebSocket --------

  private connectWs(): void {
    if (!this.running) return;
    try {
      this.ws = new WebSocket(this.client.buildEventsWsUrl(), {
        headers: { Authorization: `Bearer ${this.config.botSecret}` },
      });
    } catch (err) {
      this.scheduleReconnect(err);
      return;
    }

    this.ws.on('message', (raw) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        const parsed = JSON.parse(text) as QClawIncomingEvent;
        this.ingestEvent(parsed);
      } catch {
        // ignore non-JSON frames
      }
    });

    this.ws.on('close', () => this.scheduleReconnect('close'));
    this.ws.on('error', (err) => this.scheduleReconnect(err));
  }

  private scheduleReconnect(reason: unknown): void {
    if (!this.running) return;
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) this.connectWs();
    }, RECONNECT_DELAY_MS);
    void reason;
  }

  // -------- Long polling --------

  private startLongpoll(): void {
    const tick = async () => {
      if (!this.running) return;
      try {
        const url = `${this.config.qclawHost}${this.config.eventsPath}?bot_id=${encodeURIComponent(this.config.botId)}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.config.botSecret}` },
        });
        if (res.ok) {
          const data = (await res.json().catch(() => null)) as { events?: QClawIncomingEvent[] } | null;
          for (const ev of data?.events ?? []) this.ingestEvent(ev);
        }
      } catch {
        // ignore single-tick failures, retry on next interval
      }
      if (this.running) {
        this.longpollTimer = setTimeout(tick, LONGPOLL_INTERVAL_MS);
      }
    };
    void tick();
  }
}
