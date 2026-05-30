// 列出可用于「AI 评论分析」的服务商。
//
// 关键：评论分析本质是「用对话模型做文本生成」，消耗的是 chat 类服务商，必须遵守后台锁定。
// 后台锁定自定义 chat 服务商时（pro 版 + pro_allow_custom_chat_provider=0），
// 只能用 provider_origin='system'（Lumos Cloud/admin 托管）的对话服务商——
// 这跟 Lumos 全局「AI 对话」的 agent-chat 锁定逻辑一致。
//
// 注意：不能用 text-gen 能力筛（text-gen 不在锁定映射表里，会绕过锁定）。
// 脱敏——只给 id/name/models，不含 api_key/base_url。

import { getAllProviders, getDefaultProvider } from '@/lib/db/providers';
import { getProviderModelOptions } from '@/lib/model-metadata';
import { providerSupportsCapability } from '@/lib/provider-config';
import { isPro } from '@/lib/edition';
import { canUseCustomProvider } from '@/lib/edition-runtime';
import type { ApiProvider } from '@/types';

export interface EtsyForgeProviderOption {
  id: string;
  name: string;
  isDefault: boolean;
  models: { value: string; label: string }[];
}

/** 后台是否锁定了自定义 chat 服务商（锁定时评论分析只能用 system origin）。 */
export function isChatProviderLocked(): boolean {
  return isPro() && !canUseCustomProvider('chat');
}

/** 该服务商能否用于评论分析。锁定时仅 system origin 的对话服务商；非锁定时任何文本生成服务商（排除本地登录授权）。 */
export function isUsableAnalysisProvider(provider: ApiProvider): boolean {
  if (provider.auth_mode === 'local_auth') return false;
  if (isChatProviderLocked()) {
    return provider.provider_origin === 'system' && providerSupportsCapability(provider, 'agent-chat');
  }
  return providerSupportsCapability(provider, 'text-gen');
}

export function listAnalysisProviderOptions(): EtsyForgeProviderOption[] {
  const defaultId = getDefaultProvider()?.id ?? null;
  return getAllProviders()
    .filter(isUsableAnalysisProvider)
    .map((p) => ({
      id: p.id,
      name: p.name,
      isDefault: p.id === defaultId,
      models: getProviderModelOptions(p).map((m) => ({ value: m.value, label: m.label })),
    }));
}
