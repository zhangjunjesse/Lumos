import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { BrowserWindow, session } from 'electron';
import type { BrowserManager } from './browser-manager';

interface BridgeContext {
  browserManager: BrowserManager | null;
}

interface PageRuntimeState {
  readyState: string;
  hasBody: boolean;
  textLength: number;
  title: string;
  url: string;
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

function unauthorized(res: http.ServerResponse): void {
  sendJson(res, 401, { ok: false, error: 'UNAUTHORIZED' });
}

async function withAiActivity<T>(
  manager: BrowserManager,
  activity: { action: string; pageId?: string; details?: string; successDetails?: string },
  task: () => Promise<T>,
): Promise<T> {
  const entry = manager.emitAiActivity({
    action: activity.action,
    pageId: activity.pageId,
    details: activity.details,
  });

  try {
    const result = await task();
    manager.finishAiActivity(entry, 'success', activity.successDetails || activity.details);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    manager.finishAiActivity(entry, 'error', message);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTabReady(manager: BrowserManager, tabId: string, options?: { background?: boolean }): Promise<void> {
  if (options?.background) {
    // Background mode: ensure the view has renderable bounds so the page
    // actually loads, but position it offscreen so the user doesn't see it.
    manager.ensureViewRenderable(tabId);
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
  manager: BrowserManager,
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
  manager: BrowserManager,
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
  manager: BrowserManager,
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

function waitForTextScript(texts: string[]): string {
  const escaped = JSON.stringify(texts);
  return `(() => {
    const hay = (document.body?.innerText || document.documentElement?.innerText || '').toLowerCase();
    const needles = ${escaped}.map((t) => String(t || '').toLowerCase());
    const matched = needles.find((t) => t && hay.includes(t)) || '';
    return { found: Boolean(matched), text: matched };
  })()`;
}

async function resolveTargetTabId(
  manager: BrowserManager,
  requested?: string,
): Promise<string> {
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

export class BrowserBridgeServer {
  private server: http.Server | null = null;
  private readonly token: string;
  private port = 0;
  private readonly context: BridgeContext;

  constructor(context: BridgeContext) {
    this.context = context;
    this.token = crypto.randomBytes(24).toString('hex');
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

    if (pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'browser-bridge', ready: Boolean(this.context.browserManager) });
      return;
    }

    const token = req.headers['x-lumos-bridge-token'];
    if (token !== this.token) {
      unauthorized(res);
      return;
    }

    const manager = this.context.browserManager;
    if (!manager) {
      sendJson(res, 503, { ok: false, error: 'BROWSER_MANAGER_UNAVAILABLE' });
      return;
    }

    if (method === 'GET' && pathname === '/v1/pages') {
      const pages = manager.getTabs().map((tab) => ({
        pageId: tab.id,
        url: tab.url,
        title: tab.title,
        isActive: tab.id === manager.getActiveTabId(),
        isLoading: tab.isLoading,
      }));
      sendJson(res, 200, { ok: true, pages, activePageId: manager.getActiveTabId() });
      return;
    }

    if (method === 'GET' && pathname === '/v1/pages/current') {
      const activePageId = manager.getActiveTabId();
      const current = manager.getTabs().find((tab) => tab.id === activePageId) || null;
      sendJson(res, 200, {
        ok: true,
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
      const domain = requestUrl.searchParams.get('domain')?.trim() || undefined;
      const url = requestUrl.searchParams.get('url')?.trim() || undefined;
      const name = requestUrl.searchParams.get('name')?.trim() || undefined;
      const cookies = await manager.getCookies({
        ...(domain ? { domain } : {}),
        ...(url ? { url } : {}),
        ...(name ? { name } : {}),
      });
      sendJson(res, 200, {
        ok: true,
        cookies: cookies.map((cookie) => ({
          name: cookie.name,
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
        sendJson(res, 400, { ok: false, error: 'MISSING_COOKIES' });
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
        importedCount,
      });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/new') {
      const body = (await parseJsonBody(req)) as { url?: string; background?: boolean };
      const pageId = await withAiActivity(
        manager,
        {
          action: 'AI opened a browser tab',
          details: body?.url || 'about:blank',
        },
        async () => {
          const createdPageId = await manager.createTab(body?.url);
          if (body?.background) {
            // Set offscreen bounds so Chromium renders the page content
            manager.ensureViewRenderable(createdPageId);
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
      sendJson(res, 200, { ok: true, pageId });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/select') {
      const body = (await parseJsonBody(req)) as { pageId?: string; background?: boolean };
      if (!body?.pageId) {
        sendJson(res, 400, { ok: false, error: 'MISSING_PAGE_ID' });
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
      sendJson(res, 200, { ok: true, pageId });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/close') {
      const body = (await parseJsonBody(req)) as { pageId?: string };
      if (!body?.pageId) {
        sendJson(res, 400, { ok: false, error: 'MISSING_PAGE_ID' });
        return;
      }
      const exists = manager.getTabs().some((tab) => tab.id === body.pageId);
      if (!exists) {
        sendJson(res, 200, { ok: true, closed: false, pageId: body.pageId });
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
      sendJson(res, 200, { ok: true, closed: true, pageId: body.pageId });
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
        sendJson(res, 400, { ok: false, error: 'MISSING_URL' });
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
            await manager.navigate(pageId, { url: body.url! });
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

      sendJson(res, 200, { ok: true, pageId });
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
        sendJson(res, 400, { ok: false, error: 'MISSING_UID' });
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
      sendJson(res, 200, { ok: true, pageId, result });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/fill') {
      const body = (await parseJsonBody(req)) as { pageId?: string; uid?: string; value?: string; background?: boolean };
      if (!body?.uid) {
        sendJson(res, 400, { ok: false, error: 'MISSING_UID' });
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
      sendJson(res, 200, { ok: true, pageId, result });
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
      sendJson(res, 200, { ok: true, pageId, result });
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
      sendJson(res, 200, { ok: true, pageId, result });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/wait-for') {
      const body = (await parseJsonBody(req)) as { pageId?: string; text?: string[]; timeoutMs?: number; background?: boolean };
      const targets = Array.isArray(body?.text) ? body.text.filter((t) => typeof t === 'string' && t.trim()) : [];
      if (targets.length === 0) {
        sendJson(res, 400, { ok: false, error: 'MISSING_WAIT_TEXT' });
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
        sendJson(res, 200, { ok: true, pageId, found: true, text: matchedText });
        return;
      }
      sendJson(res, 408, { ok: false, error: 'WAIT_FOR_TIMEOUT' });
      return;
    }

    if (method === 'POST' && pathname === '/v1/pages/evaluate') {
      const body = (await parseJsonBody(req)) as { pageId?: string; expression?: string; background?: boolean };
      const expression = typeof body?.expression === 'string' ? body.expression : '';
      if (!expression) {
        sendJson(res, 400, { ok: false, error: 'MISSING_EXPRESSION' });
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
      sendJson(res, 200, { ok: true, pageId, value });
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
        sendJson(res, 500, { ok: false, error: 'CAPTURE_SCREENSHOT_FAILED' });
        return;
      }
      sendJson(res, 200, { ok: true, pageId, filePath: targetPath });
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
        sendJson(res, 400, { ok: false, error: 'MISSING_URL' });
        return;
      }
      const targetUrl = body.url;
      const maxBytes = Math.min(body?.maxBytes || 2_000_000, 10_000_000);
      const partition = manager.getSessionPartition?.() || 'persist:lumos-browser';
      const ses = session.fromPartition(partition);

      try {
        const fetchHeaders: Record<string, string> = {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          ...(body.headers || {}),
        };

        const response = await ses.fetch(targetUrl, {
          method: 'GET',
          headers: fetchHeaders,
        });

        const contentType = response.headers.get('content-type') || '';
        const buffer = Buffer.from(await response.arrayBuffer());
        const truncated = buffer.length > maxBytes;
        const html = buffer.slice(0, maxBytes).toString('utf-8');

        sendJson(res, 200, {
          ok: true,
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
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
  }
}
