/**
 * Shared HTTP client for lumos-web media quota endpoints
 * (`/api/quota/{image,video}/consume`). Owns transport concerns only —
 * session token lookup, proxy-aware fetch, retries, and HTTP status → error
 * message mapping. Feature semantics (what gets billed, how the payload is
 * shaped) live in image-gen-billing / video-gen-billing.
 */

import { getDb } from '@/lib/db/connection';
import { createConfiguredHttpsProxyAgentForUrl, getConfiguredProxyForUrl } from '@/lib/net/proxy-settings';
import https from 'node:https';

const QUOTA_REQUEST_TIMEOUT_MS = 8_000;
const QUOTA_MAX_ATTEMPTS = 2;
const QUOTA_RETRY_BACKOFF_MS = 600;

type QuotaFetchInit = {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};

type QuotaFetchResponse = Pick<Response, 'ok' | 'status' | 'statusText' | 'text'>;

export function getWebBase(): string {
  return process.env.LUMOS_WEB_URL || 'https://lumos.miki.zj.cn';
}

export function getWebSessionToken(userId: string): string | null {
  const row = getDb().prepare(
    'SELECT web_session_token FROM lumos_users WHERE id = ?',
  ).get(userId) as { web_session_token: string } | undefined;
  return row?.web_session_token || null;
}

function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  const causeCode = cause && typeof cause === 'object' && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : undefined;
  const causeMsg = cause instanceof Error ? cause.message : undefined;
  const parts = [`${err.name}: ${err.message}`];
  if (causeCode) parts.push(`cause.code=${causeCode}`);
  if (causeMsg && causeMsg !== err.message) parts.push(`cause=${causeMsg}`);
  return parts.join(' | ');
}

function nodeHttpsQuotaFetch(url: string, init: QuotaFetchInit): Promise<QuotaFetchResponse> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const agent = createConfiguredHttpsProxyAgentForUrl(target);
    const body = Buffer.from(init.body);
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      init.signal.removeEventListener('abort', onAbort);
      fn();
    };

    const req = https.request(target, {
      method: init.method,
      headers: {
        ...init.headers,
        'Content-Length': String(body.byteLength),
      },
      agent: agent ?? undefined,
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        const rawText = Buffer.concat(chunks).toString('utf8');
        finish(() => resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: response.statusMessage ?? '',
          text: async () => rawText,
        }));
      });
    });

    function onAbort() {
      const reason = init.signal.reason instanceof Error
        ? init.signal.reason
        : new Error('The operation was aborted');
      req.destroy(reason);
    }

    req.on('error', err => finish(() => reject(err)));
    req.setTimeout(QUOTA_REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Quota request timed out after ${QUOTA_REQUEST_TIMEOUT_MS}ms`));
    });

    if (init.signal.aborted) {
      onAbort();
      return;
    }
    init.signal.addEventListener('abort', onAbort, { once: true });
    req.end(body);
  });
}

function quotaFetch(url: string, init: QuotaFetchInit): Promise<QuotaFetchResponse> {
  const target = new URL(url);
  if (target.protocol === 'https:' && getConfiguredProxyForUrl(target)) {
    return nodeHttpsQuotaFetch(url, init);
  }
  return fetch(url, init);
}

export interface QuotaConsumeRequest {
  userId: string;
  /** lumos-web path, e.g. '/api/quota/image/consume'. */
  endpoint: string;
  /** Human label for error messages, e.g. '图片生成' / '视频生成'. */
  featureLabel: string;
  /** Log prefix, e.g. '[image-gen-tool]'. */
  logTag: string;
  /** Full request body incl. action / idempotency_key — caller owns the shape. */
  payload: Record<string, unknown>;
}

export async function postQuotaConsume(
  req: QuotaConsumeRequest,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = getWebSessionToken(req.userId);
  if (!token) {
    return {
      ok: false,
      error: `未登录 Lumos 云账户，无法使用${req.featureLabel}功能 (userId=${req.userId}，lumos_users.web_session_token 为空)`,
    };
  }

  const url = `${getWebBase()}${req.endpoint}`;
  const body = JSON.stringify(req.payload);

  let res: QuotaFetchResponse | undefined;
  const attemptErrors: string[] = [];
  for (let attempt = 1; attempt <= QUOTA_MAX_ATTEMPTS; attempt++) {
    try {
      res = await quotaFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(QUOTA_REQUEST_TIMEOUT_MS),
      });
      break;
    } catch (err) {
      const detail = describeFetchError(err);
      attemptErrors.push(`#${attempt} ${detail}`);
      console.warn(`${req.logTag} quota fetch attempt ${attempt}/${QUOTA_MAX_ATTEMPTS} failed: ${detail}`);
      if (attempt < QUOTA_MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, QUOTA_RETRY_BACKOFF_MS * attempt));
      }
    }
  }
  if (!res) {
    return {
      ok: false,
      error: `Lumos 云配额接口不可达 (${url})，${QUOTA_MAX_ATTEMPTS} 次尝试均失败：${attemptErrors.join(' ; ')}`,
    };
  }

  const rawText = await res.text().catch(() => '');
  let data: Record<string, unknown> = {};
  try { data = rawText ? JSON.parse(rawText) : {}; } catch { /* non-JSON body */ }

  if (res.status === 401) {
    const detail = typeof data.error === 'string' ? data.error : (rawText.slice(0, 200) || '无返回');
    return { ok: false, error: `Lumos 云会话已过期，请重新登录 (HTTP 401: ${detail})` };
  }
  if (res.status === 402) {
    const detail = typeof data.error === 'string' ? data.error : '余额不足';
    return { ok: false, error: `Lumos 云余额不足 (HTTP 402: ${detail})` };
  }
  if (res.status === 409) {
    const detail = typeof data.error === 'string' ? data.error : '幂等键冲突';
    return { ok: false, error: `${req.featureLabel}计费冲突 (HTTP 409: ${detail})` };
  }
  if (!res.ok || !data.success) {
    const serverMsg = typeof data.error === 'string' ? data.error : rawText.slice(0, 300);
    return {
      ok: false,
      error: `Lumos 云计费失败 (HTTP ${res.status} ${res.statusText || ''}): ${serverMsg || '<空>'}`,
    };
  }
  return { ok: true };
}

/** Best-effort refund. Logs on failure but does not throw. */
export async function postQuotaRefund(params: {
  userId: string;
  endpoint: string;
  idempotencyKey: string;
  logTag: string;
}): Promise<void> {
  const token = getWebSessionToken(params.userId);
  if (!token) return;
  try {
    await quotaFetch(`${getWebBase()}${params.endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'refund', idempotency_key: params.idempotencyKey }),
      signal: AbortSignal.timeout(QUOTA_REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn(`${params.logTag} Failed to refund quota:`, e);
  }
}
