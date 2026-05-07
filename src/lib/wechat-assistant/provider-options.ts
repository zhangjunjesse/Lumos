import { getAllProviders, getDefaultProvider, getProvider } from '@/lib/db/providers';
import { getProviderModelOptions, resolveProviderModelForRequest } from '@/lib/model-metadata';
import { providerSupportsCapability } from '@/lib/provider-config';

import type { ApiProvider } from '@/types';
import type { AppSettings, ProviderOption } from '@/components/apps/builtin/wechat/app-settings';

export type WeChatTextGenTarget =
  | { ok: true; provider: ApiProvider; providerId: string; model: string }
  | { ok: false; code: 'no_provider' | 'no_model'; message: string };

/**
 * List the providers eligible for the WeChat assistant's "AI" settings dropdown.
 * Filters by `text-gen` capability and strips api_key / base_url before
 * returning anything client-bound.
 */
export function listTextGenProviderOptions(): ProviderOption[] {
  const defaultId = getDefaultProvider()?.id ?? null;
  return getAllProviders()
    .filter(isUsableWeChatTextGenProvider)
    .map((p) => ({
      id: p.id,
      name: p.name,
      origin: normaliseOrigin(p.provider_origin),
      isDefault: p.id === defaultId,
      models: getProviderModelOptions(p).map((m) => ({
        value: m.value,
        label: m.label,
      })),
    }));
}

export function resolveWeChatTextGenerationTarget(
  settings: AppSettings,
  fallbackModel: 'sonnet' | 'haiku' | 'opus' = 'sonnet',
): WeChatTextGenTarget {
  const provider = settings.ai.providerId
    ? getProvider(settings.ai.providerId)
    : getDefaultProvider();

  if (!provider) {
    return {
      ok: false,
      code: 'no_provider',
      message: '尚未配置支持轻量文本生成的 API Key 服务商。请到微信助手设置里选择一个文本服务商。',
    };
  }

  if (!providerSupportsCapability(provider, 'text-gen')) {
    return {
      ok: false,
      code: 'no_provider',
      message: `服务商「${provider.name}」不支持轻量文本生成。请在微信助手设置里切换到文本生成服务商。`,
    };
  }

  if (provider.auth_mode === 'local_auth') {
    return {
      ok: false,
      code: 'no_provider',
      message: `服务商「${provider.name}」使用本地登录授权，暂不支持微信助手的轻量文本生成。请切换到 API Key 类型的文本服务商。`,
    };
  }

  const model = resolveProviderModelForRequest(provider, settings.ai.model, fallbackModel);
  if (!model) {
    return {
      ok: false,
      code: 'no_model',
      message: `服务商「${provider.name}」没有可用的文本模型。请在服务商设置里补全模型，或切换到其它文本服务商。`,
    };
  }

  return { ok: true, provider, providerId: provider.id, model };
}

export function isUsableWeChatTextGenProvider(provider: ApiProvider): boolean {
  return providerSupportsCapability(provider, 'text-gen') && provider.auth_mode !== 'local_auth';
}

function normaliseOrigin(value: string): ProviderOption['origin'] {
  if (value === 'system' || value === 'preset' || value === 'custom') return value;
  return 'custom';
}
