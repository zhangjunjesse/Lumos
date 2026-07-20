import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AdsPowerProvider, type AdsPowerProviderOptions } from './adspower-provider';
import { EmbeddedBrowserProvider } from './embedded-provider';
import { ExternalCdpProvider, type ExternalCdpProviderConfig } from './external-cdp-provider';
import { LocalChromeProvider } from './local-chrome-provider';
import type { LocalChromeProfileMode } from './local-chrome-launcher';
import {
  DEFAULT_BROWSER_CONTEXT_ID,
  type BrowserAutomationSession,
  type BrowserContextRef,
  type BrowserProvider,
  normalizeBrowserContextId,
} from './types';
import type { BrowserManager } from '../browser/browser-manager';

type BrowserProviderEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

interface RuntimeBrowserProviderConfig {
  id?: unknown;
  providerType?: unknown;
  displayName?: unknown;
  enabled?: unknown;
  apiBaseUrl?: unknown;
  apiKey?: unknown;
  cdpEndpoint?: unknown;
  profileId?: unknown;
  profileName?: unknown;
}

function readExternalCdpEndpointFromEnv(env: BrowserProviderEnv): string | undefined {
  return (
    env.LUMOS_EXTERNAL_CDP_ENDPOINT?.trim()
    || env.LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT?.trim()
    || undefined
  );
}

function readAdsPowerProfileIdFromEnv(env: BrowserProviderEnv): string | undefined {
  return (
    env.LUMOS_ADSPOWER_USER_ID?.trim()
    || env.LUMOS_ADSPOWER_PROFILE_ID?.trim()
    || undefined
  );
}

