/**
 * Image generation billing: local provider resolution + remote quota calls.
 *
 * `resolveBillingTarget` picks the active image-gen provider + model; the
 * `consume/refundRemoteQuota` pair talks to lumos-web `/api/quota/image/consume`
 * to deduct the user's new-api balance per generated image. HTTP transport
 * (proxy, retries, status mapping) lives in ./media-quota-client.
 */

import { getDb } from '@/lib/db/connection';
import { getSetting } from '@/lib/db/sessions';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getRemoteImageProviderId } from '@/lib/cloud/provisioner';
import { getProviderEffectiveDefaultModel } from '@/lib/claude/provider-env';
import { postQuotaConsume, postQuotaRefund } from './media-quota-client';
import type { ApiProvider } from '@/types';

const QUOTA_ENDPOINT = '/api/quota/image/consume';
const LOG_TAG = '[image-gen-tool]';

export interface BillingTarget {
  provider: ApiProvider;
  remoteProviderId: string | null;
  model: string;
}

/**
 * Resolve the model to use for this provider for billing purposes. Each
 * candidate is validated against the provider's catalog before being
 * trusted — otherwise a stale value would pin generation to a model that no
 * longer exists and every call would fail.
 *
 * Fallback (mirrors chat / knowledge / generate.ts):
 *   model_override:image (UI override) →
 *     provider effective default (user override > admin LUMOS_DEFAULT_MODEL) →
 *     catalog[0]
 */
function resolveModelForProvider(provider: ApiProvider): string {
  let catalog: Array<{ value?: string }> = [];
  try {
    catalog = JSON.parse(provider.model_catalog || '[]') as Array<{ value?: string }>;
  } catch { /* catalog stays empty → fallback path */ }

  const validValues = new Set(
    catalog
      .map(m => (typeof m?.value === 'string' ? m.value : ''))
      .filter(Boolean),
  );
  const firstModel = catalog.find(m => typeof m?.value === 'string' && m.value)?.value ?? '';

  const override = getSetting('model_override:image')?.trim();
  if (override && validValues.has(override)) return override;

  const effectiveDefault = getProviderEffectiveDefaultModel(provider);
  if (effectiveDefault && validValues.has(effectiveDefault)) return effectiveDefault;

  return firstModel;
}

export function resolveBillingTarget(providerId?: string): BillingTarget | { error: string } {
  let provider: ApiProvider | undefined;
  try {
    provider = resolveProviderForCapability({
      moduleKey: 'image', capability: 'image-gen', allowDefault: false,
      // 必须跟 generateImages 用同一个解析入参,否则"扣费的服务商"和"出图的服务商"会错位
      preferredProviderId: providerId,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const src = providerId ? `指定服务商 ${providerId}` : 'settings.provider_override:image';
    return { error: `图片生成服务商解析失败 (${src}): ${detail}` };
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
  return postQuotaConsume({
    userId: params.userId,
    endpoint: QUOTA_ENDPOINT,
    featureLabel: '图片生成',
    logTag: LOG_TAG,
    payload: {
      action: 'consume',
      provider_id: params.providerId,
      model: params.model,
      count: params.count,
      idempotency_key: params.idempotencyKey,
    },
  });
}

/** Best-effort refund. Logs on failure but does not throw. */
export async function refundRemoteQuota(userId: string, idempotencyKey: string): Promise<void> {
  return postQuotaRefund({ userId, endpoint: QUOTA_ENDPOINT, idempotencyKey, logTag: LOG_TAG });
}
