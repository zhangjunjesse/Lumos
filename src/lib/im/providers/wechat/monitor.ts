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
import { bodyFromItemList, extractInboundFiles, extractInboundImages, extractInboundVoices } from './parse';
import { mimeFromFileName } from './mime';
import { ContextTokenStore, readSyncBuf, writeSyncBuf } from './state';
import { detectAudioFormat, transcribeAudioAttachment } from '../../core/speech';

// File-backed debug log so we can diagnose without watching electron stdout.
const DEBUG_LOG_PATH = path.join(
  process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos'),
  'wechat-debug.log',
);
const VERBOSE_MONITOR_LOG = process.env.LUMOS_WECHAT_MONITOR_DEBUG === '1';
const CONSOLE_MONITOR_LOG = process.env.LUMOS_WECHAT_MONITOR_CONSOLE === '1';
const DEFAULT_DEBUG_LOG_MAX_BYTES = 5 * 1024 * 1024;
const DEBUG_LOG_MAX_BYTES = parsePositiveInt(
  process.env.LUMOS_WECHAT_MONITOR_LOG_MAX_BYTES,
  DEFAULT_DEBUG_LOG_MAX_BYTES,
);

function logMonitor(line: string, options: { verbose?: boolean } = {}): void {
  if (options.verbose && !VERBOSE_MONITOR_LOG) return;
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  appendMonitorLog(stamped);
  if (CONSOLE_MONITOR_LOG) console.info(line);
}

function appendMonitorLog(stamped: string): void {
  try {
    rotateMonitorLogIfNeeded();
    fs.appendFileSync(DEBUG_LOG_PATH, stamped);
  } catch {
    // ignore disk write errors
  }
}

