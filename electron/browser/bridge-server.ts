import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { app, BrowserWindow, session } from 'electron';
import type { BrowserManager } from './browser-manager';
import {
  DEFAULT_BROWSER_CONTEXT_ID,
  normalizeBrowserContextId,
  type BrowserAutomationSession,
  type BrowserProviderRegistry,
} from '../browser-provider';
import { normalizeChromeLikeRequestHeaders } from './user-agent';

interface BridgeContext {
  browserManager: BrowserManager | null;
  browserProviderRegistry?: BrowserProviderRegistry | null;
}

interface PageRuntimeState {
  readyState: string;
  hasBody: boolean;
  textLength: number;
  title: string;
  url: string;
}

interface BrowserContextLease {
  contextId: string;
  ownerId: string;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
  lastPath: string;
}

const BROWSER_CONTEXT_LEASE_MS = 180_000;
const BROWSER_CONTEXT_LEASE_WAIT_MS = 10_000;
const BROWSER_CONTEXT_LEASE_POLL_MS = 250;

type BrowserContextLeaseAcquireResult =
  | { ok: true; lease: BrowserContextLease; waitedMs: number }
  | { ok: false; lease: BrowserContextLease; waitedMs: number; retryAfterMs: number };

export function calculateBrowserContextRetryAfterMs(input: {
  now: number;
  expiresAt: number;
  maxRetryAfterMs?: number;
}): number {
  const remainingMs = Math.max(0, input.expiresAt - input.now);
  return Math.min(remainingMs, Math.max(0, input.maxRetryAfterMs ?? BROWSER_CONTEXT_LEASE_WAIT_MS));
}

function normalizeNavigationUrl(raw: string | undefined | null): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    return '';
  }

  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value.replace(/\/+$/, '');
  }
}

export function didNavigationReachTarget(input: {
  targetUrl: string;
  state: PageRuntimeState | null;
  fallbackUrl?: string;
}): boolean {
  const targetUrl = normalizeNavigationUrl(input.targetUrl);
  if (!targetUrl) {
    return false;
  }

  const currentUrl = normalizeNavigationUrl(input.state?.url || input.fallbackUrl);
  if (!currentUrl || currentUrl !== targetUrl) {
    return false;
  }

  const hasReadableState = Boolean(
    input.state?.hasBody
    && (
      Boolean(input.state?.title?.trim())
      || (input.state?.textLength || 0) > 24
      || input.state?.readyState === 'interactive'
      || input.state?.readyState === 'complete'
    ),
  );

  return hasReadableState;
}

function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString('utf-8');
      if (data.length > 2 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function forwardUrlToContentTabs(url: string, pageId?: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('content-browser:open-url-in-tab', {
      url,
      ...(pageId ? { pageId } : {}),
    });
  }
}

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === 'string' && item.trim())?.trim();
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveRequestBrowserContextId(req: http.IncomingMessage, requestUrl: URL): string {
  return normalizeBrowserContextId(
    requestUrl.searchParams.get('browserContextId')
    || requestUrl.searchParams.get('contextId')
    || getHeaderValue(req.headers['x-lumos-browser-context-id']),
  );
}

function resolveRequestBrowserOwnerId(req: http.IncomingMessage, requestUrl: URL): string {
  return (
    requestUrl.searchParams.get('browserOwnerId')?.trim()
    || requestUrl.searchParams.get('ownerId')?.trim()
    || getHeaderValue(req.headers['x-lumos-browser-owner-id'])
    || getHeaderValue(req.headers['x-lumos-session-id'])
    || 'anonymous'
  );
}

function unauthorized(res: http.ServerResponse): void {
  sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
}

