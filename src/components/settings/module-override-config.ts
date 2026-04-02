import { parseProviderCapabilities } from '@/lib/provider-config';
import type { ApiProvider, ProviderCapability, ProviderPresetModule } from '@/types';

export interface ProviderModelItem {
  value: string;
  label: string;
}

export interface ProviderOption {
  id: string;
  name: string;
  capabilities: string;
  provider_type: string;
  auth_mode: ApiProvider['auth_mode'];
  model_catalog: string;
}

export type ModelOverrideKey =
  | 'model_override:knowledge'
  | 'model_override:workflow'
  | 'model_override:image';

export interface ModuleConfig {
  key: 'provider_override:knowledge' | 'provider_override:workflow' | 'provider_override:image';
  modelKey: ModelOverrideKey;
  moduleKey: ProviderPresetModule;
  label: string;
  description: string;
  capability: ProviderCapability;
  emptyValueLabel: string;
  emptyHint: string;
  createTitle: string;
}

export const MODULE_CONFIGS: ModuleConfig[] = [
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
  {
    key: 'provider_override:workflow',
    modelKey: 'model_override:workflow',
    moduleKey: 'workflow',
    label: '工作流规划',
    description: '规划任务拆解时使用的 AI 服务，不影响工作流的实际执行。',
    capability: 'text-gen',
    emptyValueLabel: '使用默认',
    emptyHint: '未指定时，使用上方「AI 对话」中的服务。支持文本生成能力的服务商均可用于规划。',
    createTitle: '为工作流规划添加服务',
  },
  {
    key: 'provider_override:image',
    modelKey: 'model_override:image',
    moduleKey: 'image',
    label: '图片生成',
    description: '生成图片时使用的 AI 服务。',
    capability: 'image-gen',
    emptyValueLabel: '未配置',
    emptyHint: '图片生成需要单独设置，未配置时此功能不可用。',
    createTitle: '添加图片生成服务',
  },
];

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
  try { return JSON.parse(catalog) as ProviderModelItem[]; } catch { return []; }
}
