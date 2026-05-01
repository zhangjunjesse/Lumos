/**
 * WeChat Provider — QR Pairing Flow
 *
 * 协议参考 cc-connect/cmd/cc-connect/weixin.go (MIT)。
 *
 * 用户体验：
 *   1. UI 调 /api/im/wechat/setup/start → 后端调 fetchBotQRCode → 返回 { qrUrl, qrKey }
 *   2. UI 显示 QR（用 qrUrl 文本生成 QR 图，或直接展示链接让用户扫）
 *   3. UI 周期性调 /api/im/wechat/setup/poll?qrKey=... → 后端 pollQRStatus
 *      - "wait" / "scaned" → 继续轮询
 *      - "expired" → UI 调 /start 拿新 qrKey
 *      - "confirmed" → 后端把 token + base_url 写入 settings，UI 关弹窗
 *
 * 不需要任何 token 鉴权（这就是配 token 的过程）。
 */

const DEFAULT_API_BASE = 'https://ilinkai.weixin.qq.com';
const DEFAULT_BOT_TYPE = '3';
const STATUS_POLL_TIMEOUT_MS = 35_000;
const QR_FETCH_TIMEOUT_MS = 15_000;

export interface QRCodePayload {
  /** Token 用 — server-issued 二维码 key（轮询状态用） */
  qrcode: string;
  /** 给用户扫的 URL（让用户在微信扫一扫识别） */
  qrcode_img_content: string;
}

export type QRStatus =
  | 'wait'
  | 'scaned'
  | 'expired'
  | 'confirmed'
  | 'unknown';

export interface QRStatusPayload {
  status: QRStatus;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

export interface FetchQROptions {
  apiBase?: string;
  botType?: string;
  routeTag?: string;
}

/**
 * GET <apiBase>/ilink/bot/get_bot_qrcode?bot_type=<bot_type>
 */
export async function fetchBotQRCode(
  opts: FetchQROptions = {},
): Promise<QRCodePayload> {
  const apiBase = (opts.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const botType = opts.botType || DEFAULT_BOT_TYPE;
  const url = new URL(`${apiBase}/ilink/bot/get_bot_qrcode`);
  url.searchParams.set('bot_type', botType);

  const headers: Record<string, string> = { 'iLink-App-ClientVersion': '1' };
  if (opts.routeTag) headers.SKRouteTag = opts.routeTag;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`get_bot_qrcode HTTP ${res.status}: ${truncate(text, 200)}`);
    const data = JSON.parse(text) as QRCodePayload;
    if (!data.qrcode_img_content) {
      throw new Error('get_bot_qrcode: empty qrcode_img_content');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET <apiBase>/ilink/bot/get_qrcode_status?qrcode=<qrKey>
 *
 * 服务端长轮询 ~35s。客户端配合 timeout +5s 容错。
 */
export async function pollQRStatus(
  qrKey: string,
  opts: FetchQROptions = {},
): Promise<QRStatusPayload> {
  const apiBase = (opts.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
  const url = new URL(`${apiBase}/ilink/bot/get_qrcode_status`);
  url.searchParams.set('qrcode', qrKey);

  const headers: Record<string, string> = { 'iLink-App-ClientVersion': '1' };
  if (opts.routeTag) headers.SKRouteTag = opts.routeTag;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_POLL_TIMEOUT_MS + 5_000);
  try {
    const res = await fetch(url.toString(), { headers, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`get_qrcode_status HTTP ${res.status}: ${truncate(body, 200)}`);
    }
    const data = (await res.json()) as QRStatusPayload;
    return data;
  } catch (err) {
    if (isAbortError(err)) {
      // server long-poll timed out without status change — treat as wait
      return { status: 'wait' };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /aborted/i.test(err.message));
}
