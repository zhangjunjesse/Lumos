import { getDefaultProvider, getProvider } from '@/lib/db/providers';
import { getSetting } from '@/lib/db/sessions';
import { providerSupportsCapability } from '@/lib/provider-config';
import type { ApiProvider, ProviderCapability } from '@/types';

export type ProviderModuleKey = 'chat' | 'knowledge' | 'workflow' | 'image';

export class ProviderResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderResolutionError';
  }
}

export function getProviderOverrideSettingKey(moduleKey: ProviderModuleKey): string {
  return `provider_override:${moduleKey}`;
}

export function getProviderOverrideId(moduleKey: ProviderModuleKey): string {
  return (getSetting(getProviderOverrideSettingKey(moduleKey)) || '').trim();
}

function describeCapability(capability: ProviderCapability): string {
  switch (capability) {
    case 'agent-chat':
      return '主聊天/Agent';
    case 'text-gen':
      return '文本生成';
    case 'image-gen':
      return '图片生成';
    case 'embedding':
      return '向量嵌入';
    default:
      return capability;
  }
}

function ensureProviderSupportsCapability(
  provider: ApiProvider,
  capability: ProviderCapability,
  sourceLabel: string,
): ApiProvider {
  if (!providerSupportsCapability(provider, capability)) {
    throw new ProviderResolutionError(
      `${sourceLabel}“${provider.name}”不支持 ${describeCapability(capability)}`,
    );
  }
  return provider;
}

function resolveProviderById(
  providerId: string,
  capability: ProviderCapability,
  sourceLabel: string,
): ApiProvider | undefined {
  const normalizedId = providerId.trim();
  if (!normalizedId) {
    return undefined;
  }

  if (normalizedId === 'env') {
    throw new ProviderResolutionError('旧环境模式已废弃，请重新选择配置开启新会话');
  }

  const provider = getProvider(normalizedId);
  if (!provider) {
    throw new ProviderResolutionError(`${sourceLabel}已删除或不存在`);
  }

  return ensureProviderSupportsCapability(provider, capability, sourceLabel);
}

export function resolveProviderForCapability(options: {
  moduleKey: ProviderModuleKey;
  capability: ProviderCapability;
  preferredProviderId?: string | null;
  allowDefault?: boolean;
}): ApiProvider | undefined {
  const preferredProviderId = options.preferredProviderId?.trim() || '';
  if (preferredProviderId) {
    return resolveProviderById(preferredProviderId, options.capability, '指定服务商');
  }

  const overrideProviderId = getProviderOverrideId(options.moduleKey);
  if (overrideProviderId) {
    return resolveProviderById(
      overrideProviderId,
      options.capability,
      `${options.moduleKey} 模块服务商`,
    );
  }

  if (options.allowDefault === false) {
    return undefined;
  }

  const defaultProvider = getDefaultProvider();
  if (!defaultProvider) {
    return undefined;
  }

  return ensureProviderSupportsCapability(defaultProvider, options.capability, '默认服务商');
}