async function withAiActivity<T>(
  manager: BrowserAutomationSession,
  activity: { action: string; pageId?: string; details?: string; successDetails?: string },
  task: () => Promise<T>,
): Promise<T> {
  const entry = manager.emitAiActivity?.({
    action: activity.action,
    pageId: activity.pageId,
    details: activity.details,
  });

  try {
    const result = await task();
    if (entry) {
      manager.finishAiActivity?.(entry, 'success', activity.successDetails || activity.details);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (entry) {
      manager.finishAiActivity?.(entry, 'error', message);
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTabReady(manager: BrowserAutomationSession, tabId: string, options?: { background?: boolean }): Promise<void> {
  if (options?.background) {
    // Background mode: ensure the view has renderable bounds so the page
    // actually loads, but position it offscreen so the user doesn't see it.
    manager.ensureViewRenderable?.(tabId);
  } else {
    await manager.switchTab(tabId);
  }
  if (!manager.isCDPConnected(tabId)) {
    await manager.connectCDP(tabId);
  }
  await manager.sendCDPCommand(tabId, 'Runtime.enable');
  await manager.sendCDPCommand(tabId, 'DOM.enable');
  await manager.sendCDPCommand(tabId, 'Page.enable');
}

function buildPageRuntimeStateScript(): string {
  return `(() => {
    const root = document.documentElement;
    const body = document.body;
    const text = (body?.innerText || root?.innerText || '').replace(/\\s+/g, ' ').trim();
    return {
      readyState: document.readyState || 'loading',
      hasBody: Boolean(body || root),
      textLength: text.length,
      title: document.title || '',
      url: location.href || '',
    };
  })()`;
}

async function readPageRuntimeState(
  manager: BrowserAutomationSession,
  tabId: string,
): Promise<PageRuntimeState | null> {
  try {
    const result = (await evalInTab(manager, tabId, buildPageRuntimeStateScript(), true)) as
      | Partial<PageRuntimeState>
      | undefined;
    return {
      readyState: typeof result?.readyState === 'string' ? result.readyState : 'loading',
      hasBody: Boolean(result?.hasBody),
      textLength: typeof result?.textLength === 'number' ? result.textLength : 0,
      title: typeof result?.title === 'string' ? result.title : '',
      url: typeof result?.url === 'string' ? result.url : '',
    };
  } catch {
    return null;
  }
}

async function waitForPageStable(
  manager: BrowserAutomationSession,
  tabId: string,
  options?: { timeoutMs?: number; requireText?: boolean; stableMs?: number; background?: boolean },
): Promise<{ settled: boolean; state: PageRuntimeState | null }> {
  const timeoutMs = Math.max(500, Math.min(options?.timeoutMs || 12_000, 30_000));
  const stableMs = Math.max(150, Math.min(options?.stableMs || 500, 2_000));
  const requireText = options?.requireText === true;

  await ensureTabReady(manager, tabId, { background: options?.background });

  const startedAt = Date.now();
  let readySince = 0;
  let lastState: PageRuntimeState | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const metadata = manager.getTabs().find((tab) => tab.id === tabId);
    lastState = await readPageRuntimeState(manager, tabId);

    const docReady =
      lastState?.readyState === 'interactive'
      || lastState?.readyState === 'complete';
    const hasVisibleContent =
      !requireText
      || Boolean(lastState?.title)
      || (lastState?.textLength || 0) > 24;
    const ready = Boolean(!metadata?.isLoading && docReady && lastState?.hasBody && hasVisibleContent);

    if (ready) {
      if (!readySince) {
        readySince = Date.now();
      }
      if (Date.now() - readySince >= stableMs) {
        return { settled: true, state: lastState };
      }
    } else {
      readySince = 0;
    }

    await sleep(250);
  }

  return { settled: false, state: lastState };
}

async function evalInTab(
  manager: BrowserAutomationSession,
  tabId: string,
  expression: string,
  awaitPromise: boolean = true,
): Promise<unknown> {
  const result = await manager.sendCDPCommand(tabId, 'Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  return result?.result?.value;
}

function buildSnapshotScript(): string {
  return `(() => {
  const root = document.body || document.documentElement;
  if (!root) {
    return { url: location.href, title: document.title || '', lines: [] };
  }
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const normalize = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  document.querySelectorAll('[data-lumos-uid]').forEach((el) => {
    if (el instanceof Element) {
      el.removeAttribute('data-lumos-uid');
    }
  });
  const candidates = Array.from(
    document.querySelectorAll('a,button,input,textarea,select,[role="button"],[onclick],h1,h2,h3,h4,h5,h6,p,li,label,summary')
  );
  const lines = [];
  let uidIndex = 0;
  for (const el of candidates) {
    if (!(el instanceof Element)) continue;
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const text = normalize(
      el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      el.getAttribute('placeholder') ||
      el.textContent
    );
    const important = Boolean(text) || tag === 'input' || tag === 'textarea' || tag === 'select';
    if (!important) continue;
    const uid = 'e' + (++uidIndex);
    el.setAttribute('data-lumos-uid', uid);
    const attrs = [];
    const href = el.getAttribute('href');
    if (href) attrs.push('href=' + href);
    const type = el.getAttribute('type');
    if (type) attrs.push('type=' + type);
    const line = '[' + uid + '] <' + tag + '>' +
      (text ? ' ' + text.slice(0, 200) : '') +
      (attrs.length ? ' (' + attrs.join(', ') + ')' : '');
    lines.push(line);
    if (uidIndex >= 400) break;
  }
  return { url: location.href, title: document.title || '', lines };
})()`;
}

function clickByUidScript(uid: string): string {
  return `(() => {
    const el = document.querySelector('[data-lumos-uid="${uid}"]');
    if (!el) return { ok: false, error: 'UID_NOT_FOUND' };
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    if (el instanceof HTMLElement) {
      el.focus({ preventScroll: true });
    }
    if (typeof el.click === 'function') {
      el.click();
      return { ok: true };
    }
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
    el.dispatchEvent(ev);
    return { ok: true };
  })()`;
}

function fillByUidScript(uid: string, value: string): string {
  const escaped = JSON.stringify(value);
  return `(() => {
    const el = document.querySelector('[data-lumos-uid="${uid}"]');
    if (!el) return { ok: false, error: 'UID_NOT_FOUND' };
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      return { ok: false, error: 'ELEMENT_NOT_FILLABLE' };
    }
    el.focus();
    el.value = ${escaped};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`;
}

function pressKeyScript(key: string): string {
  const escaped = JSON.stringify(key);
  return `(() => {
    const target = document.activeElement || document.body || document.documentElement;
    if (!target) return { ok: false, error: 'NO_ACTIVE_ELEMENT' };
    const options = { key: ${escaped}, code: ${escaped}, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', options));
    target.dispatchEvent(new KeyboardEvent('keyup', options));
    return { ok: true };
  })()`;
}

function typeTextScript(text: string, submitKey?: string): string {
  const textEscaped = JSON.stringify(text);
  const submit = submitKey ? JSON.stringify(submitKey) : '""';
  return `(() => {
    const target = document.activeElement;
    if (!target) return { ok: false, error: 'NO_ACTIVE_ELEMENT' };
    const appendText = ${textEscaped};
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.value = (target.value || '') + appendText;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      target.textContent = (target.textContent || '') + appendText;
    }
    const submitKey = ${submit};
    if (submitKey) {
      const options = { key: submitKey, code: submitKey, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent('keydown', options));
      target.dispatchEvent(new KeyboardEvent('keyup', options));
    }
    return { ok: true };
  })()`;
}

export function waitForTextScript(texts: string[]): string {
  const escaped = JSON.stringify(texts);
  return `(() => {
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const hay = [
      document.title,
      document.body?.innerText,
      document.body?.textContent,
      document.documentElement?.innerText,
      document.documentElement?.textContent,
    ].map(normalize).filter(Boolean).join('\\n');
    const needles = ${escaped}.map((t) => normalize(t));
    const matched = needles.find((t) => t && hay.includes(t)) || '';
    return { found: Boolean(matched), text: matched };
  })()`;
}

async function resolveTargetTabId(
  manager: BrowserAutomationSession,
  requested?: string,
): Promise<string> {
  await manager.refreshTabs?.();
  const tabs = manager.getTabs();
  const hasTab = (tabId: string | undefined | null): tabId is string =>
    typeof tabId === 'string' && tabs.some((tab) => tab.id === tabId);

  if (hasTab(requested)) {
    return requested;
  }
  if (requested) {
    console.warn('[browser-bridge] requested pageId not found, falling back:', requested);
  }

  const active = manager.getActiveTabId();
  if (hasTab(active)) return active;
  if (tabs.length > 0) return tabs[0].id;
  const tabId = await manager.createTab('about:blank');
  await manager.switchTab(tabId);
  return tabId;
}

function normalizeDomain(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith('.' + d);
}

export class BrowserBridgeServer {
  private server: http.Server | null = null;
  private readonly token: string;
  private port = 0;
  private readonly context: BridgeContext;
  /** browserContextId:domain → pageId for persistent per-site hidden tabs used by /v1/site-pages/* */
  private readonly siteTabs = new Map<string, string>();
  private readonly contextLeases = new Map<string, BrowserContextLease>();

  constructor(context: BridgeContext) {
    this.context = context;
    this.token = crypto.randomBytes(24).toString('hex');
  }

  private getSession(contextId: string): BrowserAutomationSession | null {
    if (this.context.browserProviderRegistry) {
      return this.context.browserProviderRegistry.getSession(contextId);
    }
    if (normalizeBrowserContextId(contextId) !== DEFAULT_BROWSER_CONTEXT_ID) {
      return null;
    }
    return this.context.browserManager as BrowserAutomationSession | null;
  }

  private isReady(contextId: string): boolean {
    if (this.context.browserProviderRegistry) {
      return this.context.browserProviderRegistry.isReady(contextId);
    }
    return normalizeBrowserContextId(contextId) === DEFAULT_BROWSER_CONTEXT_ID
      && Boolean(this.context.browserManager);
  }

  private pruneExpiredLeases(now = Date.now()): void {
    for (const [contextId, lease] of this.contextLeases.entries()) {
      if (lease.expiresAt <= now) {
        this.contextLeases.delete(contextId);
      }
    }
  }

  private shouldRequireContextLease(method: string, pathname: string, contextId: string): boolean {
    if (normalizeBrowserContextId(contextId) === DEFAULT_BROWSER_CONTEXT_ID) {
      return false;
    }
    if (method !== 'POST') {
      return false;
    }
    if (pathname === '/v1/context/release') {
      return false;
    }
    return pathname.startsWith('/v1/pages/') || pathname.startsWith('/v1/site-pages/');
  }

  private acquireContextLease(
    contextId: string,
    ownerId: string,
    pathname: string,
  ): { ok: true; lease: BrowserContextLease } | { ok: false; lease: BrowserContextLease } {
    const normalized = normalizeBrowserContextId(contextId);
    const normalizedOwner = ownerId.trim() || 'anonymous';
    const now = Date.now();
    this.pruneExpiredLeases(now);

    const existing = this.contextLeases.get(normalized);
    if (existing && existing.ownerId !== normalizedOwner && existing.expiresAt > now) {
      return { ok: false, lease: existing };
    }

    const lease: BrowserContextLease = existing && existing.ownerId === normalizedOwner
      ? {
        ...existing,
        updatedAt: now,
        expiresAt: now + BROWSER_CONTEXT_LEASE_MS,
        lastPath: pathname,
      }
      : {
        contextId: normalized,
        ownerId: normalizedOwner,
        startedAt: now,
        updatedAt: now,
        expiresAt: now + BROWSER_CONTEXT_LEASE_MS,
        lastPath: pathname,
      };
    this.contextLeases.set(normalized, lease);
    return { ok: true, lease };
  }

  private async acquireContextLeaseWithWait(
    contextId: string,
    ownerId: string,
    pathname: string,
  ): Promise<BrowserContextLeaseAcquireResult> {
    const startedAt = Date.now();
    let leaseResult = this.acquireContextLease(contextId, ownerId, pathname);
    if (leaseResult.ok) {
      return { ...leaseResult, waitedMs: 0 };
    }

    const deadline = startedAt + BROWSER_CONTEXT_LEASE_WAIT_MS;
    while (Date.now() < deadline) {
      const now = Date.now();
      const remainingWaitMs = deadline - now;
      const remainingLeaseMs = Math.max(0, leaseResult.lease.expiresAt - now);
      await sleep(Math.max(1, Math.min(BROWSER_CONTEXT_LEASE_POLL_MS, remainingWaitMs, remainingLeaseMs || remainingWaitMs)));

      leaseResult = this.acquireContextLease(contextId, ownerId, pathname);
      if (leaseResult.ok) {
        return {
          ...leaseResult,
          waitedMs: Date.now() - startedAt,
        };
      }
    }

    const now = Date.now();
    return {
      ...leaseResult,
      waitedMs: now - startedAt,
      retryAfterMs: calculateBrowserContextRetryAfterMs({
        now,
        expiresAt: leaseResult.lease.expiresAt,
      }),
    };
  }

  private releaseContextLease(contextId: string, ownerId: string): boolean {
    const normalized = normalizeBrowserContextId(contextId);
    const existing = this.contextLeases.get(normalized);
    if (!existing) {
      return false;
    }
    if (existing.ownerId !== (ownerId.trim() || 'anonymous')) {
      return false;
    }
    return this.contextLeases.delete(normalized);
  }

  private forceReleaseContextLease(contextId: string): BrowserContextLease | null {
    const normalized = normalizeBrowserContextId(contextId);
    const existing = this.contextLeases.get(normalized) ?? null;
    if (existing) {
      this.contextLeases.delete(normalized);
    }
    return existing;
  }

  private getContextLeaseStatus(contextId: string): BrowserContextLease | null {
    const normalized = normalizeBrowserContextId(contextId);
    this.pruneExpiredLeases();
    return this.contextLeases.get(normalized) ?? null;
  }

  private forgetSiteTab(pageId: string): void {
    for (const [cacheKey, cachedPageId] of this.siteTabs.entries()) {
      if (cachedPageId === pageId) {
        this.siteTabs.delete(cacheKey);
      }
    }
  }

  private async ensureSiteTab(
    manager: BrowserAutomationSession,
    contextId: string,
    domain: string,
    initialUrl?: string,
  ): Promise<string> {
    const cacheKey = `${normalizeBrowserContextId(contextId)}:${domain}`;
    const landingUrl = initialUrl || `https://${domain.startsWith('www.') ? domain : 'www.' + domain}/`;
    await manager.refreshTabs?.();
    const tabs = manager.getTabs();

    const existing = this.siteTabs.get(cacheKey);
    if (existing && tabs.some((tab) => tab.id === existing)) {
      const currentUrl = tabs.find((tab) => tab.id === existing)?.url || '';
      let currentHost = '';
      try { currentHost = new URL(currentUrl).hostname; } catch { /* ignore */ }
      if (currentHost && hostnameMatchesDomain(currentHost, domain)) {
        manager.markTabBackground?.(existing, true);
        manager.ensureViewRenderable?.(existing);
        if (!manager.isCDPConnected(existing)) await manager.connectCDP(existing);
        return existing;
      }
      // Tab drifted — navigate it back to landing
      try {
        await manager.navigate(existing, { url: landingUrl, waitUntil: 'domcontentloaded' });
      } catch { /* fall through to waitForPageStable */ }
      manager.markTabBackground?.(existing, true);
      await waitForPageStable(manager, existing, { timeoutMs: 12_000, background: true });
      return existing;
    }

    // Create a fresh background tab for this domain.
    const pageId = await manager.createTab(landingUrl, { background: true });
    manager.ensureViewRenderable?.(pageId);
    try {
      await waitForPageStable(manager, pageId, { timeoutMs: 12_000, background: true });
    } catch { /* ignore — subsequent evaluate may still work */ }
    this.siteTabs.set(cacheKey, pageId);
    return pageId;
  }

  getToken(): string {
    return this.token;
  }

  getBaseUrl(): string {
    return this.port > 0 ? `http://127.0.0.1:${this.port}` : '';
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error('[browser-bridge] unhandled request error:', error);
        if (!res.headersSent) {
          sendJson(res, 500, {
            ok: false,
            error: 'INTERNAL_ERROR',
            message: getErrorMessage(error),
          });
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve browser bridge address'));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
    console.log('[browser-bridge] started on', this.getBaseUrl());
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const current = this.server;
    this.server = null;
    await new Promise<void>((resolve) => current.close(() => resolve()));
    this.port = 0;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method || 'GET';
    const rawUrl = req.url || '/';
    const requestUrl = new URL(rawUrl, 'http://127.0.0.1');
    const pathname = requestUrl.pathname;
    const browserContextId = resolveRequestBrowserContextId(req, requestUrl);
    const browserOwnerId = resolveRequestBrowserOwnerId(req, requestUrl);

    if (pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'browser-bridge',
        ready: this.isReady(browserContextId),
        browserContextId,
      });
      return;
    }

    const token = req.headers['x-lumos-bridge-token'];
    if (token !== this.token) {
      unauthorized(res);
      return;
    }

    if (method === 'POST' && pathname === '/v1/context/release') {
      const released = this.releaseContextLease(browserContextId, browserOwnerId);
      sendJson(res, 200, { ok: true, browserContextId, released });
      return;
    }

    if (method === 'POST' && pathname === '/v1/context/force-release') {
      const releasedLease = this.forceReleaseContextLease(browserContextId);
      sendJson(res, 200, {
        ok: true,
        browserContextId,
        released: Boolean(releasedLease),
        ...(releasedLease ? { previousOwnerId: releasedLease.ownerId } : {}),
      });
      return;
    }

    if (method === 'GET' && pathname === '/v1/context/status') {
      const lease = this.getContextLeaseStatus(browserContextId);
      sendJson(res, 200, {
        ok: true,
        browserContextId,
        occupied: Boolean(lease),
        ...(lease ? {
          ownerId: lease.ownerId,
          startedAt: new Date(lease.startedAt).toISOString(),
          updatedAt: new Date(lease.updatedAt).toISOString(),
          expiresAt: new Date(lease.expiresAt).toISOString(),
          lastPath: lease.lastPath,
        } : {}),
      });
      return;
    }

    const manager = this.getSession(browserContextId);
    if (!manager) {
      sendJson(res, 503, { ok: false, error: 'BROWSER_CONTEXT_UNAVAILABLE', browserContextId });
      return;
    }

    if (this.shouldRequireContextLease(method, pathname, browserContextId)) {
      const leaseResult = await this.acquireContextLeaseWithWait(browserContextId, browserOwnerId, pathname);
      if (!leaseResult.ok) {
        sendJson(res, 409, {
          ok: false,
          error: 'BROWSER_CONTEXT_IN_USE',
          message: leaseResult.waitedMs > 0
            ? `该浏览器正在被另一个会话使用，已等待 ${Math.ceil(leaseResult.waitedMs / 1000)} 秒后仍未释放，请稍后再试或切换到其他浏览器。`
            : '该浏览器正在被另一个会话使用，请稍后再试或切换到其他浏览器。',
          browserContextId,
          ownerId: leaseResult.lease.ownerId,
          updatedAt: new Date(leaseResult.lease.updatedAt).toISOString(),
          expiresAt: new Date(leaseResult.lease.expiresAt).toISOString(),
          lastPath: leaseResult.lease.lastPath,
          waitedMs: leaseResult.waitedMs,
          retryAfterMs: leaseResult.retryAfterMs,
        });
        return;
      }
    }

    if (method === 'GET' && pathname === '/v1/pages') {
      await manager.refreshTabs?.();
      const pages = manager.getTabs().map((tab) => ({
        pageId: tab.id,
        url: tab.url,
        title: tab.title,
        isActive: tab.id === manager.getActiveTabId(),
        isLoading: tab.isLoading,
        isIncognito: tab.isIncognito || false,
      }));
      sendJson(res, 200, { ok: true, browserContextId, pages, activePageId: manager.getActiveTabId() });
      return;
    }

    if (method === 'GET' && pathname === '/v1/pages/current') {
      await manager.refreshTabs?.();
      const activePageId = manager.getActiveTabId();
      const current = manager.getTabs().find((tab) => tab.id === activePageId) || null;
      sendJson(res, 200, {
        ok: true,
        browserContextId,
        activePageId,
        page: current ? {
          pageId: current.id,
          url: current.url,
          title: current.title,
          isActive: true,
          isLoading: current.isLoading,
        } : null,
      });
      return;
    }

    if (method === 'GET' && pathname === '/v1/cookies') {
      if (!manager.getCookies) {
        sendJson(res, 501, { ok: false, error: 'BROWSER_CONTEXT_COOKIES_UNSUPPORTED', browserContextId });
        return;
      }
      const domain = requestUrl.searchParams.get('domain')?.trim() || undefined;
      const url = requestUrl.searchParams.get('url')?.trim() || undefined;
      const name = requestUrl.searchParams.get('name')?.trim() || undefined;
      const includeValues = ['1', 'true', 'yes'].includes((requestUrl.searchParams.get('includeValues') || '').trim().toLowerCase());
      const cookies = await manager.getCookies({
        ...(domain ? { domain } : {}),
        ...(url ? { url } : {}),
        ...(name ? { name } : {}),
      });
      sendJson(res, 200, {
        ok: true,
        browserContextId,
        cookies: cookies.map((cookie) => ({
          name: cookie.name,
          ...(includeValues ? { value: cookie.value } : {}),
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          session: cookie.session,
          expirationDate: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : null,
        })),
      });
      return;
    }

    if (method === 'POST' && pathname === '/v1/cookies/import') {
      if (!manager.setCookie) {
        sendJson(res, 501, { ok: false, error: 'BROWSER_CONTEXT_COOKIES_UNSUPPORTED', browserContextId });
        return;
      }
      const body = (await parseJsonBody(req)) as {
        cookies?: Array<{
          url?: string;
          name?: string;
          value?: string;
          domain?: string;
          path?: string;
          secure?: boolean;
          httpOnly?: boolean;
          expirationDate?: number;
        }>;
      };
      const cookies = Array.isArray(body.cookies) ? body.cookies : [];
      if (cookies.length === 0) {
        sendJson(res, 400, { ok: false, error: 'MISSING_COOKIES', browserContextId });
        return;
      }

      let importedCount = 0;
      for (const cookie of cookies) {
        if (!cookie?.url || !cookie?.name || typeof cookie.value !== 'string') {
          continue;
        }

        await manager.setCookie({
          url: cookie.url,
          name: cookie.name,
          value: cookie.value,
          path: cookie.path || '/',
          secure: cookie.secure === true,
          httpOnly: cookie.httpOnly === true,
          ...(cookie.domain ? { domain: cookie.domain } : {}),
          ...(typeof cookie.expirationDate === 'number' ? { expirationDate: cookie.expirationDate } : {}),
        });
        importedCount += 1;
      }

      sendJson(res, 200, {
        ok: true,
        browserContextId,
        importedCount,
      });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/new') {
      const body = (await parseJsonBody(req)) as { url?: string; background?: boolean; incognito?: boolean };
      const pageId = await withAiActivity(
        manager,
        {
          action: body?.incognito ? 'AI opened an incognito tab' : 'AI opened a browser tab',
          details: body?.url || 'about:blank',
        },
        async () => {
          const createdPageId = await manager.createTab(body?.url, {
            incognito: body?.incognito,
            background: body?.background === true,
          });
          if (body?.background) {
            // Set offscreen bounds so Chromium renders the page content
            manager.ensureViewRenderable?.(createdPageId);
          }
          if (!body?.background) {
            await manager.switchTab(createdPageId);
          }
          if (typeof body?.url === 'string') {
            try {
              await waitForPageStable(manager, createdPageId, { timeoutMs: 8_000, background: body?.background });
            } catch (error) {
              console.warn('[browser-bridge] page stabilization failed after creating tab:', {
                pageId: createdPageId,
                url: body.url,
                error: getErrorMessage(error),
              });
            }

            // Only forward to UI when not in background mode (e.g. DeepSearch)
            if (!body?.background) {
              try {
                forwardUrlToContentTabs(body.url, createdPageId);
              } catch (error) {
                console.warn('[browser-bridge] failed to forward new tab URL to content tabs:', {
                  pageId: createdPageId,
                  url: body.url,
                  error: getErrorMessage(error),
                });
              }
            }
          }
          return createdPageId;
        },
      );
      sendJson(res, 200, { ok: true, browserContextId, pageId });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/select') {
      const body = (await parseJsonBody(req)) as { pageId?: string; background?: boolean };
      if (!body?.pageId) {
        sendJson(res, 400, { ok: false, error: 'MISSING_PAGE_ID', browserContextId });
        return;
      }
      const pageId = await resolveTargetTabId(manager, body.pageId);
      if (body.background) {
        // Background mode: only ensure CDP is connected, don't switch visible tab
        if (!manager.isCDPConnected(pageId)) {
          await manager.connectCDP(pageId);
        }
      } else {
        await withAiActivity(
          manager,
          {
            action: 'AI focused a browser tab',
            pageId,
            details: body.pageId,
          },
          async () => {
            await manager.switchTab(pageId);
          },
        );
        const selectedTab = manager.getTabs().find((tab) => tab.id === pageId);
        if (selectedTab?.url) {
          try {
            forwardUrlToContentTabs(selectedTab.url, pageId);
          } catch (error) {
            console.warn('[browser-bridge] failed to forward selected tab URL to content tabs:', {
              pageId,
              url: selectedTab.url,
              error: getErrorMessage(error),
            });
          }
        }
      }
      sendJson(res, 200, { ok: true, browserContextId, pageId });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/close') {
      const body = (await parseJsonBody(req)) as { pageId?: string };
      if (!body?.pageId) {
        sendJson(res, 400, { ok: false, error: 'MISSING_PAGE_ID', browserContextId });
        return;
      }
      const exists = manager.getTabs().some((tab) => tab.id === body.pageId);
      if (!exists) {
        this.forgetSiteTab(body.pageId);
        sendJson(res, 200, { ok: true, browserContextId, closed: false, pageId: body.pageId });
        return;
      }
      await withAiActivity(
        manager,
        {
          action: 'AI closed a browser tab',
          pageId: body.pageId,
          details: body.pageId,
        },
        async () => {
          await manager.closeTab(body.pageId!);
        },
      );
      this.forgetSiteTab(body.pageId);
      sendJson(res, 200, { ok: true, browserContextId, closed: true, pageId: body.pageId });
      return;
    }

    if (method === 'POST' && pathname === '/v1/site-pages/evaluate') {
      const body = (await parseJsonBody(req)) as {
        domain?: string;
        script?: string;
        initialUrl?: string;
        navigateTo?: string;
      };
      const domain = normalizeDomain(body?.domain || '');
      const script = typeof body?.script === 'string' ? body.script : '';
      if (!domain || !script) {
        sendJson(res, 400, { ok: false, error: 'MISSING_DOMAIN_OR_SCRIPT', browserContextId });
        return;
      }

      // Self-heal if the recorded pageId has disappeared.
      const cacheKey = `${browserContextId}:${domain}`;
      const stored = this.siteTabs.get(cacheKey);
      if (stored && !manager.getTabs().some((tab) => tab.id === stored)) {
        this.siteTabs.delete(cacheKey);
      }

      const pageId = await withAiActivity(
        manager,
        {
          action: 'AI prepared a persistent site tab',
          details: domain,
        },
        () => this.ensureSiteTab(manager, browserContextId, domain, body?.initialUrl),
      );

      try {
        if (typeof body?.navigateTo === 'string' && body.navigateTo) {
          let targetHost = '';
          try { targetHost = new URL(body.navigateTo).hostname; } catch { /* ignore */ }
          if (!targetHost || !hostnameMatchesDomain(targetHost, domain)) {
            sendJson(res, 400, { ok: false, error: 'NAVIGATE_TO_DOMAIN_MISMATCH', browserContextId });
            return;
          }
          const current = manager.getTabs().find((tab) => tab.id === pageId)?.url || '';
          if (normalizeNavigationUrl(current) !== normalizeNavigationUrl(body.navigateTo)) {
            try {
              await manager.navigate(pageId, { url: body.navigateTo, waitUntil: 'domcontentloaded' });
            } catch { /* fall through to waitForPageStable */ }
            await waitForPageStable(manager, pageId, { timeoutMs: 12_000, background: true });
          }
        }

        await ensureTabReady(manager, pageId, { background: true });
        const value = await evalInTab(manager, pageId, script, true);
        const currentUrl = manager.getTabs().find((tab) => tab.id === pageId)?.url || '';
        sendJson(res, 200, { ok: true, browserContextId, pageId, value, url: currentUrl });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: 'SITE_EVAL_FAILED', browserContextId, message: getErrorMessage(error) });
      }
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/navigate') {
      const body = (await parseJsonBody(req)) as {
        pageId?: string;
        type?: 'url' | 'back' | 'forward' | 'reload';
        url?: string;
        background?: boolean;
      };
      const pageId = await resolveTargetTabId(manager, body?.pageId);
      const navType = body?.type || 'url';
      const bg = body?.background === true;
      if (navType === 'url' && !body?.url) {
        sendJson(res, 400, { ok: false, error: 'MISSING_URL', browserContextId });
        return;
      }
      await withAiActivity(
        manager,
        {
          action: 'AI navigated the browser',
          pageId,
          details: navType === 'url' ? body.url : navType,
        },
        async () => {
          if (!bg) await manager.switchTab(pageId);

          if (navType === 'url') {
            try {
              await manager.navigate(pageId, {
                url: body.url!,
                waitUntil: 'domcontentloaded',
              });
            } catch (error) {
              const message = getErrorMessage(error);
              const isNavigationTimeout = error instanceof Error && /^Navigation timeout after \d+ms$/.test(error.message);
              if (!isNavigationTimeout) {
                throw error;
              }

              const fallbackSettle = await waitForPageStable(manager, pageId, {
                timeoutMs: 4_000,
                background: bg,
              });
              const fallbackUrl = manager.getTabs().find((tab) => tab.id === pageId)?.url;

              if (!didNavigationReachTarget({
                targetUrl: body.url!,
                state: fallbackSettle.state,
                fallbackUrl,
              })) {
                throw error;
              }

              console.warn('[browser-bridge] navigation timed out but target page is already reachable:', {
                pageId,
                targetUrl: body.url,
                currentUrl: fallbackSettle.state?.url || fallbackUrl || '',
                title: fallbackSettle.state?.title || '',
                reason: message,
              });
            }
            await waitForPageStable(manager, pageId, { timeoutMs: 12_000, background: bg });
            if (!bg) forwardUrlToContentTabs(body.url!, pageId);
            return;
          }

          await ensureTabReady(manager, pageId, { background: bg });
          if (navType === 'reload') {
            await manager.sendCDPCommand(pageId, 'Page.reload', {});
          } else if (navType === 'back') {
            await evalInTab(manager, pageId, 'history.back(); true', false);
          } else if (navType === 'forward') {
            await evalInTab(manager, pageId, 'history.forward(); true', false);
          }
          await waitForPageStable(manager, pageId, { timeoutMs: 12_000, background: bg });
        },
      );

      sendJson(res, 200, { ok: true, browserContextId, pageId });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/snapshot') {
      const body = (await parseJsonBody(req)) as { pageId?: string; background?: boolean };
      const pageId = await resolveTargetTabId(manager, body?.pageId);
      const bg = body?.background === true;
      const result = await withAiActivity(
        manager,
        {
          action: 'AI captured a page snapshot',
          pageId,
          details: pageId,
        },
        async () => {
          await waitForPageStable(manager, pageId, { timeoutMs: 8_000, requireText: true, stableMs: 400, background: bg });
          let snapshot = (await evalInTab(manager, pageId, buildSnapshotScript(), true)) as
            | { url?: string; title?: string; lines?: string[] }
            | undefined;
          if (!Array.isArray(snapshot?.lines) || snapshot.lines.length < 3) {
            await waitForPageStable(manager, pageId, { timeoutMs: 2_000, requireText: true, stableMs: 400, background: bg });
            snapshot = (await evalInTab(manager, pageId, buildSnapshotScript(), true)) as
              | { url?: string; title?: string; lines?: string[] }
              | undefined;
          }
          return snapshot;
        },
      );
      sendJson(res, 200, {
        ok: true,
        browserContextId,
        pageId,
        url: result?.url || '',
        title: result?.title || '',
        lines: Array.isArray(result?.lines) ? result!.lines : [],
      });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/click') {
      const body = (await parseJsonBody(req)) as { pageId?: string; uid?: string; background?: boolean };
      if (!body?.uid) {
        sendJson(res, 400, { ok: false, error: 'MISSING_UID', browserContextId });
        return;
      }
      const pageId = await resolveTargetTabId(manager, body.pageId);
      const bg = body?.background === true;
      const result = await withAiActivity(
        manager,
        {
          action: 'AI clicked a page element',
          pageId,
          details: body.uid,
        },
        async () => {
          await waitForPageStable(manager, pageId, { timeoutMs: 8_000, stableMs: 400, background: bg });
          return evalInTab(manager, pageId, clickByUidScript(body.uid!), true);
        },
      );
      sendJson(res, 200, { ok: true, browserContextId, pageId, result });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/fill') {
      const body = (await parseJsonBody(req)) as { pageId?: string; uid?: string; value?: string; background?: boolean };
      if (!body?.uid) {
        sendJson(res, 400, { ok: false, error: 'MISSING_UID', browserContextId });
        return;
      }
      const pageId = await resolveTargetTabId(manager, body.pageId);
      const bg = body?.background === true;
      const result = await withAiActivity(
        manager,
        {
          action: 'AI filled a page field',
          pageId,
          details: body.uid,
        },
        async () => {
          await waitForPageStable(manager, pageId, { timeoutMs: 8_000, stableMs: 400, background: bg });
          return evalInTab(manager, pageId, fillByUidScript(body.uid!, body.value || ''), true);
        },
      );
      sendJson(res, 200, { ok: true, browserContextId, pageId, result });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/type') {
      const body = (await parseJsonBody(req)) as { pageId?: string; text?: string; submitKey?: string; background?: boolean };
      const pageId = await resolveTargetTabId(manager, body?.pageId);
      const bg = body?.background === true;
      const result = await withAiActivity(
        manager,
        {
          action: 'AI typed into the page',
          pageId,
          details: body?.submitKey ? `submit with ${body.submitKey}` : 'typing',
        },
        async () => {
          await waitForPageStable(manager, pageId, { timeoutMs: 8_000, stableMs: 400, background: bg });
          return evalInTab(manager, pageId, typeTextScript(body?.text || '', body?.submitKey), true);
        },
      );
      sendJson(res, 200, { ok: true, browserContextId, pageId, result });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/press') {
      const body = (await parseJsonBody(req)) as { pageId?: string; key?: string; background?: boolean };
      const pageId = await resolveTargetTabId(manager, body?.pageId);
      const bg = body?.background === true;
      const result = await withAiActivity(
        manager,
        {
          action: 'AI pressed a key in the page',
          pageId,
          details: body?.key || 'Enter',
        },
        async () => {
          await waitForPageStable(manager, pageId, { timeoutMs: 8_000, stableMs: 400, background: bg });
          return evalInTab(manager, pageId, pressKeyScript(body?.key || 'Enter'), true);
        },
      );
      sendJson(res, 200, { ok: true, browserContextId, pageId, result });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/wait-for') {
      const body = (await parseJsonBody(req)) as { pageId?: string; text?: string[]; timeoutMs?: number; background?: boolean };
      const targets = Array.isArray(body?.text) ? body.text.filter((t) => typeof t === 'string' && t.trim()) : [];
      if (targets.length === 0) {
        sendJson(res, 400, { ok: false, error: 'MISSING_WAIT_TEXT', browserContextId });
        return;
      }
      const pageId = await resolveTargetTabId(manager, body?.pageId);
      const bg = body?.background === true;
      const timeoutMs = Math.max(500, Math.min(body?.timeoutMs || 10_000, 120_000));
      const matchedText = await withAiActivity(
        manager,
        {
          action: 'AI waited for page content',
          pageId,
          details: targets.join(', '),
        },
        async () => {
          await ensureTabReady(manager, pageId, { background: bg });
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const result = (await evalInTab(manager, pageId, waitForTextScript(targets), true)) as
              | { found?: boolean; text?: string }
              | undefined;
            if (result?.found) {
              return result.text || '';
            }
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
          throw new Error('WAIT_FOR_TIMEOUT');
        },
      ).catch((error) => {
        if (error instanceof Error && error.message === 'WAIT_FOR_TIMEOUT') {
          return null;
        }
        throw error;
      });

      if (matchedText !== null) {
        sendJson(res, 200, { ok: true, browserContextId, pageId, found: true, text: matchedText });
        return;
      }
      sendJson(res, 408, { ok: false, error: 'WAIT_FOR_TIMEOUT', browserContextId });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/evaluate') {
      const body = (await parseJsonBody(req)) as { pageId?: string; expression?: string; background?: boolean };
      const expression = typeof body?.expression === 'string' ? body.expression : '';
      if (!expression) {
        sendJson(res, 400, { ok: false, error: 'MISSING_EXPRESSION', browserContextId });
        return;
      }
      const pageId = await resolveTargetTabId(manager, body.pageId);
      const value = await withAiActivity(
        manager,
        {
          action: 'AI evaluated page JavaScript',
          pageId,
          details: expression.slice(0, 120),
        },
        async () => {
          await ensureTabReady(manager, pageId, { background: body?.background });
          return evalInTab(manager, pageId, expression, true);
        },
      );
      sendJson(res, 200, { ok: true, browserContextId, pageId, value });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/screenshot') {
      const body = (await parseJsonBody(req)) as { pageId?: string; filePath?: string; background?: boolean };
      const pageId = await resolveTargetTabId(manager, body?.pageId);
      const targetPath = await withAiActivity(
        manager,
        {
          action: 'AI captured a screenshot',
          pageId,
          details: body?.filePath || pageId,
        },
        async () => {
          await waitForPageStable(manager, pageId, { timeoutMs: 3_000, stableMs: 300, background: body?.background });
          const result = await manager.sendCDPCommand(pageId, 'Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
          }) as { data?: string };
          const base64 = result?.data;
          if (typeof base64 !== 'string' || !base64) {
            throw new Error('CAPTURE_SCREENSHOT_FAILED');
          }
          const resolvedPath = body?.filePath
            ? path.resolve(body.filePath)
            : path.join(os.tmpdir(), `lumos-chrome-${Date.now()}.png`);
          await fs.writeFile(resolvedPath, Buffer.from(base64, 'base64'));
          return resolvedPath;
        },
      ).catch((error) => {
        if (error instanceof Error && error.message === 'CAPTURE_SCREENSHOT_FAILED') {
          return null;
        }
        throw error;
      });

      if (!targetPath) {
        sendJson(res, 500, { ok: false, error: 'CAPTURE_SCREENSHOT_FAILED', browserContextId });
        return;
      }
      sendJson(res, 200, { ok: true, browserContextId, pageId, filePath: targetPath });
      return;
    }

    // --- /v1/fetch: HTTP fetch using Electron session cookies ---
    if (method === 'POST' && pathname === '/v1/fetch') {
      const body = (await parseJsonBody(req)) as {
        url?: string;
        headers?: Record<string, string>;
        maxBytes?: number;
      };
      if (!body?.url || typeof body.url !== 'string') {
        sendJson(res, 400, { ok: false, error: 'MISSING_URL', browserContextId });
        return;
      }
      const targetUrl = body.url;
      const maxBytes = Math.min(body?.maxBytes || 2_000_000, 10_000_000);
      const partition = manager.getSessionPartition?.() || 'persist:lumos-browser';
      const ses = session.fromPartition(partition);

      try {
        const fetchHeaders: Record<string, string> = {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...(body.headers || {}),
        };

        const response = await ses.fetch(targetUrl, {
          method: 'GET',
          headers: normalizeChromeLikeRequestHeaders(fetchHeaders, {
            locale: app.getLocale(),
          }),
        });

        const contentType = response.headers.get('content-type') || '';
        const buffer = Buffer.from(await response.arrayBuffer());
        const truncated = buffer.length > maxBytes;
        const html = buffer.slice(0, maxBytes).toString('utf-8');

        sendJson(res, 200, {
          ok: true,
          browserContextId,
          url: targetUrl,
          status: response.status,
          contentType,
          htmlLength: html.length,
          truncated,
          html,
        });
      } catch (error) {
        sendJson(res, 502, {
          ok: false,
          error: 'FETCH_FAILED',
          browserContextId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'NOT_FOUND', browserContextId });
  }
}
