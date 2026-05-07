import type { ProviderAuthMode, ProviderModelCatalogSource } from '@/types';

export interface SavedConfig {
  id: string;
  name: string;
  provider_type: string;
  api_protocol: 'anthropic-messages' | 'openai-compatible';
  capabilities: string;
  auth_mode: ProviderAuthMode;
  provider_origin: string;
  base_url: string;
  api_key: string;
  model_catalog: string;
  model_catalog_source: ProviderModelCatalogSource;
  model_catalog_updated_at: string | null;
  is_active: number;
  default_model: string;
  created_at: string;
  updated_at: string;
}

export interface ClaudeLocalAuthStatus {
  available: boolean;
  authenticated: boolean;
  status: 'authenticated' | 'missing' | 'error';
  configDir: string | null;
  runtimeVersion?: string | null;
  authSource?: string | null;
  error?: string;
}

export type CapabilityFilter = 'agent-chat';

export function parseCapabilities(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function matchesCapabilityFilter(
  config: SavedConfig,
  filter?: CapabilityFilter,
): boolean {
  if (!filter) return true;
  const caps = parseCapabilities(config.capabilities);
  return caps.includes('agent-chat') || caps.length === 0;
}

export function isSystemProvider(config: SavedConfig): boolean {
  return config.provider_origin === 'system';
}

export function isLocalAuthAnthropic(config: SavedConfig): boolean {
  return config.provider_type === 'anthropic' && config.auth_mode === 'local_auth';
}

export function getBaseUrlHint(
  apiProtocol: SavedConfig['api_protocol'],
  authMode: ProviderAuthMode,
): string {
  if (authMode === 'local_auth') return '';
  if (apiProtocol === 'anthropic-messages') {
    return 'Anthropic 兼容地址可填写根路径或 /v1；不要手动加 /messages。像小米这类地址填 https://api.xiaomimimo.com/anthropic 即可。';
  }
  return 'OpenAI 兼容地址可填写根路径或 /v1；不要手动加 /chat/completions。';
}

export function getCapabilityPurposeLabel(caps: string[]): string {
  if (caps.includes('agent-chat')) return '对话';
  if (caps.includes('image-gen')) return '图片生成';
  if (caps.includes('text-gen')) return '文本';
  if (caps.includes('embedding')) return '嵌入';
  return '对话';
}

export function getModelCatalogSourceLabel(
  source: ProviderModelCatalogSource,
  usesDefault: boolean,
): string {
  if (usesDefault || source === 'default') return '内置默认模型';
  if (source === 'detected') return '自动探测模型';
  return '手动维护模型';
}
