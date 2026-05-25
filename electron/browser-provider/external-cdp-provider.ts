import WebSocket from 'ws';
import {
  type BrowserAutomationSession,
  type BrowserContextRef,
  type BrowserNavigationOptions,
  type BrowserProvider,
  type BrowserTabSummary,
  normalizeBrowserContextId,
} from './types';

export const EXTERNAL_CDP_PROVIDER_ID = 'external-cdp';
export const DEFAULT_EXTERNAL_CDP_CONTEXT_ID = 'external-cdp:default';

export interface ExternalCdpEndpoint {
  httpBaseUrl: string;
  browserWebSocketUrl?: string;
}

export interface ExternalCdpProviderConfig {
  contextId?: string;
  endpoint: string;
  displayName?: string;
  profileId?: string;
}

interface DevToolsTarget {
  id: string;
  type?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpPendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface CdpEventWaiter {
  method: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function normalizeExternalCdpEndpoint(rawEndpoint?: string | null): ExternalCdpEndpoint | null {
  const value = typeof rawEndpoint === 'string' ? rawEndpoint.trim() : '';
  if (!value) {
    return null;
  }

  const parsed = new URL(value);
  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
    const httpProtocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    return {
      httpBaseUrl: `${httpProtocol}//${parsed.host}`,
      browserWebSocketUrl: parsed.toString(),
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported external CDP endpoint protocol: ${parsed.protocol}`);
  }

  const path = stripTrailingSlash(parsed.pathname || '');
  const basePath = path && path !== '/' && !path.startsWith('/json') ? path : '';
  return {
    httpBaseUrl: stripTrailingSlash(`${parsed.origin}${basePath}`),
  };
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function fetchDevToolsJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await readResponseText(response);
    throw new Error(`DevTools request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
  }
  return (await response.json()) as T;
}

async function fetchDevToolsText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await readResponseText(response);
    throw new Error(`DevTools request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ''}`);
  }
  return response.text();
}

class CdpConnection {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, CdpPendingRequest>();
  private readonly eventWaiters = new Set<CdpEventWaiter>();

  constructor(private readonly webSocketUrl: string) {}

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.webSocketUrl);
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.off('open', onOpen);
        if (error) {
          socket.off('error', onError);
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const onOpen = () => finish();
      const onError = (error: Error) => finish(error);

      socket.on('open', onOpen);
      socket.on('error', onError);
      socket.on('message', (data) => this.handleMessage(data));
      socket.on('close', () => this.handleClose());
      this.socket = socket;
    });
  }

  isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  async send(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    await this.connect();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('CDP websocket is not open');
    }

    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params: params || {} });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timeout,
      });
      this.socket!.send(message, (error) => {
        if (!error) {
          return;
        }
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  async waitForEvent(method: string, timeoutMs: number): Promise<void> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const waiter: CdpEventWaiter = {
        method,
        resolve: () => {
          clearTimeout(waiter.timeout);
          this.eventWaiters.delete(waiter);
          resolve();
        },
        reject: (error) => {
          clearTimeout(waiter.timeout);
          this.eventWaiters.delete(waiter);
          reject(error);
        },
        timeout: setTimeout(() => {
          this.eventWaiters.delete(waiter);
          reject(new Error(`Timed out waiting for CDP event: ${method}`));
        }, timeoutMs),
      };
      this.eventWaiters.add(waiter);
    });
  }

  close(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      this.socket.close();
    }
    this.handleClose();
  }

  private handleMessage(data: WebSocket.RawData): void {
    let payload: { id?: number; method?: string; result?: unknown; error?: { message?: string } };
    try {
      payload = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (typeof payload.id === 'number') {
      const pending = this.pending.get(payload.id);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pending.delete(payload.id);
      if (payload.error) {
        pending.reject(new Error(payload.error.message || 'CDP command failed'));
      } else {
        pending.resolve(payload.result);
      }
      return;
    }

    if (payload.method) {
      for (const waiter of Array.from(this.eventWaiters)) {
        if (waiter.method === payload.method) {
          waiter.resolve();
        }
      }
    }
  }

  private handleClose(): void {
    const error = new Error('CDP websocket closed');
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
    for (const waiter of Array.from(this.eventWaiters)) {
      waiter.reject(error);
    }
    this.socket = null;
  }
}

