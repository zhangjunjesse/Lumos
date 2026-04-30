/**
 * WeChat Provider — ilink HTTP Client
 *
 * 协议参考 cc-connect/platform/weixin/client.go (MIT)。
 * 4 个核心 endpoint：
 *   POST /ilink/bot/getupdates    — 长轮询拉消息
 *   POST /ilink/bot/sendmessage   — 发消息
 *   POST /ilink/bot/getconfig     — 拿 typing ticket（M+1 再做）
 *   POST /ilink/bot/sendtyping    — 发 typing 状态（M+1 再做）
 *
 * 鉴权 header: Authorization: Bearer <token>; iLink-App-ClientVersion: 1.
 * 可选 SKRouteTag header（routeTag 由配置传，默认空）。
 */

const CHANNEL_VERSION = 'lumos-wechat/1.0';
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BODY = 64 * 1024 * 1024; // 64MB cap

export const MESSAGE_TYPE_USER = 1;
export const MESSAGE_TYPE_BOT = 2;
export const MESSAGE_ITEM_TEXT = 1;
export const MESSAGE_ITEM_IMAGE = 2;
export const MESSAGE_ITEM_VOICE = 3;
export const MESSAGE_ITEM_FILE = 4;
export const MESSAGE_ITEM_VIDEO = 5;
export const MESSAGE_STATE_FINISH = 2;
export const ERR_SESSION_EXPIRED = -14;

// ---- JSON shapes from ilink API ---------------------------------------------

export interface BaseInfo {
  channel_version?: string;
}

export interface TextItem {
  text?: string;
}

export interface VoiceItem {
  text?: string; // ASR transcript
}

export interface MessageItem {
  type?: number;
  text_item?: TextItem;
  voice_item?: VoiceItem;
  ref_msg?: { message_item?: MessageItem; title?: string };
}

export interface WeixinInboundMsg {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesResp {
  ret: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinInboundMsg[];
  get_updates_buf: string;
  longpolling_timeout_ms?: number;
}

export interface SendMessageResp {
  ret: number;
  errcode?: number;
  errmsg?: string;
}

export interface OutboundMsg {
  from_user_id: string;
  to_user_id: string;
  client_id: string;
  message_type: number;
  message_state: number;
  item_list: MessageItem[];
  context_token: string;
}

export interface ClientOptions {
  baseUrl: string;
  token: string;
  routeTag?: string;
}

// ---- Client ----------------------------------------------------------------

export class WechatClient {
  constructor(private readonly options: ClientOptions) {}

  private url(path: string): string {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    const p = path.replace(/^\/+/, '');
    return `${base}/${p}`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.options.token}`,
      'iLink-App-ClientVersion': '1',
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

  /**
   * Verify token validity. Returns ok=true if getUpdates with empty buf succeeds.
   */
  async verifyToken(): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await this.getUpdates('', 5_000);
      if (r.ret === 0) return { ok: true };
      return { ok: false, error: `ret=${r.ret} ${r.errmsg ?? ''}`.trim() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'verify failed' };
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
      if (!data || data.ret === 0) return { ok: true };
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
