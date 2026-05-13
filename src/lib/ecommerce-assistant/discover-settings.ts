import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { EMBEDDED_BROWSER_CONTEXT_ID, normalizeBrowserContextId } from '@/lib/browser-provider/labels';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Per-app settings stored in `app_settings` collection (one row per key).
 */

export interface BrowserFetchSettings {
  enabled: boolean;
  /**
   * Lumos browser context id, e.g. `embedded:default`, `adspower:<profile_id>`,
   * or `external-cdp:<config_id>`. Provider credentials stay in Settings >
   * Browser, not in the ecommerce app.
   */
  browserContextId: string;
}

const KEY_BROWSER_FETCH = 'ecommerce.discover.browser_fetch';
const KEY_LEGACY_ADS_POWER = 'ecommerce.discover.ads_power';

const DEFAULT_BROWSER_FETCH: BrowserFetchSettings = {
  enabled: true,
  browserContextId: EMBEDDED_BROWSER_CONTEXT_ID,
};

interface RuntimeBrowserProviderConfig {
  id?: string;
  providerType?: string;
  enabled?: boolean;
  profileId?: string;
}

interface AppSettingsRow extends Record<string, unknown> {
  id?: string;
  key?: string;
  value?: string;
  updated_at?: string;
}

interface LegacyAdsPowerSettings {
  enabled?: boolean;
  profileId?: string;
}

function readSettingsRow(store: AppDataStore, key: string): AppSettingsRow | undefined {
  return store
    .query<AppSettingsRow>('app_settings', { filter: { key }, limit: 1 })
    .at(0);
}

function normalizeSettings(input: Partial<BrowserFetchSettings>): BrowserFetchSettings {
  return {
    enabled: input.enabled !== false,
    browserContextId: normalizeBrowserContextId(input.browserContextId),
  };
}

function getConfiguredDataDir(): string {
  return process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function readRuntimePreferredBrowserContextId(): string | null {
  // Unit tests should not accidentally read the developer's real ~/.lumos
  // browser provider file. Tests that intentionally set LUMOS_DATA_DIR still
  // exercise this path.
  if (process.env.JEST_WORKER_ID && !process.env.LUMOS_DATA_DIR && !process.env.CLAUDE_GUI_DATA_DIR) {
    return null;
  }
  try {
    const file = path.join(getConfiguredDataDir(), 'runtime', 'browser-providers.json');
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { configs?: RuntimeBrowserProviderConfig[] };
    const config = parsed.configs?.find((item) => item.enabled !== false && item.providerType === 'adspower' && item.profileId?.trim())
      ?? parsed.configs?.find((item) => item.enabled !== false && item.providerType === 'external-cdp' && item.id?.trim());
    if (!config) return null;
    if (config.providerType === 'adspower' && config.profileId?.trim()) {
      return `adspower:${config.profileId.trim()}`;
    }
    if (config.providerType === 'external-cdp' && config.id?.trim()) {
      return `external-cdp:${config.id.trim()}`;
    }
    return null;
  } catch {
    return null;
  }
}

function defaultBrowserFetchSettings(): BrowserFetchSettings {
  return {
    ...DEFAULT_BROWSER_FETCH,
    browserContextId: readRuntimePreferredBrowserContextId() ?? DEFAULT_BROWSER_FETCH.browserContextId,
  };
}

function readLegacyAdsPowerSettings(store: AppDataStore): BrowserFetchSettings | null {
  try {
    const legacy = readSettingsRow(store, KEY_LEGACY_ADS_POWER);
    if (!legacy?.value) return null;
    const parsed = JSON.parse(legacy.value) as LegacyAdsPowerSettings;
    const profileId = typeof parsed.profileId === 'string' ? parsed.profileId.trim() : '';
    if (!profileId) return null;
    return normalizeSettings({
      enabled: parsed.enabled === true,
      browserContextId: `adspower:${profileId}`,
    });
  } catch {
    return null;
  }
}

export function getBrowserFetchSettings(store: AppDataStore): BrowserFetchSettings {
  try {
    const row = readSettingsRow(store, KEY_BROWSER_FETCH);
    if (!row?.value) {
      return readLegacyAdsPowerSettings(store) ?? defaultBrowserFetchSettings();
    }
    const parsed = JSON.parse(row.value) as Partial<BrowserFetchSettings>;
    return normalizeSettings({ ...DEFAULT_BROWSER_FETCH, ...parsed });
  } catch {
    return defaultBrowserFetchSettings();
  }
}

export function setBrowserFetchSettings(
  store: AppDataStore,
  patch: Partial<BrowserFetchSettings>,
): BrowserFetchSettings {
  const current = getBrowserFetchSettings(store);
  const next = normalizeSettings({ ...current, ...patch });

  const existing = readSettingsRow(store, KEY_BROWSER_FETCH);
  const value = JSON.stringify(next);
  const updated_at = new Date().toISOString();
  if (existing) {
    store.update<AppSettingsRow>('app_settings', existing.id!, { value, updated_at });
  } else {
    store.create<AppSettingsRow>('app_settings', { key: KEY_BROWSER_FETCH, value, updated_at });
  }
  return next;
}