function rotateMonitorLogIfNeeded(): void {
  const stat = fs.existsSync(DEBUG_LOG_PATH) ? fs.statSync(DEBUG_LOG_PATH) : null;
  if (!stat || stat.size <= DEBUG_LOG_MAX_BYTES) return;
  const rotatedPath = `${DEBUG_LOG_PATH}.1`;
  try {
    if (fs.existsSync(rotatedPath)) fs.unlinkSync(rotatedPath);
    fs.renameSync(DEBUG_LOG_PATH, rotatedPath);
  } catch {
    fs.truncateSync(DEBUG_LOG_PATH, 0);
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const SEEN_LIMIT = 1000;
const MIN_LOOP_INTERVAL_MS = 100;
const FAST_EMPTY_RESPONSE_MS = 1000;
const EMPTY_POLL_BACKOFF_MS = 2000;
const EMPTY_POLL_SUMMARY_EVERY = 60;

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
    let consecutiveFastEmptyPolls = 0;
    logMonitor(`[wechat/monitor] loop start account=${this.config.accountId} buf.len=${buf.length} baseUrl=${this.config.baseUrl}`);
    while (!this.cancelled) {
      iter += 1;
      const iterStart = Date.now();
      logMonitor(`[wechat/monitor] iter#${iter} → POST getupdates buf.len=${buf.length}`, { verbose: true });
      let resp;
      try {
        resp = await this.client.getUpdates(buf);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        consecutiveFastEmptyPolls = 0;
        logMonitor(`[wechat/monitor] iter#${iter} fetch FAILED: ${msg}`);
        await this.cancellableDelay(3000);
        continue;
      }
      if (this.cancelled) return;
      const elapsed = Date.now() - iterStart;
      const messageCount = (resp.msgs ?? []).length;
      logMonitor(`[wechat/monitor] iter#${iter} ← ret=${resp.ret} msgs=${messageCount} elapsed=${elapsed}ms`, { verbose: true });
      // ilink 成功响应不带 ret 字段（仅错误时返回），cc-connect Go 端因零值默认 0 而无碍。
      // TS 里 undefined !== 0 会误判为错误，扔掉消息。这里把 undefined / null 视为成功。
      if (resp.ret != null && resp.ret !== 0) {
        consecutiveFastEmptyPolls = 0;
        logMonitor(`[wechat/monitor] iter#${iter} ret=${resp.ret} errmsg=${resp.errmsg}`);
        await this.cancellableDelay(3000);
        continue;
      }
      if (resp.get_updates_buf && resp.get_updates_buf !== buf) {
        buf = resp.get_updates_buf;
        this.bufStore.write(buf);
      }
      for (const m of resp.msgs ?? []) {
        logMonitor(
          `[wechat/monitor] inbound from=${m.from_user_id} type=${m.message_type} msgId=${m.message_id}`,
        );
        // ingestMessage is async because images need to be downloaded from the CDN
        // before we can build the InboundMessage. Don't block the next getUpdates
        // iteration — fire-and-forget. Errors are written to the monitor log.
        void this.ingestMessage(m).catch((err) => {
          logMonitor(`[wechat/monitor] ingest error msgId=${m.message_id}: ${err instanceof Error ? err.message : err}`);
        });
      }

      if (messageCount === 0 && elapsed < FAST_EMPTY_RESPONSE_MS) {
        consecutiveFastEmptyPolls += 1;
        if (consecutiveFastEmptyPolls === 1 || consecutiveFastEmptyPolls % EMPTY_POLL_SUMMARY_EVERY === 0) {
          logMonitor(
            `[wechat/monitor] idle: empty getupdates returned quickly (${elapsed}ms); backing off to ${EMPTY_POLL_BACKOFF_MS}ms`
            + ` (count=${consecutiveFastEmptyPolls})`,
          );
        }
        await this.cancellableDelay(Math.max(MIN_LOOP_INTERVAL_MS, EMPTY_POLL_BACKOFF_MS - elapsed));
      } else {
        consecutiveFastEmptyPolls = 0;
        // Safety throttle: long-poll is normally seconds; this only kicks in
        // if the server returns immediately and would otherwise hot-loop.
        if (elapsed < MIN_LOOP_INTERVAL_MS) {
          await this.cancellableDelay(MIN_LOOP_INTERVAL_MS - elapsed);
        }
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

    let text = bodyFromItemList(m.item_list);
    const imageAttachments = await this.downloadInboundImages(messageId, m.item_list);
    const fileAttachments = await this.downloadInboundFiles(messageId, m.item_list);
    const voiceAttachments = text ? [] : await this.downloadInboundVoices(messageId, m.item_list);

    if (!text && voiceAttachments.length > 0) {
      const transcript = await transcribeAudioAttachment(voiceAttachments[0]);
      if (transcript) {
        text = transcript;
        logMonitor(`[wechat/monitor] voice transcribed msgId=${messageId} chars=${transcript.length}`, { verbose: true });
      }
    }

    const attachments = [
      ...imageAttachments,
      ...fileAttachments,
      ...(!text ? voiceAttachments : []),
    ];

    if (!text && attachments.length === 0) {
      // Pure non-image / non-file media (video / voice without ASR) — TODO.
      logMonitor(`[wechat/monitor] skip msgId=${messageId} (no text, no usable attachments)`, { verbose: true });
      return;
    }

    let placeholder = '';
    if (!text) {
      const labels: string[] = [];
      if (imageAttachments.length > 0) labels.push(`[图片×${imageAttachments.length}]`);
      if (fileAttachments.length > 0) {
        labels.push(...fileAttachments.map((a) => `[文件: ${a.name}]`));
      }
      if (voiceAttachments.length > 0) {
        labels.push(...voiceAttachments.map((a) => `[语音: ${a.name}，未收到微信转写文本]`));
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
      logMonitor(`[wechat/monitor] dispatch → waiter msgId=${messageId} text="${(inbound.text || '').slice(0, 40)}" attachments=${attachments.length}`);
      waiter(inbound);
    } else {
      this.queue.push(inbound);
      logMonitor(`[wechat/monitor] dispatch → queue msgId=${messageId} queue.size=${this.queue.length} attachments=${attachments.length}`);
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
        logMonitor(`[wechat/monitor] image downloaded msgId=${messageId} idx=${i} mime=${mime} size=${bytes.length}`);
      } catch (err) {
        logMonitor(`[wechat/monitor] image download FAILED msgId=${messageId} idx=${i}: ${err instanceof Error ? err.message : err}`);
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
        logMonitor(`[wechat/monitor] file downloaded msgId=${messageId} idx=${i} name="${task.fileName}" size=${bytes.length}`);
      } catch (err) {
        logMonitor(`[wechat/monitor] file download FAILED msgId=${messageId} idx=${i} name="${task.fileName}": ${err instanceof Error ? err.message : err}`);
      }
    }
    return out;
  }

  private async downloadInboundVoices(
    messageId: string,
    items: WeixinInboundMsg['item_list'],
  ): Promise<IMFileAttachment[]> {
    const tasks = extractInboundVoices(items);
    if (tasks.length === 0) return [];
    const out: IMFileAttachment[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      try {
        const bytes = await this.client.downloadCdnMedia({
          encryptedQueryParam: task.encryptedQueryParam,
          aesKey: task.aesKey,
        });
        const format = detectAudioFormat(bytes);
        out.push({
          id: `wechat-voice-${messageId}-${i}`,
          name: `wechat-voice-${messageId}-${i}.${format.ext}`,
          type: format.mime,
          size: bytes.length,
          data: bytes.toString('base64'),
        });
        logMonitor(`[wechat/monitor] voice downloaded msgId=${messageId} idx=${i} mime=${format.mime} size=${bytes.length}`, { verbose: true });
      } catch (err) {
        logMonitor(`[wechat/monitor] voice download FAILED msgId=${messageId} idx=${i}: ${err instanceof Error ? err.message : err}`);
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
