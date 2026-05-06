/**
 * WeChat Provider — ilink HTTP Client
 *
 * 协议参考 cc-connect/platform/weixin/client.go (MIT)。
 * 4 个核心 endpoint：
 *   POST /ilink/bot/getupdates    — 长轮询拉消息
 *   POST /ilink/bot/sendmessage   — 发消息
 *
 * 鉴权 header: Authorization: Bearer <token>; iLink-App-ClientVersion: 1.
 * 可选 SKRouteTag header（routeTag 由配置传，默认空）。
 *
 * 类型定义在 types.ts，本文件只放运行时逻辑。
 */

import {
  MESSAGE_ITEM_FILE,
  MESSAGE_ITEM_IMAGE,
  MESSAGE_ITEM_TEXT,
  MESSAGE_ITEM_VOICE,
  MESSAGE_TYPE_BOT,
  MESSAGE_STATE_FINISH,
  UPLOAD_MEDIA_FILE,
  UPLOAD_MEDIA_IMAGE,
  UPLOAD_MEDIA_VOICE,
  type GetUpdatesResp,
  type GetUploadUrlReq,
  type GetUploadUrlResp,
  type OutboundMsg,
  type SendMessageResp,
} from './types';
import {
  DEFAULT_CDN_BASE_URL,
  aesEcbPaddedSize,
  buildCdnUploadUrl,
  downloadAndDecryptCdnMedia,
  formatAesKeyForApi,
  md5Hex,
  randomAesKey,
  randomHex,
  uploadEncryptedToCdn,
} from './cdn';

// Re-export 常量与类型，方便 monitor / send / parse 用同一个 ./client 入口
export * from './types';

const CHANNEL_VERSION = 'lumos-wechat/1.0';
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BODY = 64 * 1024 * 1024; // 64MB cap

export interface ClientOptions {
  baseUrl: string;
  token: string;
  routeTag?: string;
  cdnBaseUrl?: string;
}

export class WechatClient {
  constructor(private readonly options: ClientOptions) {}

  private url(path: string): string {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const p = path.replace(/^\/+/, '');
    return `${base}/${p}`;
  }

  private cdnBase(): string {
    return this.options.cdnBaseUrl?.trim() || DEFAULT_CDN_BASE_URL;
  }