export class ExternalCdpAutomationSession implements BrowserAutomationSession {
  readonly contextId: string;

  private readonly endpoint: ExternalCdpEndpoint;
  private readonly tabs = new Map<string, BrowserTabSummary & { webSocketDebuggerUrl?: string }>();
  private readonly connections = new Map<string, CdpConnection>();
  private activeTabId: string | null = null;

  constructor(endpoint: ExternalCdpEndpoint, contextId = DEFAULT_EXTERNAL_CDP_CONTEXT_ID) {
    this.endpoint = endpoint;
    this.contextId = contextId;
  }

  async refreshTabs(): Promise<void> {
    const targets = await fetchDevToolsJson<DevToolsTarget[]>(`${this.endpoint.httpBaseUrl}/json/list`);
    const nextTabs = new Map<string, BrowserTabSummary & { webSocketDebuggerUrl?: string }>();

    for (const target of targets) {
      if (!target?.id || (target.type && target.type !== 'page')) {
        continue;
      }
      nextTabs.set(target.id, {
        id: target.id,
        url: target.url || 'about:blank',
        title: target.title || target.url || 'Untitled',
        isLoading: false,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      });
    }

    this.tabs.clear();
    for (const [id, tab] of nextTabs) {
      this.tabs.set(id, tab);
    }

    if (this.activeTabId && !this.tabs.has(this.activeTabId)) {
      this.activeTabId = null;
    }
    if (!this.activeTabId) {
      this.activeTabId = this.tabs.keys().next().value ?? null;
    }
  }

