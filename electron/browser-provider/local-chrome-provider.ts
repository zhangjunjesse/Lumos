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
import {
  detectChromePath,
  launchLocalChrome,
  type LocalChromeProfileMode,
} from './local-chrome-launcher';

export const LOCAL_CHROME_PROVIDER_ID = 'local-chrome';
export const LOCAL_CHROME_DEFAULT_CONTEXT_ID = 'local-chrome:default';

export interface LocalChromeProviderOptions {
  dataDir: string;
  profileMode?: LocalChromeProfileMode;
  headless?: boolean;
  chromePath?: string;
  displayName?: string;
}

// 用户本地 Chrome:spawn 真实 Chrome(带调试端口)后,完全复用 ExternalCdpAutomationSession
// 驱动。与 AdsPower provider 同构,区别只在「启动」——这里直接拉起本地 Chrome 而非调 AdsPower API。
class LocalChromeAutomationSession implements BrowserAutomationSession {
  readonly contextId: string;

  private delegate: ExternalCdpAutomationSession | null = null;
  private startPromise: Promise<ExternalCdpAutomationSession> | null = null;

  constructor(private readonly options: Required<Omit<LocalChromeProviderOptions, 'displayName' | 'chromePath'>> & { chromePath?: string; contextId: string }) {
    this.contextId = options.contextId;
  }

  async refreshTabs(): Promise<void> {
    await (await this.ensureDelegate()).refreshTabs();
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

  async getCookies(filter?: Electron.CookiesGetFilter): Promise<Electron.Cookie[]> {
    return (await this.ensureDelegate()).getCookies(filter);
  }

  async setCookie(cookie: Electron.CookiesSetDetails): Promise<void> {
    return (await this.ensureDelegate()).setCookie(cookie);
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
    const { endpoint } = await launchLocalChrome({
      dataDir: this.options.dataDir,
      profileMode: this.options.profileMode,
      headless: this.options.headless,
      chromePath: this.options.chromePath,
    });
    const normalized = normalizeExternalCdpEndpoint(endpoint);
    if (!normalized) {
      throw new Error('本地 Chrome 返回了无效的 CDP 端点');
    }
    return new ExternalCdpAutomationSession(normalized, this.contextId);
  }
}

export class LocalChromeProvider implements BrowserProvider {
  readonly id = LOCAL_CHROME_PROVIDER_ID;
  readonly type = LOCAL_CHROME_PROVIDER_ID;
  readonly displayName = '本地 Chrome';

  private readonly contextId = LOCAL_CHROME_DEFAULT_CONTEXT_ID;
  private readonly displayNameForContext: string;
  private session: LocalChromeAutomationSession | null = null;

  constructor(private readonly options: LocalChromeProviderOptions) {
    this.displayNameForContext = options.displayName?.trim() || '本地 Chrome';
  }

  getDefaultContextId(): string {
    return this.contextId;
  }

  getContext(contextId: string): BrowserContextRef | null {
    if (normalizeBrowserContextId(contextId) !== this.contextId) {
      return null;
    }
    return {
      id: this.contextId,
      providerId: this.id,
      profileId: this.options.profileMode ?? 'default',
      displayName: this.displayNameForContext,
      providerType: this.type,
    };
  }

  getSession(contextId: string): BrowserAutomationSession | null {
    if (normalizeBrowserContextId(contextId) !== this.contextId) {
      return null;
    }
    if (!this.session) {
      this.session = new LocalChromeAutomationSession({
        contextId: this.contextId,
        dataDir: this.options.dataDir,
        profileMode: this.options.profileMode ?? 'default',
        headless: this.options.headless ?? false,
        chromePath: this.options.chromePath,
      });
    }
    return this.session;
  }

  // 只有系统装了 Chrome 才算就绪——决定它在浏览器选择器里出不出现。
  isReady(contextId = this.contextId): boolean {
    if (normalizeBrowserContextId(contextId) !== this.contextId) {
      return false;
    }
    return Boolean(detectChromePath(this.options.chromePath));
  }
}
