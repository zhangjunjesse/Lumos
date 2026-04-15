/**
 * Single source of truth for the per-category "allow custom provider" flags.
 *
 * Adding a new custom-provider category (e.g. video, tts) only requires:
 *   1. Adding the key to CUSTOM_PROVIDER_CAPABILITIES
 *   2. Mapping any provider capability that should gate on it in
 *      CUSTOM_PROVIDER_CAP_FOR
 * All storage keys, label strings, resolver gating, and UI rendering pick it
 * up automatically.
 */

import type { ProviderCapability } from '@/types';

export const CUSTOM_PROVIDER_CAPABILITIES = ['chat', 'media'] as const;
export type CustomProviderCapability = typeof CUSTOM_PROVIDER_CAPABILITIES[number];

export type CustomProviderFlags = Record<CustomProviderCapability, boolean>;

export const CUSTOM_PROVIDER_SETTING_KEYS: Record<CustomProviderCapability, string> = {
  chat: 'pro_allow_custom_chat_provider',
  media: 'pro_allow_custom_media_provider',
};

export const CUSTOM_PROVIDER_LABELS: Record<CustomProviderCapability, string> = {
  chat: 'AI 对话',
  media: '其他 AI 服务',
};

/**
 * Which provider capability belongs to which custom-provider category.
 * A capability not listed here is not gated (e.g. internal tools).
 */
const CUSTOM_PROVIDER_CAP_FOR: Partial<Record<ProviderCapability, CustomProviderCapability>> = {
  'agent-chat': 'chat',
  'image-gen': 'media',
};

export function customProviderCapFor(capability: ProviderCapability): CustomProviderCapability | undefined {
  return CUSTOM_PROVIDER_CAP_FOR[capability];
}

export function emptyCustomProviderFlags(): CustomProviderFlags {
  return { chat: false, media: false };
}
