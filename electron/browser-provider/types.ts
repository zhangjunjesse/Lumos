export const DEFAULT_BROWSER_CONTEXT_ID = 'embedded:default';

export interface BrowserContextRef {
  id: string;
  providerId: string;
  profileId: string;
  displayName: string;
  providerType: 'embedded' | 'external-cdp' | 'adspower' | 'ziniao' | string;
}

export interface BrowserTabSummary {
  id: string;
  url: string;
  title: string;
  isLoading: boolean;
  isIncognito?: boolean;
  isBackground?: boolean;
}

export interface BrowserNavigationOptions {
  url: string;
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded';
}

export interface BrowserAiActivityEntry {
  id: string;
  action: string;
  status: 'running' | 'success' | 'error';
  details?: string;
  pageId?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface BrowserAutomationSession {
  readonly contextId?: string;
  refreshTabs?(): Promise<void>;
  getTabs(): BrowserTabSummary[];
  getActiveTabId(): string | null;
  createTab(url?: string, options?: { incognito?: boolean; background?: boolean }): Promise<string>;
  switchTab(tabId: string): Promise<void>;
  closeTab(tabId: string): Promise<void>;
  navigate(tabId: string, options: BrowserNavigationOptions): Promise<void>;
  connectCDP(tabId: string): Promise<void>;
  isCDPConnected(tabId: string): boolean;
  sendCDPCommand(tabId: string, method: string, params?: Record<string, unknown>): Promise<unknown>;
  ensureViewRenderable?(tabId: string): void;
  markTabBackground?(tabId: string, isBackground?: boolean): void;
  getSessionPartition?(): string;
  getCookies?(filter?: Electron.CookiesGetFilter): Promise<Electron.Cookie[]>;
  setCookie?(cookie: Electron.CookiesSetDetails): Promise<void>;
  emitAiActivity?(
    activity: Omit<BrowserAiActivityEntry, 'id' | 'startedAt'> & { status?: BrowserAiActivityEntry['status'] },
  ): BrowserAiActivityEntry;
  finishAiActivity?(
    activity: BrowserAiActivityEntry,
    status: BrowserAiActivityEntry['status'],
    details?: string,
  ): void;
}

export interface BrowserProvider {
  readonly id: string;
  readonly type: BrowserContextRef['providerType'];
  readonly displayName: string;
  getDefaultContextId(): string;
  getContext(contextId: string): BrowserContextRef | null;
  getSession(contextId: string): BrowserAutomationSession | null;
  isReady(contextId?: string): boolean;
}

export function normalizeBrowserContextId(value?: string | null): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || DEFAULT_BROWSER_CONTEXT_ID;
}