  getTabs(): BrowserTabSummary[] {
    return Array.from(this.tabs.values()).map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      isLoading: tab.isLoading,
      isIncognito: tab.isIncognito,
      isBackground: tab.isBackground,
    }));
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  async createTab(url = 'about:blank', options?: { background?: boolean }): Promise<string> {
    const targetUrl = url || 'about:blank';
    const encodedUrl = encodeURIComponent(targetUrl);
    const endpoint = `${this.endpoint.httpBaseUrl}/json/new?${encodedUrl}`;
    let target: DevToolsTarget;

    try {
      target = await fetchDevToolsJson<DevToolsTarget>(endpoint, { method: 'PUT' });
    } catch (error) {
      target = await fetchDevToolsJson<DevToolsTarget>(endpoint, { method: 'GET' }).catch(() => {
        throw error;
      });
    }

    if (!target?.id) {
      throw new Error('External CDP did not return a target id');
    }

    this.upsertTarget(target);
    if (!options?.background) {
      this.activeTabId = target.id;
    }
    await this.refreshTabs().catch(() => {});
    return target.id;
  }

  async switchTab(tabId: string): Promise<void> {
    await this.ensureTarget(tabId);
    await fetchDevToolsText(`${this.endpoint.httpBaseUrl}/json/activate/${encodePathSegment(tabId)}`);
    this.activeTabId = tabId;
  }

  async closeTab(tabId: string): Promise<void> {
    await this.ensureTarget(tabId);
    this.connections.get(tabId)?.close();
    this.connections.delete(tabId);
    await fetchDevToolsText(`${this.endpoint.httpBaseUrl}/json/close/${encodePathSegment(tabId)}`);
    this.tabs.delete(tabId);
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs.keys().next().value ?? null;
    }
  }

  async navigate(tabId: string, options: BrowserNavigationOptions): Promise<void> {
    await this.ensureTarget(tabId);
    const timeout = options.timeout || 30_000;
    const waitUntil = options.waitUntil || 'load';
    const eventName = waitUntil === 'domcontentloaded' ? 'Page.domContentEventFired' : 'Page.loadEventFired';

    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.isLoading = true;
      tab.url = options.url;
    }

    const connection = await this.getConnection(tabId);
    await connection.send('Page.enable');
    const waitForEvent = connection.waitForEvent(eventName, timeout);
    waitForEvent.catch(() => undefined);
    const result = await connection.send('Page.navigate', { url: options.url }, timeout) as { errorText?: string } | undefined;
    if (result?.errorText) {
      throw new Error(`Navigation failed: ${result.errorText}`);
    }

    try {
      await waitForEvent;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Timed out waiting for CDP event:')) {
        throw new Error(`Navigation timeout after ${timeout}ms`);
      }
      throw error;
    } finally {
      const current = this.tabs.get(tabId);
      if (current) {
        current.isLoading = false;
      }
      await this.refreshTabs().catch(() => {});
    }
  }

  async connectCDP(tabId: string): Promise<void> {
    await this.getConnection(tabId);
  }

  isCDPConnected(tabId: string): boolean {
    return this.connections.get(tabId)?.isOpen() === true;
  }

  async sendCDPCommand(tabId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const connection = await this.getConnection(tabId);
    return connection.send(method, params);
  }

  markTabBackground(tabId: string, isBackground = true): void {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.isBackground = isBackground || undefined;
    }
  }

  async getCookies(filter?: Electron.CookiesGetFilter): Promise<Electron.Cookie[]> {
    const connection = await this.getCookieJarConnection();
    await connection.send('Network.enable').catch(() => undefined);
    const params: Record<string, unknown> = {};
    if (filter?.url) {
      params.urls = [filter.url];
    }
    const response = await connection.send('Network.getCookies', params) as
      | { cookies?: CdpCookie[] }
      | undefined;
    let cookies = response?.cookies ?? [];
    if (filter?.domain) {
      cookies = cookies.filter((c) => matchesCookieDomain(c.domain, filter.domain!));
    }
    if (filter?.name) {
      cookies = cookies.filter((c) => c.name === filter.name);
    }
    if (filter?.secure !== undefined) {
      cookies = cookies.filter((c) => c.secure === filter.secure);
    }
    if (filter?.session !== undefined) {
      cookies = cookies.filter((c) => isSessionCookie(c) === filter.session);
    }
    return cookies.map(cdpCookieToElectronCookie);
  }

  async setCookie(cookie: Electron.CookiesSetDetails): Promise<void> {
    const connection = await this.getCookieJarConnection();
    await connection.send('Network.enable').catch(() => undefined);
    const params: Record<string, unknown> = { name: cookie.name, value: cookie.value ?? '' };
    if (cookie.url) params.url = cookie.url;
    if (cookie.domain) params.domain = cookie.domain;
    if (cookie.path) params.path = cookie.path;
    if (cookie.secure !== undefined) params.secure = cookie.secure;
    if (cookie.httpOnly !== undefined) params.httpOnly = cookie.httpOnly;
    if (cookie.expirationDate !== undefined) params.expires = cookie.expirationDate;
    if (cookie.sameSite) {
      params.sameSite = cookie.sameSite === 'no_restriction'
        ? 'None' : cookie.sameSite === 'lax' ? 'Lax' : 'Strict';
    }
    const result = await connection.send('Network.setCookie', params) as
      | { success?: boolean }
      | undefined;
    if (result && result.success === false) {
      throw new Error(`CDP Network.setCookie returned success=false for ${cookie.name}`);
    }
  }

  private async getCookieJarConnection(): Promise<CdpConnection> {
    let tabId = this.activeTabId ?? this.tabs.keys().next().value ?? null;
    if (!tabId) {
      await this.refreshTabs().catch(() => undefined);
      tabId = this.activeTabId ?? this.tabs.keys().next().value ?? null;
    }
    if (!tabId) {
      tabId = await this.createTab('about:blank', { background: true });
    }
    return this.getConnection(tabId);
  }

  private async getConnection(tabId: string): Promise<CdpConnection> {
    const target = await this.ensureTarget(tabId);
    let connection = this.connections.get(tabId);
    if (!connection || !connection.isOpen()) {
      const webSocketUrl = target.webSocketDebuggerUrl || await this.resolveTargetWebSocketUrl(tabId);
      connection = new CdpConnection(webSocketUrl);
      await connection.connect();
      this.connections.set(tabId, connection);
    }
    return connection;
  }

  private async ensureTarget(tabId: string): Promise<BrowserTabSummary & { webSocketDebuggerUrl?: string }> {
    if (!this.tabs.has(tabId)) {
      await this.refreshTabs();
    }

    const target = this.tabs.get(tabId);
    if (!target) {
      throw new Error(`External CDP target ${tabId} not found`);
    }
    return target;
  }

  private async resolveTargetWebSocketUrl(tabId: string): Promise<string> {
    await this.refreshTabs();
    const refreshed = this.tabs.get(tabId);
    if (refreshed?.webSocketDebuggerUrl) {
      return refreshed.webSocketDebuggerUrl;
    }
    if (this.endpoint.browserWebSocketUrl) {
      throw new Error(`External CDP endpoint is a browser websocket; target ${tabId} has no page websocket URL`);
    }
    throw new Error(`External CDP target ${tabId} has no websocket URL`);
  }

  private upsertTarget(target: DevToolsTarget): void {
    this.tabs.set(target.id, {
      id: target.id,
      url: target.url || 'about:blank',
      title: target.title || target.url || 'Untitled',
      isLoading: false,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl,
    });
  }
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  size?: number;
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