  private headers(): Record<string, string> {
    // cc-connect/platform/weixin/client.go (MIT) 严格要求这套 header 组合：
    //   AuthorizationType: ilink_bot_token   ← 缺了服务端会返回带 errmsg 但无 ret 的怪响应（"session timeout"）
    //   X-WECHAT-UIN: <random base64>        ← 同样关键
    //   Authorization: Bearer <token>
    // iLink-App-ClientVersion 只在 setup.ts 的 QR 流里要，bot 业务 API 不需要。
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': randomWechatUIN(),
      Authorization: `Bearer ${this.options.token}`,
    };
    if (this.options.routeTag) h.SKRouteTag = this.options.routeTag;
    return h;
  }

  private async post(
    path: string,
    body: unknown,
    timeoutMs: number,
    label: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.url(path), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (text.length > MAX_RESPONSE_BODY) {
        throw new Error(`weixin: ${label}: response exceeds ${MAX_RESPONSE_BODY} bytes`);
      }
      if (!res.ok) {
        throw new Error(`weixin: ${label}: HTTP ${res.status}: ${truncate(text, 256)}`);
      }
      if (!text.trim()) return null;
      return JSON.parse(text);
    } catch (err) {
      // Node 22 undici 把真实错误塞进 err.cause（'fetch failed' 几乎没信息量）。
      // 抽出 cause 链路 → 打到日志 + 抛出更详细的错误。
      const detail = describeFetchError(err);
      console.error(`[wechat/client] ${label} ${this.url(path)} →`, detail);
      throw new Error(`weixin: ${label}: ${detail}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Long-poll for incoming messages. Pass empty buf for the first call;
   * use the returned get_updates_buf as cursor for the next call.
   */
  async getUpdates(buf: string, timeoutMs?: number): Promise<GetUpdatesResp> {
    const t = timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_LONG_POLL_TIMEOUT_MS;
    try {
      const data = (await this.post(
        'ilink/bot/getupdates',
        { get_updates_buf: buf, base_info: { channel_version: CHANNEL_VERSION } },
        t + 5_000,
        'getUpdates',
      )) as GetUpdatesResp | null;
      return data ?? { ret: 0, msgs: [], get_updates_buf: buf };
    } catch (err) {
      if (isAbortError(err)) {
        return { ret: 0, msgs: [], get_updates_buf: buf };
      }
      throw err;
    }
  }

  /** Verify token validity. ok=true if getUpdates with empty buf succeeds. */
  async verifyToken(): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await this.getUpdates('', 5_000);
      // ilink 成功响应不带 ret 字段（仅错误时返回）— undefined / null 视为成功。
      if (r.ret == null || r.ret === 0) return { ok: true };
      return { ok: false, error: `ret=${r.ret} ${r.errmsg ?? ''}`.trim() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'verify failed' };
    }
  }

  /**
   * Download a CDN-hosted media blob (image/voice/file) and AES-128-ECB decrypt it.
   * Caller passes the encrypted_query_param + AES key (16 raw bytes) from the
   * inbound MessageItem.
   */
  async downloadCdnMedia(args: {
    encryptedQueryParam: string;
    aesKey: Buffer;
    signal?: AbortSignal;
  }): Promise<Buffer> {
    return downloadAndDecryptCdnMedia({
      cdnBase: this.cdnBase(),
      encryptedQueryParam: args.encryptedQueryParam,
      aesKey: args.aesKey,
      signal: args.signal,
    });
  }

  /**
   * Ask the ilink server for an upload URL + handle for an outbound media blob.
   * Caller has already generated the AES key (hex) and computed sizes.
   */
  private async getUploadUrl(req: GetUploadUrlReq): Promise<GetUploadUrlResp> {
    const data = (await this.post(
      'ilink/bot/getuploadurl',
      { ...req, base_info: { channel_version: CHANNEL_VERSION } },
      DEFAULT_API_TIMEOUT_MS,
      'getUploadURL',
    )) as GetUploadUrlResp | null;
    return data ?? {};
  }

  /**
   * Upload an image to the WeChat CDN and send it to the peer in a single
   * sendmessage call. Returns the client_id used (as messageId).
   *
   * Workflow (mirrors cc-connect SendImage):
   *   1. random 16-byte AES key + random 16-char filekey
   *   2. POST /ilink/bot/getuploadurl with media_type=1, rawsize, md5, filesize, aeskey(hex)
   *   3. AES-128-ECB encrypt + POST to upload_full_url (or {cdn}/upload?upload_param + filekey)
   *   4. server returns x-encrypted-param header (download_param)
   *   5. POST /ilink/bot/sendmessage with image_item.media{ encrypt_query_param, aes_key=base64(hex), encrypt_type=1 }
   */
  async sendImage(args: {
    toUserId: string;
    bytes: Buffer;
    contextToken: string;
    clientId?: string;
  }): Promise<{ ok: boolean; ret?: number; error?: string; clientId?: string }> {
    if (!args.contextToken.trim()) {
      return { ok: false, error: 'context_token required (reply to an inbound message first)' };
    }
    if (args.bytes.length === 0) {
      return { ok: false, error: 'empty image' };
    }
    const aesKey = randomAesKey();
    const filekey = randomHex(8); // 16-char hex
    const rawsize = args.bytes.length;
    const filesize = aesEcbPaddedSize(rawsize);
    const clientId = args.clientId ?? newClientId();

    let upload: GetUploadUrlResp;
    try {
      upload = await this.getUploadUrl({
        filekey,
        media_type: UPLOAD_MEDIA_IMAGE,
        to_user_id: args.toUserId,
        rawsize,
        rawfilemd5: md5Hex(args.bytes),
        filesize,
        no_need_thumb: true,
        aeskey: aesKey.toString('hex'),
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'getUploadURL failed' };
    }
    if (upload.ret != null && upload.ret !== 0) {
      return { ok: false, ret: upload.ret, error: `getUploadURL ret=${upload.ret} ${upload.errmsg ?? ''}`.trim() };
    }

    const uploadUrl = upload.upload_full_url
      || (upload.upload_param
        ? buildCdnUploadUrl(this.cdnBase(), upload.upload_param, filekey)
        : '');
    if (!uploadUrl) {
      return { ok: false, error: 'getUploadURL returned no upload URL' };
    }

    let downloadParam: string;
    try {
      downloadParam = await uploadEncryptedToCdn({
        uploadUrl,
        plaintext: args.bytes,
        aesKey,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'CDN upload failed' };
    }

    const msg: OutboundMsg = {
      from_user_id: '',
      to_user_id: args.toUserId,
      client_id: clientId,
      message_type: MESSAGE_TYPE_BOT,
      message_state: MESSAGE_STATE_FINISH,
      item_list: [
        {
          type: MESSAGE_ITEM_IMAGE,
          image_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: formatAesKeyForApi(aesKey),
              encrypt_type: 1,
            },
            mid_size: filesize,
          },
        },
      ],
      context_token: args.contextToken,
    };

    try {
      const data = (await this.post(
        'ilink/bot/sendmessage',
        { msg, base_info: { channel_version: CHANNEL_VERSION } },
        DEFAULT_API_TIMEOUT_MS,
        'sendMessage',
      )) as SendMessageResp | null;
      if (!data || data.ret == null || data.ret === 0) return { ok: true, clientId };
      return {
        ok: false,
        ret: data.ret,
        error: `ret=${data.ret} errcode=${data.errcode ?? ''} errmsg=${data.errmsg ?? ''}`.trim(),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'sendMessage failed' };
    }
  }

  /**
   * Upload a generic file (Word / Excel / PPT / PDF / zip / 任意二进制) to the
   * WeChat CDN and send it to the peer as a file_item. Mirrors cc-connect SendFile.
   *
   * 与 sendImage 的差别：media_type=3，sendmessage 的 item_list 用 file_item
   * (含 file_name + len)，无 mid_size 字段。
   */
  async sendFile(args: {
    toUserId: string;
    bytes: Buffer;
    fileName: string;
    contextToken: string;
    clientId?: string;
  }): Promise<{ ok: boolean; ret?: number; error?: string; clientId?: string }> {
    if (!args.contextToken.trim()) {
      return { ok: false, error: 'context_token required (reply to an inbound message first)' };
    }
    if (args.bytes.length === 0) {
      return { ok: false, error: 'empty file' };
    }
    const fileName = (args.fileName || '').trim() || 'file.bin';

    const aesKey = randomAesKey();
    const filekey = randomHex(8);
    const rawsize = args.bytes.length;
    const filesize = aesEcbPaddedSize(rawsize);
    const clientId = args.clientId ?? newClientId();

    let upload: GetUploadUrlResp;
    try {
      upload = await this.getUploadUrl({
        filekey,
        media_type: UPLOAD_MEDIA_FILE,
        to_user_id: args.toUserId,
        rawsize,
        rawfilemd5: md5Hex(args.bytes),
        filesize,
        no_need_thumb: true,
        aeskey: aesKey.toString('hex'),
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'getUploadURL failed' };
    }
    if (upload.ret != null && upload.ret !== 0) {
      return { ok: false, ret: upload.ret, error: `getUploadURL ret=${upload.ret} ${upload.errmsg ?? ''}`.trim() };
    }

    const uploadUrl = upload.upload_full_url
      || (upload.upload_param
        ? buildCdnUploadUrl(this.cdnBase(), upload.upload_param, filekey)
        : '');
    if (!uploadUrl) {
      return { ok: false, error: 'getUploadURL returned no upload URL' };
    }

    let downloadParam: string;
    try {
      downloadParam = await uploadEncryptedToCdn({
        uploadUrl,
        plaintext: args.bytes,
        aesKey,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'CDN upload failed' };
    }

    const msg: OutboundMsg = {
      from_user_id: '',
      to_user_id: args.toUserId,
      client_id: clientId,
      message_type: MESSAGE_TYPE_BOT,
      message_state: MESSAGE_STATE_FINISH,
      item_list: [
        {
          type: MESSAGE_ITEM_FILE,
          file_item: {
            media: {
              encrypt_query_param: downloadParam,
              aes_key: formatAesKeyForApi(aesKey),
              encrypt_type: 1,
            },
            file_name: fileName,
            len: String(rawsize),
          },
        },
      ],
      context_token: args.contextToken,
    };

    try {
      const data = (await this.post(
        'ilink/bot/sendmessage',
        { msg, base_info: { channel_version: CHANNEL_VERSION } },
        DEFAULT_API_TIMEOUT_MS,
        'sendMessage',
      )) as SendMessageResp | null;
      if (!data || data.ret == null || data.ret === 0) return { ok: true, clientId };
      return {
        ok: false,
        ret: data.ret,
        error: `ret=${data.ret} errcode=${data.errcode ?? ''} errmsg=${data.errmsg ?? ''}`.trim(),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'sendMessage failed' };
    }
  }

  /**
   * Experimental: send an outbound voice_item so WeChat can render a native
   * voice bubble instead of a generic file attachment. The iLink channel does
   * not publicly guarantee bot-side voice delivery, so callers should keep a
   * file_item fallback if this returns an error.
   */
  async sendVoice(args: {
    toUserId: string;
    bytes: Buffer;
    contextToken: string;
    encodeType: number;
    sampleRate?: number;
    bitsPerSample?: number;
    playtime?: number;
    clientId?: string;
  }): Promise<{ ok: boolean; ret?: number; error?: string; clientId?: string }> {
    if (!args.contextToken.trim()) {
      return { ok: false, error: 'context_token required (reply to an inbound message first)' };
    }
    if (args.bytes.length === 0) {
      return { ok: false, error: 'empty voice' };
    }

    const aesKey = randomAesKey();
    const filekey = randomHex(8);
    const rawsize = args.bytes.length;
    const filesize = aesEcbPaddedSize(rawsize);
    const clientId = args.clientId ?? newClientId();

    let upload: GetUploadUrlResp;
    try {
      upload = await this.getUploadUrl({
        filekey,
        media_type: UPLOAD_MEDIA_VOICE,
        to_user_id: args.toUserId,
        rawsize,
        rawfilemd5: md5Hex(args.bytes),
        filesize,
        no_need_thumb: true,
        aeskey: aesKey.toString('hex'),
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'getUploadURL failed' };
    }
    if (upload.ret != null && upload.ret !== 0) {
      return { ok: false, ret: upload.ret, error: `getUploadURL ret=${upload.ret} ${upload.errmsg ?? ''}`.trim() };
    }

    const uploadUrl = upload.upload_full_url
      || (upload.upload_param
        ? buildCdnUploadUrl(this.cdnBase(), upload.upload_param, filekey)
        : '');
    if (!uploadUrl) {
      return { ok: false, error: 'getUploadURL returned no upload URL' };
    }

    let downloadParam: string;
    try {
      downloadParam = await uploadEncryptedToCdn({
        uploadUrl,
        plaintext: args.bytes,
        aesKey,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'CDN upload failed' };
    }

    const voiceItem = {
      media: {
        encrypt_query_param: downloadParam,
        aes_key: formatAesKeyForApi(aesKey),
        encrypt_type: 1,
      },
      encode_type: args.encodeType,
      sample_rate: args.sampleRate,
      bits_per_sample: args.bitsPerSample,
      playtime: args.playtime,
    };

    const msg: OutboundMsg = {
      from_user_id: '',
      to_user_id: args.toUserId,
      client_id: clientId,
      message_type: MESSAGE_TYPE_BOT,
      message_state: MESSAGE_STATE_FINISH,
      item_list: [
        {
          type: MESSAGE_ITEM_VOICE,
          voice_item: voiceItem,
        },
      ],
      context_token: args.contextToken,
    };

    try {
      const data = (await this.post(
        'ilink/bot/sendmessage',
        { msg, base_info: { channel_version: CHANNEL_VERSION } },
        DEFAULT_API_TIMEOUT_MS,
        'sendMessage',
      )) as SendMessageResp | null;
      if (!data || data.ret == null || data.ret === 0) return { ok: true, clientId };
      return {
        ok: false,
        ret: data.ret,
        error: `ret=${data.ret} errcode=${data.errcode ?? ''} errmsg=${data.errmsg ?? ''}`.trim(),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'sendMessage failed' };
    }
  }

  /** Send a text reply. context_token must come from the latest inbound message of that peer. */
  async sendText(args: {
    toUserId: string;
    text: string;
    contextToken: string;
    clientId: string;
  }): Promise<{ ok: boolean; ret?: number; error?: string }> {
    if (!args.contextToken.trim()) {
      return { ok: false, error: 'context_token required (reply to an inbound message first)' };
    }
    const msg: OutboundMsg = {
      from_user_id: '',
      to_user_id: args.toUserId,
      client_id: args.clientId,
      message_type: MESSAGE_TYPE_BOT,
      message_state: MESSAGE_STATE_FINISH,
      item_list: [{ type: MESSAGE_ITEM_TEXT, text_item: { text: args.text } }],
      context_token: args.contextToken,
    };
    try {
      const data = (await this.post(
        'ilink/bot/sendmessage',
        { msg, base_info: { channel_version: CHANNEL_VERSION } },
        DEFAULT_API_TIMEOUT_MS,
        'sendMessage',
      )) as SendMessageResp | null;
      // ilink 成功响应不带 ret 字段（仅错误时返回）— undefined / null 视为成功，
      // 与 getUpdates 一致。之前 `data.ret === 0` 在 undefined 时为 false，每条
      // AI 回复都被误判为发送失败。
      if (!data || data.ret == null || data.ret === 0) return { ok: true };
      return {
        ok: false,
        ret: data.ret,
        error: `ret=${data.ret} errcode=${data.errcode ?? ''} errmsg=${data.errmsg ?? ''}`.trim(),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'send failed' };
    }
  }
}

// ---- Helpers ----------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
}

/**
 * 把 Node 22 undici 的洋葱式 cause 链路抽出来。"fetch failed" 本身没信息量，
 * 真实根因（ENOTFOUND / ECONNREFUSED / 证书错误 / EAI_AGAIN）都在 err.cause。
 */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [err.message];
  let cur: unknown = (err as { cause?: unknown }).cause;
  let depth = 0;
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      const code = (cur as { code?: string }).code;
      const errno = (cur as { errno?: number }).errno;
      const host = (cur as { hostname?: string }).hostname;
      const seg = [
        cur.message,
        code ? `code=${code}` : '',
        errno ? `errno=${errno}` : '',
        host ? `host=${host}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      parts.push(seg);
      cur = (cur as { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      cur = null;
    }
    depth += 1;
  }
  return parts.join(' ← ');
}

/** Generate a random 16-byte hex client_id (matches cc-connect's behavior). */
export function newClientId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate X-WECHAT-UIN header value: random uint32 → decimal string → base64.
 * 复刻自 cc-connect randomWechatUIN()。
 */
function randomWechatUIN(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const u =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0; // unsigned
  return Buffer.from(String(u), 'utf-8').toString('base64');
}