function getConfiguredDataDir(env: BrowserProviderEnv): string {
  return env.LUMOS_DATA_DIR || env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function getRuntimeBrowserProviderConfigPath(env: BrowserProviderEnv): string {
  return path.join(getConfiguredDataDir(env), 'runtime', 'browser-providers.json');
}

interface LocalChromeRuntimeConfig {
  enabled: boolean;
  profileMode: LocalChromeProfileMode;
  headless: boolean;
  chromePath?: string;
}

function getLocalChromeConfigPath(env: BrowserProviderEnv): string {
  return path.join(getConfiguredDataDir(env), 'runtime', 'local-chrome.json');
}

// 本地 Chrome 选项走独立轻量 runtime 文件(不进 DB):默认启用(实际可见性由「是否装了
// Chrome」决定)、默认用系统默认 profile、默认可见窗口。用户在设置里改后经此文件生效。
function readLocalChromeConfig(env: BrowserProviderEnv): LocalChromeRuntimeConfig {
  const defaults: LocalChromeRuntimeConfig = { enabled: true, profileMode: 'default', headless: false };
  try {
    const filePath = getLocalChromeConfigPath(env);
    if (!fs.existsSync(filePath)) {
      return defaults;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<LocalChromeRuntimeConfig>;
    return {
      enabled: parsed.enabled !== false,
      profileMode: parsed.profileMode === 'dedicated' ? 'dedicated' : 'default',
      headless: parsed.headless === true,
      chromePath: typeof parsed.chromePath === 'string' && parsed.chromePath.trim()
        ? parsed.chromePath.trim()
        : undefined,
    };
  } catch (error) {
    console.warn('[browser-provider] failed to read local-chrome config:', error);
    return defaults;
  }
}

function fileSignature(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

function readRuntimeBrowserProviderConfigs(env: BrowserProviderEnv): RuntimeBrowserProviderConfig[] {
  try {
    const filePath = getRuntimeBrowserProviderConfigPath(env);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { configs?: unknown };
    if (!Array.isArray(parsed.configs)) {
      return [];
    }
    return parsed.configs.filter((config): config is RuntimeBrowserProviderConfig =>
      Boolean(config && typeof config === 'object'),
    );
  } catch (error) {
    console.warn('[browser-provider] failed to read runtime configs:', error);
    return [];
  }
}

function getRuntimeConfigSignature(env: BrowserProviderEnv): string {
  const filePath = getRuntimeBrowserProviderConfigPath(env);
  let fileSig = 'missing';
  try {
    const stat = fs.statSync(filePath);
    fileSig = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    fileSig = 'missing';
  }
  return JSON.stringify({
    fileSig,
    localChromeSig: fileSignature(getLocalChromeConfigPath(env)),
    external: readExternalCdpEndpointFromEnv(env) || '',
    adsPowerProfileId: readAdsPowerProfileIdFromEnv(env) || '',
    adsPowerApiBaseUrl: env.LUMOS_ADSPOWER_API_BASE_URL || '',
    adsPowerApiKey: env.LUMOS_ADSPOWER_API_KEY || '',
    adsPowerProfileName: env.LUMOS_ADSPOWER_PROFILE_NAME || '',
  });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createConfiguredProviders(
  env: BrowserProviderEnv,
): { externalCdp: ExternalCdpProviderConfig[]; adsPower: AdsPowerProviderOptions[] } {
  const externalCdp: ExternalCdpProviderConfig[] = [];
  const adsPower: ConstructorParameters<typeof AdsPowerProvider>[0][] = [];

  const externalCdpEndpoint = readExternalCdpEndpointFromEnv(env);
  if (externalCdpEndpoint) {
    externalCdp.push({
      endpoint: externalCdpEndpoint,
      contextId: 'external-cdp:default',
      displayName: '外部 CDP 浏览器',
      profileId: 'default',
    });
  }

  const adsPowerProfileId = readAdsPowerProfileIdFromEnv(env);
  if (adsPowerProfileId) {
    adsPower.push({
      apiBaseUrl: env.LUMOS_ADSPOWER_API_BASE_URL,
      apiKey: env.LUMOS_ADSPOWER_API_KEY,
      profileId: adsPowerProfileId,
      profileName: env.LUMOS_ADSPOWER_PROFILE_NAME,
    });
  }

  for (const config of readRuntimeBrowserProviderConfigs(env)) {
    if (config.enabled === false) {
      continue;
    }
    const providerType = text(config.providerType);
    if (providerType === 'external-cdp') {
      const id = text(config.id);
      const endpoint = text(config.cdpEndpoint);
      if (id && endpoint) {
        externalCdp.push({
          endpoint,
          contextId: `external-cdp:${id}`,
          displayName: text(config.displayName) || '外部 CDP 浏览器',
          profileId: id,
        });
      }
    } else if (providerType === 'adspower') {
      const profileId = text(config.profileId);
      if (profileId) {
        adsPower.push({
          apiBaseUrl: text(config.apiBaseUrl),
          apiKey: text(config.apiKey),
          profileId,
          profileName: text(config.profileName) || text(config.displayName),
          displayName: text(config.displayName),
        });
      }
    }
  }

  return { externalCdp, adsPower };
}

export class BrowserProviderRegistry {
  private readonly providers = new Map<string, BrowserProvider>();

  private runtimeSignature = '';

  constructor(
    private readonly getEmbeddedManager?: () => BrowserManager | null,
    private readonly env: BrowserProviderEnv = process.env,
  ) {
    if (getEmbeddedManager) {
      this.reloadProviders(true);
    }
  }

  register(provider: BrowserProvider): void {
    this.providers.set(provider.id, provider);
  }

  getDefaultContextId(): string {
    return DEFAULT_BROWSER_CONTEXT_ID;
  }

  getContext(contextId?: string | null): BrowserContextRef | null {
    this.reloadProviders();
    const normalized = normalizeBrowserContextId(contextId);
    const provider = this.resolveProviderForContext(normalized);
    return provider?.getContext(normalized) ?? null;
  }

  getSession(contextId?: string | null): BrowserAutomationSession | null {
    this.reloadProviders();
    const normalized = normalizeBrowserContextId(contextId);
    const provider = this.resolveProviderForContext(normalized);
    return provider?.getSession(normalized) ?? null;
  }

  isReady(contextId?: string | null): boolean {
    this.reloadProviders();
    const normalized = normalizeBrowserContextId(contextId);
    const provider = this.resolveProviderForContext(normalized);
    return Boolean(provider?.isReady(normalized));
  }

  private resolveProviderForContext(contextId: string): BrowserProvider | null {
    const providerId = contextId.split(':', 1)[0] || 'embedded';
    return this.providers.get(providerId) ?? null;
  }

  private reloadProviders(force = false): void {
    if (!this.getEmbeddedManager) {
      return;
    }
    const signature = getRuntimeConfigSignature(this.env);
    if (!force && signature === this.runtimeSignature) {
      return;
    }

    this.providers.clear();
    this.register(new EmbeddedBrowserProvider(this.getEmbeddedManager));

    const configured = createConfiguredProviders(this.env);
    if (configured.externalCdp.length > 0) {
      try {
        this.register(new ExternalCdpProvider(configured.externalCdp));
      } catch (error) {
        console.warn('[browser-provider] invalid external CDP endpoint:', error);
      }
    }

    if (configured.adsPower.length > 0) {
      this.register(new AdsPowerProvider(configured.adsPower));
    }

    const localChrome = readLocalChromeConfig(this.env);
    if (localChrome.enabled) {
      this.register(
        new LocalChromeProvider({
          dataDir: getConfiguredDataDir(this.env),
          profileMode: localChrome.profileMode,
          headless: localChrome.headless,
          chromePath: localChrome.chromePath,
        }),
      );
    }
    this.runtimeSignature = signature;
  }
}

export function createBrowserProviderRegistry(
  getEmbeddedManager: () => BrowserManager | null,
  env: BrowserProviderEnv = process.env,
): BrowserProviderRegistry {
  return new BrowserProviderRegistry(getEmbeddedManager, env);
}
