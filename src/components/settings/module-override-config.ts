import { parseProviderCapabilities } from '@/lib/provider-config';
import { parseProviderModelCatalog } from '@/lib/model-metadata';
import type { ApiProvider, ProviderCapability, ProviderModelOption, ProviderPresetModule } from '@/types';

/**
 * Catalog entry surfaced to the settings UIs. Same shape as the canonical
 * ProviderModelOption so price fields (input_price_per_mtok / output_price_per_mtok)
 * propagate through to the cards / dropdowns when the cloud has provisioned them.
 */
export type ProviderModelItem = ProviderModelOption;

export interface ProviderOption {
  id: string;
  name: string;
  capabilities: string;
  provider_type: string;
  auth_mode: ApiProvider['auth_mode'];
  provider_origin: string;
  model_catalog: string;
}

export type ModelOverrideKey =
  | 'model_override:knowledge'
  | 'model_override:image';

export interface ModuleConfig {
  key: 'provider_override:knowledge' | 'provider_override:image';
  modelKey: ModelOverrideKey;
  moduleKey: ProviderPresetModule;
  label: string;
  description: string;
  capability: ProviderCapability;
  emptyValueLabel: string;
  emptyHint: string;
  createTitle: string;
}

/**
 * Text/chat-category module overrides. Gated by the `chat` custom-provider
 * flag in pro edition since they all consume text-gen capable providers.
 */
export const TEXT_MODULE_CONFIGS: ModuleConfig[] = [
  {
    key: 'provider_override:knowledge',
    modelKey: 'model_override:knowledge',
    moduleKey: 'knowledge',
    label: '知识库',
    description: '知识库搜索、摘要、改写时使用的 AI 服务。',
    capability: 'text-gen',
    emptyValueLabel: '使用默认',
    emptyHint: '未指定时，使用上方「AI 对话」中的服务。',
    createTitle: '为知识库添加服务',
  },
];

/**
 * Image generation module. Gated by the `media` custom-provider flag and
 * rendered in its own section because it needs dedicated provider management
 * (edit / delete).
 */
export const IMAGE_MODULE_CONFIG: ModuleConfig = {
  key: 'provider_override:image',
  modelKey: 'model_override:image',
  moduleKey: 'image',
  label: '图片生成',
  description: '生成图片时使用的 AI 服务。',
  capability: 'image-gen',
  emptyValueLabel: '未配置',
  emptyHint: '图片生成需要单独设置，未配置时此功能不可用。',
  createTitle: '添加图片生成服务',
};

export const PLACEHOLDER_VALUE = '__default__';

export function getCapabilityBadgeLabel(capability: ProviderCapability): string {
  switch (capability) {
    case 'agent-chat': return '对话';
    case 'text-gen': return '文本';
    case 'image-gen': return '图片';
    case 'embedding': return '嵌入';
    default: return capability;
  }
}

export function providerEligibleForModule(provider: ProviderOption, config: ModuleConfig): boolean {
  const caps = parseProviderCapabilities(provider.capabilities, provider.provider_type);
  const hasCapability = caps.includes(config.capability)
    || (config.capability === 'text-gen' && caps.includes('agent-chat'));

  if (!hasCapability) return false;
  if (config.key === 'provider_override:knowledge' && provider.auth_mode === 'local_auth') return false;
  return true;
}

export function parseModelCatalog(catalog: string): ProviderModelItem[] {
  // Delegate to the canonical parser so price fields (input_price_per_mtok /
  // output_price_per_mtok) survive — the previous JSON.parse cast was lossy
  // when callers consumed the result through the loose ProviderModelItem type.
  return parseProviderModelCatalog(catalog);
}
