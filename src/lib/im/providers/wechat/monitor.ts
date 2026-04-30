/**
 * WeChat Provider — Inbound Monitor (long-poll)
 *
 * 持续 getUpdates → 解析消息（仅 text + voice ASR）→ 入队
 * 每条入站消息带 context_token，按 from_user_id 持久化到磁盘。
 * 之后回复时 send.ts 从磁盘读取该 peer 的最近 context_token。
 *
 * 持久化文件：
 *   <LUMOS_DATA_DIR>/im-wechat/<account_id>/sync_buf.txt
 *   <LUMOS_DATA_DIR>/im-wechat/<account_id>/context-tokens.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { InboundMessage } from '../../core/types';
import {
  WechatClient,
  MESSAGE_ITEM_TEXT,
  MESSAGE_ITEM_VOICE,
  MESSAGE_TYPE_USER,
  type WeixinInboundMsg,
  type MessageItem,
} from './client';
import type { WechatConfig } from './config';
import { isPeerAllowed } from './config';

const SEEN_LIMIT = 1000;

function dataDir(): string {
  return process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function stateDir(accountId: string): string {
  return path.join(dataDir(), 'im-wechat', sanitize(accountId));
}

function sanitize(s: string): string {
  return s.replace(/[/\\:\0]/g, '_') || 'default';
}

function syncBufPath(accountId: string): string {
  return path.join(stateDir(accountId), 'sync_buf.txt');
}

function tokensPath(accountId: string): string {
  return path.join(stateDir(accountId), 'context-tokens.json');
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

// ---- context_token store (per-account, on-disk) ----------------------------

class ContextTokenStore {
  private cache = new Map<string, string>();
  private loaded = false;

  constructor(private readonly accountId: string) {}

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = fs.readFileSync(tokensPath(this.accountId), 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') this.cache.set(k, v);
      }
    } catch {
      // first run, no file yet
    }
  }

  get(peer: string): string {
    this.load();
    return this.cache.get(peer) || '';
  }

  set(peer: string, token: string): void {
    this.load();
    if (!token.trim()) return;
    if (this.cache.get(peer) === token) return;
    this.cache.set(peer, token);
    try {
      ensureDir(stateDir(this.accountId));
      fs.writeFileSync(
        tokensPath(this.accountId),
        JSON.stringify(Object.fromEntries(this.cache), null, 2),
        'utf-8',
      );
    } catch (err) {
      console.warn('[wechat/monitor] failed to persist context token:', err);
    }
  }
}

// ---- sync_buf store (cursor for long-poll) ---------------------------------

function readSyncBuf(accountId: string): string {
  try {
    return fs.readFileSync(syncBufPath(accountId), 'utf-8');
  } catch {
    return '';
  }
}

function writeSyncBuf(accountId: string, buf: string): void {
  try {
    ensureDir(stateDir(accountId));
    fs.writeFileSync(syncBufPath(accountId), buf, 'utf-8');
  } catch (err) {
    console.warn('[wechat/monitor] failed to persist sync_buf:', err);
  }
}

// ---- Parse user-visible text from item_list (text + voice ASR + 引用) ------

export function bodyFromItemList(items: MessageItem[] | undefined): string {
  if (!items || items.length === 0) return '';
  for (const item of items) {
    if (item.type === MESSAGE_ITEM_TEXT && item.text_item) {
      const text = (item.text_item.text || '').trim();
      const ref = item.ref_msg;
      if (!ref || !ref.message_item) return text;
      const refType = ref.message_item.type;
      if (refType && [2, 3, 4, 5].includes(refType)) {
        // ref is media — drop ref body, just return current text
        return text;
      }
      const refBody = bodyFromItemList([ref.message_item]);
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (refBody) parts.push(refBody);
      if (parts.length === 0) return text;
      return `[引用: ${parts.join(' | ')}]\n${text}`;
    }
    if (item.type === MESSAGE_ITEM_VOICE && item.voice_item) {
      const t = (item.voice_item.text || '').trim();
      if (t) return t;
    }
  }
  return '';
}

// ---- Monitor ---------------------------------------------------------------

export interface WechatMonitorDeps {
  contextTokenStore?: ContextTokenStore;
  /** Inject a custom sync_buf reader/writer (for tests). */
  syncBuf?: { read(): string; write(buf: string): void };
}

