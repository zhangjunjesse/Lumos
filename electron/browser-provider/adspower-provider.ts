import {
  type BrowserAutomationSession,
  type BrowserContextRef,
  type BrowserNavigationOptions,
  type BrowserProvider,
  type BrowserTabSummary,
  normalizeBrowserContextId,
} from './types';
import {
  ExternalCdpAutomationSession,
  normalizeExternalCdpEndpoint,
} from './external-cdp-provider';

export const ADSPOWER_PROVIDER_ID = 'adspower';
export const DEFAULT_ADSPOWER_API_BASE_URL = 'http://127.0.0.1:50325';
const LEGACY_ADSPOWER_API_BASE_URL = 'http://local.adspower.net:50325';

export interface AdsPowerProviderOptions {
  apiBaseUrl?: string | null;
  apiKey?: string | null;
  profileId?: string | null;
  profileName?: string | null;
  displayName?: string | null;
}

interface NormalizedAdsPowerContext {
  contextId: string;
  apiBaseUrl: string;
  apiKey?: string;
  profileId: string;
  displayName: string;
}

interface AdsPowerApiResponse<T> {
  code?: number;
  msg?: string;
  data?: T;
}

interface AdsPowerBrowserData {
  status?: string;
  ws?: {
    puppeteer?: string;
    selenium?: string;
  };
  debug_port?: string | number;
}

