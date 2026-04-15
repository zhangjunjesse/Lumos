/**
 * Runtime-evaluated edition policies (server-side only).
 *
 * Split from edition.ts because these helpers read the settings table, which
 * is not available in client bundles. Pro/open edition itself remains a
 * compile-time constant — this file only adds admin-controlled toggles that
 * refresh at login.
 */

import { isOpen } from '@/lib/edition';
import { getSetting } from '@/lib/db/sessions';
import {
  CUSTOM_PROVIDER_CAPABILITIES,
  CUSTOM_PROVIDER_SETTING_KEYS,
  emptyCustomProviderFlags,
  type CustomProviderCapability,
  type CustomProviderFlags,
} from '@/lib/auth/custom-provider-capabilities';

/**
 * Pro edition: whether the admin allows users to configure and use custom
 * providers for a given category (e.g. chat, media). When false for a
 * category, the resolver force-routes that category to the built-in Lumos
 * Cloud / admin-managed provider and the UI hides the customization surface.
 *
 * Open edition: always true (users fully manage their own providers).
 *
 * The flags are refreshed on every login from lumos-web; default false.
 */
export function canUseCustomProvider(cap: CustomProviderCapability): boolean {
  if (isOpen()) return true;
  return getSetting(CUSTOM_PROVIDER_SETTING_KEYS[cap]) === '1';
}

export function getCustomProviderFlags(): CustomProviderFlags {
  const flags = emptyCustomProviderFlags();
  for (const cap of CUSTOM_PROVIDER_CAPABILITIES) {
    flags[cap] = canUseCustomProvider(cap);
  }
  return flags;
}
