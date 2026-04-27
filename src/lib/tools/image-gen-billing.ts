/**
 * Image generation billing: local provider resolution + remote quota calls.
 *
 * `resolveBillingTarget` picks the active image-gen provider + model; the
 * `consume/refundRemoteQuota` pair talks to lumos-web `/api/quota/image/consume`
 * to deduct the user's new-api balance per generated image.
 */

import { getDb } from '@/lib/db/connection';
import { getSetting } from '@/lib/db/sessions';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getRemoteImageProviderId } from '@/lib/cloud/provisioner';
import type { ApiProvider } from '@/types';

const QUOTA_REQUEST_TIMEOUT_MS = 8_000;
const QUOTA_MAX_ATTEMPTS = 2;
const QUOTA_RETRY_BACKOFF_MS = 600;

function getWebBase(): string {
  return process.env.LUMOS_WEB_URL || 'https://lumos.miki.zj.cn';
}

function getWebSessionToken(userId: string): string | null {
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

export interface BillingTarget {
  provider: ApiProvider;
  remoteProviderId: string | null;
  model: string;
}

/**
 * Resolve the model to use for this provider. The override setting
 * (`model_override:image`) is validated against the provider's catalog before
 * being trusted — otherwise a stale override (from a prior provider whose
 * catalog has since been rewritten by the login-time provisioner) would pin
 * generation to a model that no longer exists and every call would fail.
 */
function resolveModelForProvider(provider: ApiProvider): string {
  let catalog: Array<{ value?: string }> = [];
  try {
    catalog = JSON.parse(provider.model_catalog || '[]') as Array<{ value?: string }>;
  } catch { /* catalog stays empty → fallback path */ }

  const firstModel = catalog.find(m => typeof m?.value === 'string' && m.value)?.value ?? '';
  const override = getSetting('model_override:image')?.trim();
  if (override && catalog.some(m => m?.value === override)) return override;
  return firstModel;
}

export function resolveBillingTarget(): BillingTarget | { error: string } {
  let provider: ApiProvider | undefined;
  try {
    provider = resolveProviderForCapability({
      moduleKey: 'image', capability: 'image-gen', allowDefault: false,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { error: `图片生成服务商解析失败 (settings.provider_override:image): ${detail}` };
  }
  if (!provider) {
    return {
      error:
        '未配置图片生成服务商：settings.provider_override:image 为空。'
        + '请在「设置 → 图片生成」中指定一个支持 image-gen 能力的服务商。',
    };
  }
  const model = resolveModelForProvider(provider);
  const remoteProviderId = getRemoteImageProviderId(getDb(), provider.id);
  return { provider, remoteProviderId, model };
}

export interface QuotaConsumeParams {
  userId: string;
  providerId: string;
  model: string;
  count: number;
  idempotencyKey: string;
}

export async function consumeRemoteQuota(
  params: QuotaConsumeParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = getWebSessionToken(params.userId);
  if (!token) {
    return {
      ok: false,
      error: `未登录 Lumos 云账户，无法使用图片生成功能 (userId=${params.userId}，lumos_users.web_session_token 为空)`,
    };
  }

  const url = `${getWebBase()}/api/quota/image/consume`;
  const body = JSON.stringify({
    action: 'consume',
    provider_id: params.providerId,
    model: params.model,
    count: params.count,
    idempotency_key: params.idempotencyKey,
  });

  let res: Response | undefined;
  const attemptErrors: string[] = [];
  for (let attempt = 1; attempt <= QUOTA_MAX_ATTEMPTS; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(QUOTA_REQUEST_TIMEOUT_MS),
      });
      break;
    } catch (err) {
      const detail = describeFetchError(err);
      attemptErrors.push(`#${attempt} ${detail}`);
      console.warn(`[image-gen-tool] quota fetch attempt ${attempt}/${QUOTA_MAX_ATTEMPTS} failed: ${detail}`);
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
    return { ok: false, error: `图片计费冲突 (HTTP 409: ${detail})` };
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
export async function refundRemoteQuota(userId: string, idempotencyKey: string): Promise<void> {
  const token = getWebSessionToken(userId);
  if (!token) return;
  try {
    await fetch(`${getWebBase()}/api/quota/image/consume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'refund', idempotency_key: idempotencyKey }),
      signal: AbortSignal.timeout(QUOTA_REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn('[image-gen-tool] Failed to refund quota:', e);
  }
}
