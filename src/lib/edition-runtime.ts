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
import { PRO_ALLOW_CUSTOM_PROVIDERS_KEY } from '@/lib/lumos-cloud-auth';

/**
 * Pro edition: whether the admin allows users to configure and use custom
 * providers (their own API keys / endpoints). When false, only the built-in
 * Lumos Cloud provider is usable — previously configured custom providers
 * are ignored at resolve time.
 *
 * Open edition: always true (users fully manage their own providers).
 *
 * The flag is refreshed on every login from lumos-web; default false.
 */
export function canUseCustomProviders(): boolean {
  if (isOpen()) return true;
  return getSetting(PRO_ALLOW_CUSTOM_PROVIDERS_KEY) === '1';
}
