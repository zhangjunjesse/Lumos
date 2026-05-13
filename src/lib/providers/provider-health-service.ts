import { getProvider } from '@/lib/db/providers';
import { getProviderEffectiveDefaultModel } from '@/lib/claude/provider-env';
import {
  resolveProviderRequestApiKey,
} from '@/lib/provider-model-discovery';
import { resolveProviderModelForRequest } from '@/lib/model-metadata';
import { classifyProviderProbeResult } from './provider-health-classifier';
import {
  getCachedProviderHealth,
  setCachedProviderHealth,
} from './provider-health-cache';
import { PROVIDER_PROBE_ADAPTERS } from './provider-health-adapters';
import type {
  ProviderHealthCheckOptions,
  ProviderHealthClassification,
  ProviderHealthResult,
  RawProbeResult,
} from './provider-health-types';
import type { ApiProvider } from '@/types';

const PROBE_TIMEOUT_MS = 15_000;

export class ProviderHealthNotFoundError extends Error {
  constructor(providerId: string) {
    super(`Provider not found: ${providerId}`);
    this.name = 'ProviderHealthNotFoundError';
  }
}

export class ProviderHealthValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderHealthValidationError';
  }
}

function buildResult(params: {
  provider: ApiProvider;
  model: string;
  raw?: RawProbeResult;
  classification: ProviderHealthClassification;
}): ProviderHealthResult {
  return {
    providerId: params.provider.id,
    providerName: params.provider.name,
    model: params.model,
    status: params.classification.status,
    ok: params.classification.ok,
    ...(params.raw?.httpStatus ? { httpStatus: params.raw.httpStatus } : {}),
    latencyMs: Math.max(0, Math.floor(params.raw?.latencyMs || 0)),
    ...(params.raw?.requestId ? { requestId: params.raw.requestId } : {}),
    retryable: params.classification.retryable,
    message: params.classification.message,
    checkedAt: new Date().toISOString(),
    cached: false,
  };
}

function immediateResult(params: {
  provider: ApiProvider;
  model: string;
  classification: ProviderHealthClassification;
}): ProviderHealthResult {
  return buildResult({
    provider: params.provider,
    model: params.model,
    classification: params.classification,
    raw: { ok: params.classification.ok, latencyMs: 0 },
  });
}

function resolveProbeModel(provider: ApiProvider, requestedModel?: string): string {
  const requested = requestedModel?.trim()
    || getProviderEffectiveDefaultModel(provider)
    || provider.default_model?.trim()
    || '';
  return resolveProviderModelForRequest(provider, requested, 'haiku') || requested;
}

async function runProbeWithTimeout(
  provider: ApiProvider,
  model: string,
): Promise<RawProbeResult> {
  const adapter = PROVIDER_PROBE_ADAPTERS.find((candidate) => candidate.canHandle(provider));
  if (!adapter) {
    return {
      ok: false,
      latencyMs: 0,
      bodyText: `Unsupported provider protocol: ${provider.api_protocol}`,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await adapter.probe({ provider, model, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkProviderHealthForProvider(params: {
  provider: ApiProvider;
  model?: string;
  force?: boolean;
}): Promise<ProviderHealthResult> {
  const provider = params.provider;
  const model = resolveProbeModel(provider, params.model);
  if (!model) {
    const result = immediateResult({
      provider,
      model: '',
      classification: {
        status: 'model_unavailable',
        ok: false,
        retryable: false,
        message: '服务商没有可用于探测的模型。请先在服务商配置里选择或填写模型。',
      },
    });
    setCachedProviderHealth(result);
    return result;
  }

  if (!params.force) {
    const cached = getCachedProviderHealth(provider.id, model);
    if (cached) return cached;
  }

  if (provider.auth_mode === 'local_auth') {
    const result = immediateResult({
      provider,
      model,
      classification: {
        status: 'unknown_error',
        ok: false,
        retryable: false,
        message: '当前服务商使用本地登录模式，后台 HTTP 健康探测暂不支持。请改用登录状态检查或切换 API Key 服务商。',
      },
    });
    setCachedProviderHealth(result);
    return result;
  }

  if (!resolveProviderRequestApiKey(provider)) {
    const result = immediateResult({
      provider,
      model,
      classification: {
        status: 'auth_failed',
        ok: false,
        retryable: false,
        message: '当前服务商缺少 API Key，无法发起健康探测。',
      },
    });
    setCachedProviderHealth(result);
    return result;
  }

  if (!PROVIDER_PROBE_ADAPTERS.some((candidate) => candidate.canHandle(provider))) {
    const result = immediateResult({
      provider,
      model,
      classification: {
        status: 'unknown_error',
        ok: false,
        retryable: false,
        message: `当前服务商协议 ${provider.api_protocol} 暂未接入后台健康探测。`,
      },
    });
    setCachedProviderHealth(result);
    return result;
  }

  const raw = await runProbeWithTimeout(provider, model);
  const classification = classifyProviderProbeResult(raw);
  const result = buildResult({ provider, model, raw, classification });
  setCachedProviderHealth(result);
  return result;
}

export async function checkProviderHealth(options: ProviderHealthCheckOptions): Promise<ProviderHealthResult> {
  const providerId = options.providerId.trim();
  if (!providerId) {
    throw new ProviderHealthValidationError('providerId is required');
  }

  const provider = getProvider(providerId);
  if (!provider) {
    throw new ProviderHealthNotFoundError(providerId);
  }

  return checkProviderHealthForProvider({
    provider,
    model: options.model,
    force: options.force,
  });
}
