/**
 * Video generation billing: local provider resolution + remote quota calls.
 *
 * `resolveVideoBillingTarget` picks the active video-gen provider + model and
 * the provider's default duration; the `consume/refundVideoQuota` pair talks
 * to lumos-web `/api/quota/video/consume` to deduct the user's new-api
 * balance at price_per_second × duration. HTTP transport lives in
 * ./media-quota-client.
 */

import { getDb } from '@/lib/db/connection';
import { getSetting } from '@/lib/db/sessions';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getRemoteVideoProviderId } from '@/lib/cloud/provisioner';
import { getProviderEffectiveDefaultModel } from '@/lib/claude/provider-env';
import { getVideoProviderDefaults } from '@/lib/video/provider-defaults';
import { getVideoModelProfile } from '@/lib/video/model-profiles';
import { postQuotaConsume, postQuotaRefund } from './media-quota-client';
import type { ApiProvider } from '@/types';

const QUOTA_ENDPOINT = '/api/quota/video/consume';
const LOG_TAG = '[video-gen-tool]';

export interface VideoBillingTarget {
  provider: ApiProvider;
  remoteProviderId: string | null;
  /** Resolved model — '' when the provider has no catalog and nothing is set. */
  model: string;
  /** Provider-configured default duration (seconds); billing basis when the agent omits duration. */
  defaultDuration: number;
}

function parseCatalogValues(provider: ApiProvider): string[] {
  try {
    const catalog = JSON.parse(provider.model_catalog || '[]') as Array<{ value?: string }>;
    return catalog
      .map(m => (typeof m?.value === 'string' ? m.value.trim() : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Resolve the model to bill and generate with. Unlike image (where the agent
 * cannot pick a model), generate_video exposes a `model` arg — an explicit
 * request outside the provider's catalog is rejected instead of silently
 * re-mapped, so the agent can correct itself and billing never diverges from
 * what actually runs.
 *
 * Fallback (mirrors video/generate.ts::resolveVideoModel):
 *   preferred (agent arg, catalog-validated) →
 *     model_override:video (UI override, catalog-validated) →
 *     provider effective default (catalog-validated) →
 *     catalog[0]
 */
function resolveModelForProvider(
  provider: ApiProvider,
  preferred?: string,
): { model: string } | { error: string } {
  const values = parseCatalogValues(provider);
  const validValues = new Set(values);

  const wanted = preferred?.trim();
  if (wanted) {
    if (validValues.size === 0 || validValues.has(wanted)) return { model: wanted };
    return {
      error:
        `模型 "${wanted}" 不在视频服务商"${provider.name}"的模型目录中。`
        + `可用模型: ${values.join(', ')}。请改用可用模型重新调用。`,
    };
  }

  const override = getSetting('model_override:video')?.trim();
  if (override && validValues.has(override)) return { model: override };

  const effectiveDefault = getProviderEffectiveDefaultModel(provider);
  if (effectiveDefault && validValues.has(effectiveDefault)) return { model: effectiveDefault };

  return { model: values[0] ?? '' };
}

export function resolveVideoBillingTarget(
  preferredModel?: string,
): VideoBillingTarget | { error: string } {
  let provider: ApiProvider | undefined;
  try {
    provider = resolveProviderForCapability({
      moduleKey: 'video', capability: 'video-gen', allowDefault: false,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { error: `视频生成服务商解析失败 (settings.provider_override:video): ${detail}` };
  }
  if (!provider) {
    return {
      error:
        '未配置视频生成服务商：settings.provider_override:video 为空。'
        + '请在「设置 → 视频生成」中指定一个支持 video-gen 能力的服务商。',
    };
  }
  const resolved = resolveModelForProvider(provider, preferredModel);
  if ('error' in resolved) return resolved;

  const defaultDuration = getVideoProviderDefaults(provider).duration
    ?? getVideoModelProfile(resolved.model).defaultDuration;
  const remoteProviderId = getRemoteVideoProviderId(getDb(), provider.id);
  return { provider, remoteProviderId, model: resolved.model, defaultDuration };
}

export interface VideoQuotaConsumeParams {
  userId: string;
  providerId: string;
  model: string;
  durationSeconds: number;
  idempotencyKey: string;
}

export async function consumeVideoQuota(
  params: VideoQuotaConsumeParams,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return postQuotaConsume({
    userId: params.userId,
    endpoint: QUOTA_ENDPOINT,
    featureLabel: '视频生成',
    logTag: LOG_TAG,
    payload: {
      action: 'consume',
      provider_id: params.providerId,
      model: params.model,
      duration_seconds: params.durationSeconds,
      idempotency_key: params.idempotencyKey,
    },
  });
}

/** Best-effort refund. Logs on failure but does not throw. */
export async function refundVideoQuota(userId: string, idempotencyKey: string): Promise<void> {
  return postQuotaRefund({ userId, endpoint: QUOTA_ENDPOINT, idempotencyKey, logTag: LOG_TAG });
}
