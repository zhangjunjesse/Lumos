import crypto from 'crypto';

const SUBMIT_URL = 'https://zpayz.cn/submit.php';
const MAPI_URL = 'https://zpayz.cn/mapi.php';

/**
 * Generate zpay MD5 signature.
 * 1. Filter empty values, sign, sign_type
 * 2. Sort keys by ASCII ascending
 * 3. Concatenate key=value pairs with &
 * 4. Append key directly (no &)
 * 5. MD5 hex lowercase
 */
export function generateSign(
  params: Record<string, string>,
  key: string
): string {
  const filtered = Object.entries(params)
    .filter(([k, v]) => v !== '' && k !== 'sign' && k !== 'sign_type')
    .sort(([a], [b]) => a.localeCompare(b));

  const str = filtered.map(([k, v]) => `${k}=${v}`).join('&');
  const signStr = str + key;

  return crypto.createHash('md5').update(signStr).digest('hex');
}

/**
 * Verify zpay callback signature.
 */
export function verifySign(
  params: Record<string, string>,
  key: string
): boolean {
  const receivedSign = params.sign;
  if (!receivedSign) return false;

  const computed = generateSign(params, key);
  return computed === receivedSign.toLowerCase();
}

interface PaymentOrder {
  name: string;
  money: string;
  out_trade_no: string;
  type: 'alipay' | 'wxpay';
  notify_url: string;
  return_url: string;
  pid: string;
}

/**
 * Create payment URL for page-redirect mode (submit.php).
 */
export function createPaymentUrl(
  order: PaymentOrder
): { url: string; params: Record<string, string> } {
  const key = process.env.ZPAY_KEY;
  if (!key) throw new Error('ZPAY_KEY not configured');

  const params: Record<string, string> = {
    pid: order.pid,
    type: order.type,
    out_trade_no: order.out_trade_no,
    notify_url: order.notify_url,
    return_url: order.return_url,
    name: order.name,
    money: order.money,
  };

  params.sign = generateSign(params, key);
  params.sign_type = 'MD5';

  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  return { url: `${SUBMIT_URL}?${qs}`, params };
}

interface ApiPaymentOrder {
  name: string;
  money: string;
  out_trade_no: string;
  type: 'alipay' | 'wxpay';
  notify_url: string;
  clientip: string;
  pid: string;
  key: string;
}

/**
 * Create API payment via mapi.php (returns pay URL / QR code).
 */
export async function createApiPayment(
  order: ApiPaymentOrder
): Promise<{ payUrl: string; qrcode?: string }> {
  const params: Record<string, string> = {
    pid: order.pid,
    type: order.type,
    out_trade_no: order.out_trade_no,
    notify_url: order.notify_url,
    name: order.name,
    money: order.money,
    clientip: order.clientip,
  };

  params.sign = generateSign(params, order.key);
  params.sign_type = 'MD5';

  const body = new URLSearchParams(params);
  const res = await fetch(MAPI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await res.json();

  if (data.code !== 1) {
    throw new Error(`zpay API error: ${data.msg || 'unknown'}`);
  }

  return {
    payUrl: data.payurl,
    qrcode: data.qrcode || undefined,
  };
}
