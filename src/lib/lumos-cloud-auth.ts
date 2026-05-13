/**
 * Lumos Cloud provision helpers + per-capability custom-provider flags.
 *
 * Actual login runs in `src/lib/auth/user-service.ts` (talks to lumos-web
 * `/api/auth/login` and upserts into `lumos_users`). This file only re-exports
 * the provisioning primitives + the settings persistence for admin-controlled
 * custom provider toggles.
 */

import {
  CUSTOM_PROVIDER_CAPABILITIES,
  CUSTOM_PROVIDER_SETTING_KEYS,
  type CustomProviderFlags,
} from '@/lib/auth/custom-provider-capabilities';

export type {
  CloudImageProviderConfig,
  CloudImageProviderModel,
  CloudChatProviderConfig,
  CloudChatProviderModel,
  CloudSpeechProviderConfig,
  CloudUserInfo,
} from './cloud/types';
export {
  ensureDefaultProviderFallback,
  provisionCloudProvider,
  provisionImageProviders,
  provisionChatProviders,
  provisionSpeechProviders,
  getRemoteImageProviderId,
  getRemoteChatProviderId,
  getRemoteSpeechProviderId,
} from './cloud/provisioner';

/**
 * Persist the pro-version admin's per-capability "allow custom providers"
 * toggles as one settings row per capability ('1' / '0') so the resolver and
 * `/api/auth/me` read them consistently.
 */
export async function persistCustomProviderFlags(flags: Partial<CustomProviderFlags>): Promise<void> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const cap of CUSTOM_PROVIDER_CAPABILITIES) {
    stmt.run(CUSTOM_PROVIDER_SETTING_KEYS[cap], flags[cap] === true ? '1' : '0');
  }
}
