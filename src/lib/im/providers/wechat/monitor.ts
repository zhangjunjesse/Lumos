/**
 * WeChat Provider — Inbound Monitor (long-poll loop)
 *
 * 持续 getUpdates → 解析消息（仅 text + voice ASR）→ 入队
 * 每条入站消息带 context_token，按 from_user_id 持久化到磁盘（state.ts）。
 * 之后 send.ts 通过 monitor.getContextToken(peer) 拿到。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { IMFileAttachment, InboundMessage } from '../../core/types';
import { WechatClient, MESSAGE_TYPE_USER, type WeixinInboundMsg } from './client';
import type { WechatConfig } from './config';
import { isPeerAllowed } from './config';
import { detectImageMime } from './cdn';
import { bodyFromItemList, extractInboundFiles, extractInboundImages } from './parse';
import { mimeFromFileName } from './mime';
import { ContextTokenStore, readSyncBuf, writeSyncBuf } from './state';

// File-backed debug log so we can diagnose without watching electron stdout.
const DEBUG_LOG_PATH = path.join(
  process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos'),
  'wechat-debug.log',
);

function dbg(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  console.info(line);
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, stamped);
  } catch {
    // ignore disk write errors
  }
}

const SEEN_LIMIT = 1000;
const MIN_LOOP_INTERVAL_MS = 100;

export interface WechatMonitorDeps {
  contextTokenStore?: ContextTokenStore;
  syncBuf?: { read(): string; write(buf: string): void };
}

export class WechatMonitor {
  private running = false;
  private cancelled = false;
  private queue: InboundMessage[] = [];
  private waiters: Array<(msg: InboundMessage | null) => void> = [];
  private seenIds = new Set<string>();
  private loopPromise: Promise<void> | null = null;
  private wakeStop: (() => void) | null = null;
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
    let iter = 0;
    dbg(`[wechat/monitor] loop start account=${this.config.accountId} buf.len=${buf.length} baseUrl=${this.config.baseUrl}`);
    while (!this.cancelled) {
      iter += 1;
      const iterStart = Date.now();
      dbg(`[wechat/monitor] iter#${iter} → POST getupdates buf.len=${buf.length}`);
      let resp;
      try {
        resp = await this.client.getUpdates(buf);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dbg(`[wechat/monitor] iter#${iter} fetch FAILED: ${msg}`);
        await this.cancellableDelay(3000);
        continue;
      }
      if (this.cancelled) return;
      dbg(`[wechat/monitor] iter#${iter} ← ret=${resp.ret} msgs=${(resp.msgs ?? []).length} elapsed=${Date.now() - iterStart}ms`);
      // ilink 成功响应不带 ret 字段（仅错误时返回），cc-connect Go 端因零值默认 0 而无碍。
      // TS 里 undefined !== 0 会误判为错误，扔掉消息。这里把 undefined / null 视为成功。
      if (resp.ret != null && resp.ret !== 0) {
        dbg(`[wechat/monitor] iter#${iter} ret=${resp.ret} errmsg=${resp.errmsg}`);
        await this.cancellableDelay(3000);
        continue;
      }
      if (resp.get_updates_buf && resp.get_updates_buf !== buf) {
        buf = resp.get_updates_buf;
        this.bufStore.write(buf);
      }
      for (const m of resp.msgs ?? []) {
        dbg(
          `[wechat/monitor] inbound from=${m.from_user_id} type=${m.message_type} msgId=${m.message_id}`,
        );
        // ingestMessage is async because images need to be downloaded from the CDN
        // before we can build the InboundMessage. Don't block the next getUpdates
        // iteration — fire-and-forget. Errors swallow into dbg().
        void this.ingestMessage(m).catch((err) => {
          dbg(`[wechat/monitor] ingest error msgId=${m.message_id}: ${err instanceof Error ? err.message : err}`);
        });
      }

      // Safety throttle: long-poll is normally seconds; this only kicks in
      // if the server returns immediately and would otherwise hot-loop.
      const elapsed = Date.now() - iterStart;
      if (elapsed < MIN_LOOP_INTERVAL_MS) {
        await this.cancellableDelay(MIN_LOOP_INTERVAL_MS - elapsed);
      }
    }
  }

  /** Exposed for tests. */
  async ingestMessage(m: WeixinInboundMsg): Promise<void> {
    if (m.message_type !== MESSAGE_TYPE_USER) return;

    const from = (m.from_user_id || '').trim();
    if (!from) return;
    if (!isPeerAllowed(this.config, from)) return;

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
    const imageAttachments = await this.downloadInboundImages(messageId, m.item_list);
    const fileAttachments = await this.downloadInboundFiles(messageId, m.item_list);
    const attachments = [...imageAttachments, ...fileAttachments];

    if (!text && attachments.length === 0) {
      // Pure non-image / non-file media (video / voice without ASR) — TODO.
      dbg(`[wechat/monitor] skip msgId=${messageId} (no text, no usable attachments)`);
      return;
    }

    let placeholder = '';
    if (!text) {
      const labels: string[] = [];
      if (imageAttachments.length > 0) labels.push(`[图片×${imageAttachments.length}]`);
      if (fileAttachments.length > 0) {
        labels.push(...fileAttachments.map((a) => `[文件: ${a.name}]`));
      }
      placeholder = labels.join(' ');
    }

    const inbound: InboundMessage = {
      messageId,
      address: { providerId: 'wechat', chatId: from, userId: from },
      text: text || placeholder,
      timestamp: m.create_time_ms || Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: m,
    };

    const waiter = this.waiters.shift();
    if (waiter) {
      dbg(`[wechat/monitor] dispatch → waiter msgId=${messageId} text="${(inbound.text || '').slice(0, 40)}" attachments=${attachments.length}`);
      waiter(inbound);
    } else {
      this.queue.push(inbound);
      dbg(`[wechat/monitor] dispatch → queue msgId=${messageId} queue.size=${this.queue.length} attachments=${attachments.length}`);
    }
  }

  private async downloadInboundImages(
    messageId: string,
    items: WeixinInboundMsg['item_list'],
  ): Promise<IMFileAttachment[]> {
    const tasks = extractInboundImages(items);
    if (tasks.length === 0) return [];
    const out: IMFileAttachment[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      try {
        const bytes = await this.client.downloadCdnMedia({
          encryptedQueryParam: task.encryptedQueryParam,
          aesKey: task.aesKey,
        });
        const mime = detectImageMime(bytes);
        const ext = mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : 'jpg';
        out.push({
          id: `wechat-image-${messageId}-${i}`,
          name: `wechat-image-${messageId}-${i}.${ext}`,
          type: mime,
          size: bytes.length,
          data: bytes.toString('base64'),
        });
        dbg(`[wechat/monitor] image downloaded msgId=${messageId} idx=${i} mime=${mime} size=${bytes.length}`);
      } catch (err) {
        dbg(`[wechat/monitor] image download FAILED msgId=${messageId} idx=${i}: ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  }

  private async downloadInboundFiles(
    messageId: string,
    items: WeixinInboundMsg['item_list'],
  ): Promise<IMFileAttachment[]> {
    const tasks = extractInboundFiles(items, `wechat-file-${messageId}`);
    if (tasks.length === 0) return [];
    const out: IMFileAttachment[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      try {
        const bytes = await this.client.downloadCdnMedia({
          encryptedQueryParam: task.encryptedQueryParam,
          aesKey: task.aesKey,
        });
        out.push({
          id: `wechat-file-${messageId}-${i}`,
          name: task.fileName,
          type: mimeFromFileName(task.fileName),
          size: bytes.length,
          data: bytes.toString('base64'),
        });
        dbg(`[wechat/monitor] file downloaded msgId=${messageId} idx=${i} name="${task.fileName}" size=${bytes.length}`);
      } catch (err) {
        dbg(`[wechat/monitor] file download FAILED msgId=${messageId} idx=${i} name="${task.fileName}": ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
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
}