function matchesCookieDomain(cookieDomain: string, filterDomain: string): boolean {
  const c = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  const f = filterDomain.startsWith('.') ? filterDomain.slice(1) : filterDomain;
  return c === f || c.endsWith(`.${f}`);
}

function isSessionCookie(cookie: CdpCookie): boolean {
  if (cookie.session !== undefined) return cookie.session;
  return typeof cookie.expires !== 'number' || cookie.expires <= 0;
}

function cdpCookieToElectronCookie(cookie: CdpCookie): Electron.Cookie {
  const result: Electron.Cookie = {
    name: cookie.name,
    value: cookie.value ?? '',
    domain: cookie.domain,
    hostOnly: !cookie.domain.startsWith('.'),
    path: cookie.path,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    session: isSessionCookie(cookie),
  };
  if (typeof cookie.expires === 'number' && cookie.expires > 0) {
    result.expirationDate = cookie.expires;
  }
  return result;
}

export class ExternalCdpProvider implements BrowserProvider {
  readonly id = EXTERNAL_CDP_PROVIDER_ID;
  readonly type = EXTERNAL_CDP_PROVIDER_ID;
  readonly displayName = '外部 CDP 浏览器';

  private readonly contexts = new Map<string, {
    endpoint: ExternalCdpEndpoint;
    displayName: string;
    profileId: string;
  }>();
  private readonly sessions = new Map<string, ExternalCdpAutomationSession>();

  constructor(endpoint?: string | null | ExternalCdpProviderConfig[]) {
    const configs = Array.isArray(endpoint)
      ? endpoint
      : endpoint
        ? [{ endpoint, contextId: DEFAULT_EXTERNAL_CDP_CONTEXT_ID, displayName: this.displayName, profileId: 'default' }]
        : [];

    for (const config of configs) {
      const normalizedEndpoint = normalizeExternalCdpEndpoint(config.endpoint);
      if (!normalizedEndpoint) {
        continue;
      }
      const contextId = normalizeBrowserContextId(config.contextId || DEFAULT_EXTERNAL_CDP_CONTEXT_ID);
      if (!contextId.startsWith(`${EXTERNAL_CDP_PROVIDER_ID}:`)) {
        continue;
      }
      this.contexts.set(contextId, {
        endpoint: normalizedEndpoint,
        displayName: config.displayName?.trim() || this.displayName,
        profileId: config.profileId?.trim() || contextId.split(':').slice(1).join(':') || 'default',
      });
    }
  }

  getDefaultContextId(): string {
    return this.contexts.keys().next().value ?? DEFAULT_EXTERNAL_CDP_CONTEXT_ID;
  }

  getContext(contextId: string): BrowserContextRef | null {
    const normalized = normalizeBrowserContextId(contextId);
    const context = this.contexts.get(normalized);
    if (!context) {
      return null;
    }
    return {
      id: normalized,
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
      session = new ExternalCdpAutomationSession(context.endpoint, normalized);
      this.sessions.set(normalized, session);
    }
    return session;
  }

  isReady(contextId = DEFAULT_EXTERNAL_CDP_CONTEXT_ID): boolean {
    return Boolean(this.getContext(contextId));
  }
}
