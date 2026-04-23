import { getDb } from '@/lib/db/connection';
import { getDefaultProvider, getProvider } from '@/lib/db/providers';
import { getSetting } from '@/lib/db/sessions';
import { providerSupportsCapability } from '@/lib/provider-config';
import { isPro } from '@/lib/edition';
import { canUseCustomProvider } from '@/lib/edition-runtime';
import { customProviderCapFor } from '@/lib/auth/custom-provider-capabilities';
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
  // 首选 admin 在云端标为默认的 chat provider —— 登录时 provisionChatProviders
  // 会把它写入 default_provider_id。
  const defaultId = (db.prepare("SELECT value FROM settings WHERE key = 'default_provider_id'")
    .get() as { value?: string } | undefined)?.value?.trim();
  if (defaultId) {
    const provider = getProvider(defaultId);
    if (provider && provider.provider_origin === 'system'
        && providerSupportsCapability(provider, 'agent-chat')) {
      return provider;
    }
  }
  // 其次任意一条 system-origin chat provider（含 legacy Lumos Cloud）。
  const row = db
    .prepare(
      "SELECT id FROM api_providers WHERE provider_origin = 'system' AND capabilities LIKE '%agent-chat%' ORDER BY sort_order ASC, created_at ASC LIMIT 1",
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

/**
 * Pro-edition lockdown: when admin has disabled customization for a category,
 * the user's preferred/default provider choices are ignored for that
 * capability. Chat has no admin-managed override, so it is force-routed to
 * the system Lumos Cloud provider. Media (image-gen) is admin-managed via
 * `provider_override:image`, so it falls through to the override chain with
 * the user's preferred id stripped.
 */
function isCustomProviderLocked(capability: ProviderCapability): boolean {
  if (!isPro()) return false;
  const cap = customProviderCapFor(capability);
  if (!cap) return false;
  return !canUseCustomProvider(cap);
}

export function resolveProviderForCapability(options: {
  moduleKey: ProviderModuleKey;
  capability: ProviderCapability;
  preferredProviderId?: string | null;
  allowDefault?: boolean;
}): ApiProvider | undefined {
  const locked = isCustomProviderLocked(options.capability);

  if (locked && options.capability === 'agent-chat') {
    const cloud = getLumosCloudSystemProvider();
    if (!cloud) {
      throw new ProviderResolutionError(
        '管理员已禁用自定义服务商，但未找到 Lumos Cloud 服务商，请重新登录',
      );
    }
    return ensureProviderSupportsCapability(cloud, options.capability, 'Lumos Cloud');
  }

  const preferredProviderId = locked ? '' : (options.preferredProviderId?.trim() || '');
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
