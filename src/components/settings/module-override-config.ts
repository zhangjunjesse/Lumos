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
  | 'model_override:agent'
  | 'model_override:image'
  | 'model_override:speech';

export interface ModuleConfig {
  key:
    | 'provider_override:knowledge'
    | 'provider_override:agent'
    | 'provider_override:image'
    | 'provider_override:speech';
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
  {
    key: 'provider_override:agent',
    modelKey: 'model_override:agent',
    moduleKey: 'agent',
    label: '工作流',
    description: '工作流步骤未显式指定时使用的 AI 服务。覆盖右上角的对话服务商。',
    capability: 'agent-chat',
    emptyValueLabel: '使用默认',
    emptyHint: '未指定时，沿用上方「AI 对话」中当前选中的服务。',
    createTitle: '为工作流添加服务',
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

/**
 * Speech (ASR) module. Cloud-only — desktop never holds the api_key, all
 * transcription requests proxy through lumos-web. Used by MCP transcribe_audio
 * tool, microphone recordings, and IM voice messages from WeChat / Goofish.
 */
export const SPEECH_MODULE_CONFIG: ModuleConfig = {
  key: 'provider_override:speech',
  modelKey: 'model_override:speech',
  moduleKey: 'image', // reuse 'image' preset module slot — no preset prompt for speech
  label: '语音识别',
  description: '微信/闲鱼语音消息、AI 对话里的 transcribe_audio 工具，都走这个服务商。',
  capability: 'speech',
  emptyValueLabel: '未配置',
  emptyHint: '未配置时，语音消息将显示为「[语音消息·未配置语音服务商]」。',
  createTitle: '添加语音识别服务',
};

export const PLACEHOLDER_VALUE = '__default__';

export function getCapabilityBadgeLabel(capability: ProviderCapability): string {
  switch (capability) {
    case 'agent-chat': return '对话';
    case 'text-gen': return '文本';
    case 'image-gen': return '图片';
    case 'embedding': return '嵌入';
    case 'speech': return '语音';
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