function normalizeNonEmpty(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeApiBaseUrl(value?: string | null): string {
  const raw = normalizeNonEmpty(value) || DEFAULT_ADSPOWER_API_BASE_URL;
  if (raw.replace(/\/+$/, '') === LEGACY_ADSPOWER_API_BASE_URL) {
    return DEFAULT_ADSPOWER_API_BASE_URL;
  }
  return raw.replace(/\/+$/, '');
}

function buildAdsPowerUrl(apiBaseUrl: string, pathname: string, params: Record<string, string>): string {
  const url = new URL(pathname, apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function fetchAdsPowerJson<T>(url: string, apiKey?: string): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`AdsPower request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  let payload: AdsPowerApiResponse<T>;
  try {
    payload = JSON.parse(text) as AdsPowerApiResponse<T>;
  } catch {
    throw new Error(`AdsPower returned invalid JSON${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  if (payload.code !== 0) {
    throw new Error(`AdsPower request failed: ${payload.msg || `code ${payload.code}`}`);
  }
  if (!payload.data) {
    throw new Error('AdsPower response did not include data');
  }
  return payload.data;
}

class AdsPowerAutomationSession implements BrowserAutomationSession {
  readonly contextId: string;

  private readonly apiBaseUrl: string;
  private readonly apiKey?: string;
  private readonly profileId: string;
  private delegate: ExternalCdpAutomationSession | null = null;
  private startPromise: Promise<ExternalCdpAutomationSession> | null = null;

  constructor(options: { contextId: string; apiBaseUrl: string; profileId: string; apiKey?: string }) {
    this.contextId = options.contextId;
    this.apiBaseUrl = options.apiBaseUrl;
    this.profileId = options.profileId;
    this.apiKey = options.apiKey;
  }

  async refreshTabs(): Promise<void> {
    const session = await this.ensureDelegate();
    await session.refreshTabs();
  }

  getTabs(): BrowserTabSummary[] {
    return this.delegate?.getTabs() ?? [];
  }

  getActiveTabId(): string | null {
    return this.delegate?.getActiveTabId() ?? null;
  }

  async createTab(url?: string, options?: { incognito?: boolean; background?: boolean }): Promise<string> {
    return (await this.ensureDelegate()).createTab(url, options);
  }

  async switchTab(tabId: string): Promise<void> {
    await (await this.ensureDelegate()).switchTab(tabId);
  }

  async closeTab(tabId: string): Promise<void> {
    await (await this.ensureDelegate()).closeTab(tabId);
  }

  async navigate(tabId: string, options: BrowserNavigationOptions): Promise<void> {
    await (await this.ensureDelegate()).navigate(tabId, options);
  }

  async connectCDP(tabId: string): Promise<void> {
    await (await this.ensureDelegate()).connectCDP(tabId);
  }

  isCDPConnected(tabId: string): boolean {
    return this.delegate?.isCDPConnected(tabId) ?? false;
  }

  async sendCDPCommand(tabId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    return (await this.ensureDelegate()).sendCDPCommand(tabId, method, params);
  }

  markTabBackground(tabId: string, isBackground = true): void {
    this.delegate?.markTabBackground(tabId, isBackground);
  }

  private async ensureDelegate(): Promise<ExternalCdpAutomationSession> {
    if (this.delegate) {
      return this.delegate;
    }
    if (!this.startPromise) {
      this.startPromise = this.startBrowser().finally(() => {
        this.startPromise = null;
      });
    }
    this.delegate = await this.startPromise;
    return this.delegate;
  }

  private async startBrowser(): Promise<ExternalCdpAutomationSession> {
    const active = await fetchAdsPowerJson<AdsPowerBrowserData>(
      buildAdsPowerUrl(this.apiBaseUrl, '/api/v1/browser/active', { user_id: this.profileId }),
      this.apiKey,
    ).catch(() => null);
    const activeEndpoint = normalizeNonEmpty(active?.ws?.puppeteer);
    if (active?.status?.toLowerCase() === 'active' && activeEndpoint) {
      return this.createExternalSession(activeEndpoint);
    }

    const data = await fetchAdsPowerJson<AdsPowerBrowserData>(
      buildAdsPowerUrl(this.apiBaseUrl, '/api/v1/browser/start', { user_id: this.profileId }),
      this.apiKey,
    );
    const puppeteerEndpoint = normalizeNonEmpty(data.ws?.puppeteer);
    if (!puppeteerEndpoint) {
      throw new Error('AdsPower did not return data.ws.puppeteer');
    }

    return this.createExternalSession(puppeteerEndpoint);
  }

  private createExternalSession(puppeteerEndpoint: string): ExternalCdpAutomationSession {
    const endpoint = normalizeExternalCdpEndpoint(puppeteerEndpoint);
    if (!endpoint) {
      throw new Error('AdsPower returned an empty CDP endpoint');
    }
    return new ExternalCdpAutomationSession(endpoint, this.contextId);
  }
}

export class AdsPowerProvider implements BrowserProvider {
  readonly id = ADSPOWER_PROVIDER_ID;
  readonly type = ADSPOWER_PROVIDER_ID;
  readonly displayName = 'AdsPower';

  private readonly contexts = new Map<string, NormalizedAdsPowerContext>();
  private readonly sessions = new Map<string, AdsPowerAutomationSession>();

  constructor(options: AdsPowerProviderOptions | AdsPowerProviderOptions[] = {}) {
    const configs = Array.isArray(options) ? options : [options];
    for (const config of configs) {
      const profileId = normalizeNonEmpty(config.profileId);
      if (!profileId) {
        continue;
      }
      const contextId = `${ADSPOWER_PROVIDER_ID}:${profileId}`;
      this.contexts.set(contextId, {
        contextId,
        apiBaseUrl: normalizeApiBaseUrl(config.apiBaseUrl),
        apiKey: normalizeNonEmpty(config.apiKey) || undefined,
        profileId,
        displayName: normalizeNonEmpty(config.displayName)
          || normalizeNonEmpty(config.profileName)
          || `AdsPower ${profileId}`,
      });
    }
  }

  getDefaultContextId(): string {
    return this.contexts.keys().next().value ?? '';
  }

  getContext(contextId: string): BrowserContextRef | null {
    const normalized = normalizeBrowserContextId(contextId);
    const context = this.contexts.get(normalized);
    if (!context) {
      return null;
    }
    return {
      id: context.contextId,
      providerId: this.id,
      profileId: context.profileId,
      displayName: context.displayName,
      providerType: this.type,
    };
  }

  getSession(contextId: string): BrowserAutomationSession | null {
    const normalized = normalizeBrowserContextId(contextId);
    const context = this.contexts.get(normalized);
    if (!context) {
      return null;
    }
    let session = this.sessions.get(normalized);
    if (!session) {
      session = new AdsPowerAutomationSession({
        contextId: context.contextId,
        apiBaseUrl: context.apiBaseUrl,
        profileId: context.profileId,
        apiKey: context.apiKey,
      });
      this.sessions.set(normalized, session);
    }
    return session;
  }

  isReady(contextId = this.getDefaultContextId()): boolean {
    return Boolean(this.getContext(contextId));
  }
}