export class WechatMonitor {
  private running = false;
  private cancelled = false;
  private queue: InboundMessage[] = [];
  private waiters: Array<(msg: InboundMessage | null) => void> = [];
  private seenIds = new Set<string>();
  private loopPromise: Promise<void> | null = null;
  private readonly tokens: ContextTokenStore;
  private readonly bufStore: { read(): string; write(buf: string): void };

  constructor(
    private readonly client: WechatClient,
    private readonly config: WechatConfig,
    deps: WechatMonitorDeps = {},
  ) {
    this.tokens = deps.contextTokenStore ?? new ContextTokenStore(config.accountId);
    this.bufStore = deps.syncBuf ?? {
      read: () => readSyncBuf(config.accountId),
      write: (buf) => writeSyncBuf(config.accountId, buf),
    };
  }

  private wakeStop: (() => void) | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.cancelled = true;
    // Wake the loop's sleep if any
    if (this.wakeStop) {
      this.wakeStop();
      this.wakeStop = null;
    }
    for (const w of this.waiters) w(null);
    this.waiters = [];
    if (this.loopPromise) await this.loopPromise.catch(() => undefined);
    this.loopPromise = null;
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

  /** Lookup the latest known context_token for a peer (used by send.ts). */
  getContextToken(peerUserId: string): string {
    return this.tokens.get(peerUserId);
  }

  // -- internal ------------------------------------------------------------

  private async loop(): Promise<void> {
    let buf = this.bufStore.read();
    while (!this.cancelled) {
      const iterStart = Date.now();
      let resp;
      try {
        resp = await this.client.getUpdates(buf);
      } catch (err) {
        console.warn('[wechat/monitor] getUpdates failed, retrying in 3s:', err);
        await this.cancellableDelay(3000);
        continue;
      }
      if (this.cancelled) return;
      if (resp.ret !== 0) {
        console.warn('[wechat/monitor] getUpdates ret', resp.ret, resp.errmsg);
        await this.cancellableDelay(3000);
        continue;
      }
      if (resp.get_updates_buf && resp.get_updates_buf !== buf) {
        buf = resp.get_updates_buf;
        this.bufStore.write(buf);
      }
      for (const m of resp.msgs ?? []) this.ingestMessage(m);
      // Safety throttle: ensure at least 100ms between iterations.
      // Real long-poll returns in seconds; this only kicks in if the server
      // returns immediately and would otherwise hot-loop.
      const elapsed = Date.now() - iterStart;
      if (elapsed < 100) await this.cancellableDelay(100 - elapsed);
    }
  }

  private cancellableDelay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeStop = null;
        resolve();
      }, ms);
      this.wakeStop = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  /** Exposed for tests. */
  ingestMessage(m: WeixinInboundMsg): void {
    // Only inbound user → bot direction
    if (m.message_type !== MESSAGE_TYPE_USER) return;

    const from = (m.from_user_id || '').trim();
    if (!from) return;
    if (!isPeerAllowed(this.config, from)) return;

    // Persist context_token first — even if we end up dropping the message,
    // the token is still useful for any later send.
    if (m.context_token && m.context_token.trim()) {
      this.tokens.set(from, m.context_token.trim());
    }

    const messageId = String(m.message_id ?? `${from}:${m.create_time_ms ?? Date.now()}`);
    if (this.seenIds.has(messageId)) return;
    this.seenIds.add(messageId);
    if (this.seenIds.size > SEEN_LIMIT) {
      const oldest = this.seenIds.values().next().value;
      if (oldest) this.seenIds.delete(oldest);
    }

    const text = bodyFromItemList(m.item_list);
    if (!text) return; // M+1: handle media inbound

    const inbound: InboundMessage = {
      messageId,
      address: { providerId: 'wechat', chatId: from, userId: from },
      text,
      timestamp: m.create_time_ms || Date.now(),
      raw: m,
    };

    const waiter = this.waiters.shift();
    if (waiter) waiter(inbound);
    else this.queue.push(inbound);
  }
}

