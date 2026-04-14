import { getDb } from '@/lib/db/connection';
import { getDefaultProvider, getProvider } from '@/lib/db/providers';
import { getSetting } from '@/lib/db/sessions';
import { providerSupportsCapability } from '@/lib/provider-config';
import { isPro } from '@/lib/edition';
import { canUseCustomProviders } from '@/lib/edition-runtime';
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

function getLumosCloudSystemProvider(): ApiProvider | undefined {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id FROM api_providers WHERE name = 'Lumos Cloud' AND provider_origin = 'system' LIMIT 1",
    )
    .get() as { id: string } | undefined;
  return row ? getProvider(row.id) : undefined;
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
  // Pro-edition lockdown: when admin has disabled custom providers, ignore any
  // user-configured preferred/override/default and force the system Lumos
  // Cloud provider. image-gen is routed via provider_override:image (admin-
  // managed) so it falls through to the normal path below.
  if (isPro() && !canUseCustomProviders() && options.capability !== 'image-gen') {
    const cloud = getLumosCloudSystemProvider();
    if (!cloud) {
      throw new ProviderResolutionError(
        '管理员已禁用自定义服务商，但未找到 Lumos Cloud 服务商，请重新登录',
      );
    }
    return ensureProviderSupportsCapability(cloud, options.capability, 'Lumos Cloud');
  }

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
