/**
 * BrowserManager
 *
 * Owns the native browser tabs, context capture, workflow recording, and
 * workflow replay for the built-in browser workspace.
 */

import fs from 'fs';
import path from 'path';
import { app, BaseWindow, BrowserWindow, DownloadItem, session, shell, WebContents, WebContentsView } from 'electron';
import { EventEmitter } from 'events';
import { CDPManager } from './cdp-manager';
import { getPlatformLayout } from './platform-layout';
import { setupBrowserContextMenu } from './context-menu';
import {
  BrowserCaptureSettings,
  BrowserContextEvent,
  BrowserDatabase,
  BrowserWorkflow,
  BrowserWorkflowParameter,
  BrowserWorkflowRunResult,
  BrowserWorkflowStep,
  TabState,
} from './browser-database';

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  createdAt: number;
  lastAccessedAt: number;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BrowserDisplayTarget = 'default' | 'panel' | 'hidden';

export interface NavigationOptions {
  url: string;
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded';
}

export interface BrowserRecordingState {
  isRecording: boolean;
  tabId?: string;
  workflowName?: string;
  startedAt?: number;
  stepCount: number;
}

export interface BrowserManagerOptions {
  maxTabs?: number;
  maxActiveViews?: number;
  sessionPartition?: string;
}

interface ActiveRecordingSession {
  tabId: string;
  workflowName: string;
  startedAt: number;
  startUrl: string;
  steps: BrowserWorkflowStep[];
  parameters: Map<string, BrowserWorkflowParameter>;
}

interface WorkflowReplayOptions {
  tabId?: string;
  parameters?: Record<string, string>;
}

interface WorkflowReplayState {
  runId: string;
  tabId: string;
  downloadedFiles: string[];
  pendingDownloads: Set<Promise<void>>;
  screenshots: string[];
  extractedData: Record<string, unknown>;
}

interface RecorderConsoleEvent {
  type: 'click' | 'input';
  selector?: string;
  text?: string;
  inputType?: string;
  value?: string;
  masked?: boolean;
  label?: string;
  createdAt?: number;
}

interface PageRuntimeState {
  readyState: string;
  hasBody: boolean;
  textLength: number;
  title: string;
  url: string;
}

interface BrowserAiActivity {
  id: string;
  action: string;
  status: 'running' | 'success' | 'error';
  details?: string;
  pageId?: string;
  startedAt: number;
  finishedAt?: number;
}

const RECORDER_CONSOLE_PREFIX = '__LUMOS_WORKFLOW__';
const SENSITIVE_QUERY_KEY_RE = /(token|code|pass(word)?|secret|key|session|auth|bearer|signature|sig|credential)/i;
const SENSITIVE_FIELD_RE = /(pass(word)?|secret|token|key|session|auth|otp|card|cvv|security)/i;
const DEFAULT_WORKFLOW_NAME = 'Recorded workflow';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).toString();
  } catch {
    return rawUrl;
  }
}

function getCanGoBack(webContents: WebContents): boolean {
  return webContents.navigationHistory.canGoBack();
}

function getCanGoForward(webContents: WebContents): boolean {
  return webContents.navigationHistory.canGoForward();
}

function sanitizeUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;

  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY_RE.test(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function sanitizeText(raw: string | undefined, maxLength: number = 240): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function slugify(input: string, fallback: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function escapeForScript(value: string): string {
  return JSON.stringify(value);
}

function resolveTemplate(rawValue: string | undefined, variables: Record<string, string>): string {
  if (!rawValue) return '';
  return rawValue.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_match, name) => variables[name] ?? '');
}

function sanitizeWorkflowForPersistence(workflow: BrowserWorkflow): BrowserWorkflow {
  return {
    ...workflow,
    startUrl: sanitizeUrl(workflow.startUrl),
    parameters: workflow.parameters.map((parameter) => ({ ...parameter })),
    steps: workflow.steps.map((step) => ({
      ...step,
      url: sanitizeUrl(step.url) ?? step.url,
      metadata: step.metadata ? { ...step.metadata } : undefined,
    })),
  };
}

function buildWorkflowRecorderScript(): string {
  return `(() => {
    const prefix = ${escapeForScript(RECORDER_CONSOLE_PREFIX)};
    const sensitiveFieldRe = ${SENSITIVE_FIELD_RE};
    const log = (payload) => console.info(prefix + JSON.stringify(payload));
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const buildSelector = (element) => {
      if (!(element instanceof Element)) return '';
      if (element.id) return '#' + CSS.escape(element.id);

      const attrs = ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder'];
      for (const attr of attrs) {
        const value = element.getAttribute(attr);
        if (value) {
          return element.tagName.toLowerCase() + '[' + attr + '=' + JSON.stringify(value) + ']';
        }
      }

      const className = normalize(element.className);
      if (className && className.length < 80) {
        const firstClass = className.split(' ')[0];
        if (firstClass) {
          return element.tagName.toLowerCase() + '.' + CSS.escape(firstClass);
        }
      }

      return element.tagName.toLowerCase();
    };
    const describe = (element) => {
      const label = normalize(
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.textContent
      );
      return label.slice(0, 120);
    };

    if (window.__lumosWorkflowRecorderCleanup) {
      window.__lumosWorkflowRecorderCleanup();
    }

    const clickHandler = (event) => {
      const target = event.target instanceof Element
        ? event.target.closest('a,button,[role="button"],summary,input,textarea,select,label')
        : null;
      if (!target) return;
      log({
        type: 'click',
        selector: buildSelector(target),
        text: describe(target),
        createdAt: Date.now(),
      });
    };

    const inputHandler = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
        return;
      }
      const label = normalize(
        target.getAttribute('aria-label') ||
        target.name ||
        target.id ||
        target.getAttribute('placeholder')
      );
      const rawValue = target instanceof HTMLSelectElement
        ? target.value
        : target.value || '';
      const masked = target.type === 'password' || sensitiveFieldRe.test(label);
      log({
        type: 'input',
        selector: buildSelector(target),
        text: describe(target),
        inputType: target.type || target.tagName.toLowerCase(),
        value: masked ? undefined : rawValue.slice(0, 500),
        masked,
        label,
        createdAt: Date.now(),
      });
    };

    document.addEventListener('click', clickHandler, true);
    document.addEventListener('change', inputHandler, true);

    window.__lumosWorkflowRecorderCleanup = () => {
      document.removeEventListener('click', clickHandler, true);
      document.removeEventListener('change', inputHandler, true);
      delete window.__lumosWorkflowRecorderCleanup;
    };

    return true;
  })()`;
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

function buildClickStepScript(step: BrowserWorkflowStep, resolvedText: string): string {
  return `(() => {
    const bySelector = ${escapeForScript(step.selector || '')};
    const byText = ${escapeForScript(resolvedText || step.text || '')};
    let target = null;

    if (bySelector) {
      target = document.querySelector(bySelector);
    }

    if (!target && byText) {
      const candidates = Array.from(document.querySelectorAll('a,button,[role="button"],summary,input[type="button"],input[type="submit"],label'));
      target = candidates.find((element) => {
        const text = String(
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.textContent ||
          ''
        ).replace(/\\s+/g, ' ').trim();
        return text === byText || text.includes(byText);
      }) || null;
    }

    if (!(target instanceof Element)) {
      return { ok: false, error: 'TARGET_NOT_FOUND' };
    }

    target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    if (target instanceof HTMLElement) {
      target.focus({ preventScroll: true });
    }
    if (typeof target.click === 'function') {
      target.click();
      return { ok: true };
    }
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { ok: true };
  })()`;
}

function buildInputStepScript(step: BrowserWorkflowStep, resolvedValue: string, resolvedText: string): string {
  return `(() => {
    const bySelector = ${escapeForScript(step.selector || '')};
    const byText = ${escapeForScript(resolvedText || step.text || '')};
    const nextValue = ${escapeForScript(resolvedValue)};
    let target = null;

    if (bySelector) {
      target = document.querySelector(bySelector);
    }

    if (!target && byText) {
      const candidates = Array.from(document.querySelectorAll('input,textarea,select'));
      target = candidates.find((element) => {
        const text = String(
          element.getAttribute('aria-label') ||
          element.getAttribute('name') ||
          element.getAttribute('placeholder') ||
          ''
        ).replace(/\\s+/g, ' ').trim();
        return text === byText || text.includes(byText);
      }) || null;
    }

    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return { ok: false, error: 'TARGET_NOT_FOUND' };
    }

    target.focus();
    if (target instanceof HTMLSelectElement) {
      target.value = nextValue;
    } else {
      target.value = nextValue;
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`;
}

function buildKeypressStepScript(key: string): string {
  return `(() => {
    const target = document.activeElement || document.body || document.documentElement;
    if (!target) {
      return { ok: false, error: 'NO_ACTIVE_ELEMENT' };
    }
    const options = { key: ${escapeForScript(key)}, code: ${escapeForScript(key)}, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', options));
    target.dispatchEvent(new KeyboardEvent('keyup', options));
    return { ok: true };
  })()`;
}

function buildWaitForTextScript(expectedText: string): string {
  return `(() => {
    const hay = (document.body?.innerText || document.documentElement?.innerText || '').toLowerCase();
    const needle = ${escapeForScript(expectedText.toLowerCase())};
    return { found: Boolean(needle && hay.includes(needle)) };
  })()`;
}

function buildSnapshotExtractionScript(): string {
  return `(() => ({
    url: location.href || '',
    title: document.title || '',
    textPreview: ((document.body?.innerText || document.documentElement?.innerText || '').replace(/\\s+/g, ' ').trim()).slice(0, 400)
  }))()`;
}

export class BrowserManager extends EventEmitter {
  private mainWindow: BaseWindow | BrowserWindow;
  private tabs: Map<string, WebContentsView | null>;
  private tabMetadata: Map<string, BrowserTab>;
  private activeTabId: string | null;
  private maxTabs: number;
  private maxActiveViews: number;
  private sessionPartition: string;
  private cdpManager: CDPManager;
  private database: BrowserDatabase;
  private displayTarget: BrowserDisplayTarget;
  private panelBounds: BrowserBounds | null;
  private captureSettings: BrowserCaptureSettings;
  private recording: ActiveRecordingSession | null;
  private replayRuns: Map<string, WorkflowReplayState>;

  constructor(mainWindow: BaseWindow | BrowserWindow, options?: BrowserManagerOptions) {
    super();
    this.mainWindow = mainWindow;
    this.tabs = new Map();
    this.tabMetadata = new Map();
    this.activeTabId = null;
    this.maxTabs = options?.maxTabs || 10;
    this.maxActiveViews = options?.maxActiveViews || 3;
    this.sessionPartition = options?.sessionPartition || 'persist:lumos-browser';
    this.cdpManager = new CDPManager();
    this.database = new BrowserDatabase();
    this.displayTarget = 'hidden';
    this.panelBounds = null;
    this.captureSettings = this.database.getCaptureSettings();
    this.recording = null;
    this.replayRuns = new Map();

    this.setupWindowListeners();
    this.setupSessionListeners();
    void this.restoreSession();
  }

  private setupWindowListeners(): void {
    this.mainWindow.on('resize', () => this.handleWindowResize());
    this.mainWindow.on('maximize', () => this.handleWindowResize());
    this.mainWindow.on('unmaximize', () => this.handleWindowResize());
    this.mainWindow.on('enter-full-screen', () => this.handleWindowResize());
    this.mainWindow.on('leave-full-screen', () => this.handleWindowResize());
  }

  private setupSessionListeners(): void {
    const ses = session.fromPartition(this.sessionPartition);
    ses.on('will-download', (_event, item, webContents) => {
      this.handleDownload(item, webContents);
    });
  }

  private handleWindowResize(): void {
    if (!this.activeTabId) return;

    const view = this.tabs.get(this.activeTabId);
    if (view) {
      view.setBounds(this.calculateBounds());
    }
  }

  setDisplayTarget(target: BrowserDisplayTarget, bounds?: BrowserBounds): void {
    this.displayTarget = target;

    if (target === 'panel') {
      this.panelBounds = bounds ? this.normalizeBounds(bounds) : null;
    } else if (target !== 'panel') {
      this.panelBounds = null;
    }

    this.handleWindowResize();
  }

  async createTab(url?: string): Promise<string> {
    if (this.tabs.size >= this.maxTabs) {
      throw new Error(`Maximum tab limit (${this.maxTabs}) reached`);
    }

    const tabId = createId('tab');

    try {
      await this.evictIfNeeded();
      const view = this.createView();
      view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      this.mainWindow.contentView.addChildView(view);
      this.tabs.set(tabId, view);

      const metadata: BrowserTab = {
        id: tabId,
        url: url || 'about:blank',
        title: 'New Tab',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        isPinned: false,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };

      this.tabMetadata.set(tabId, metadata);
      this.setupViewListeners(tabId, view);
      this.setupContextMenu(tabId, view);
      void this.persistTabState(tabId);

      if (url) {
        await this.navigate(tabId, { url });
      }

      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'tab',
        summary: `Created tab${url ? ` for ${sanitizeUrl(url)}` : ''}`,
        url: sanitizeUrl(url),
        createdAt: Date.now(),
      });
      this.emit('tab-created', { tabId, metadata });
      return tabId;
    } catch (error) {
      this.tabs.delete(tabId);
      this.tabMetadata.delete(tabId);
      throw new Error(`Failed to create tab: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async switchTab(tabId: string): Promise<void> {
    if (this.activeTabId === tabId) {
      return;
    }

    const metadata = this.tabMetadata.get(tabId);
    if (!metadata) {
      throw new Error(`Tab ${tabId} not found`);
    }

    let view = this.tabs.get(tabId);
    if (!view) {
      view = await this.restoreTab(tabId);
    }

    if (this.activeTabId) {
      const currentView = this.tabs.get(this.activeTabId);
      currentView?.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }

    view.setBounds(this.calculateBounds());
    view.webContents.focus();
    this.activeTabId = tabId;
    metadata.lastAccessedAt = Date.now();
    void this.persistTabState(tabId);

    this.recordContextEvent({
      tabId,
      pageId: tabId,
      type: 'tab',
      summary: `Switched to ${sanitizeText(metadata.title) || 'tab'}`,
      url: sanitizeUrl(metadata.url),
      title: sanitizeText(metadata.title),
      createdAt: Date.now(),
    });
    this.emit('tab-switched', { tabId, metadata });
  }

  async navigate(tabId: string, options: NavigationOptions): Promise<void> {
    const view = await this.requireView(tabId);
    const metadata = this.requireTab(tabId);
    const timeout = options.timeout || 30_000;
    const waitUntil = options.waitUntil || 'load';

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        metadata.isLoading = false;
        void this.persistTabState(tabId);
        this.emit('tab-loading', { tabId, isLoading: false });
        reject(new Error(`Navigation timeout after ${timeout}ms`));
      }, timeout);

      const cleanup = () => {
        clearTimeout(timeoutId);
        view.webContents.off('did-finish-load', onLoad);
        view.webContents.off('did-fail-load', onFail);
        view.webContents.off('dom-ready', onDomReady);
      };

      const onLoad = () => {
        if (waitUntil === 'load') {
          cleanup();
          resolve();
        }
      };

      const onDomReady = () => {
        if (waitUntil === 'domcontentloaded') {
          cleanup();
          resolve();
        }
      };

      const onFail = (
        _event: unknown,
        errorCode: number,
        errorDescription: string,
        _validatedURL?: string,
        isMainFrame: boolean = true,
      ) => {
        if (!isMainFrame || errorCode === -3) {
          return;
        }
        cleanup();
        reject(new Error(`Navigation failed: ${errorDescription} (${errorCode})`));
      };

      view.webContents.on('did-finish-load', onLoad);
      view.webContents.on('did-fail-load', onFail);
      view.webContents.on('dom-ready', onDomReady);

      metadata.isLoading = true;
      metadata.url = options.url;
      void this.persistTabState(tabId);
      view.webContents.loadURL(options.url).catch((error) => {
        cleanup();
        metadata.isLoading = false;
        void this.persistTabState(tabId);
        this.emit('tab-loading', { tabId, isLoading: false });
        reject(error);
      });
    });
  }

  async goBack(tabId: string): Promise<void> {
    const view = await this.requireView(tabId);
    if (!getCanGoBack(view.webContents)) {
      return;
    }
    view.webContents.goBack();
    await this.waitForPageSettled(tabId, 12_000);
  }

  async goForward(tabId: string): Promise<void> {
    const view = await this.requireView(tabId);
    if (!getCanGoForward(view.webContents)) {
      return;
    }
    view.webContents.goForward();
    await this.waitForPageSettled(tabId, 12_000);
  }

  async reload(tabId: string): Promise<void> {
    const view = await this.requireView(tabId);
    view.webContents.reload();
    await this.waitForPageSettled(tabId, 12_000);
  }

  async stop(tabId: string): Promise<void> {
    const view = await this.requireView(tabId);
    view.webContents.stop();
    const metadata = this.requireTab(tabId);
    metadata.isLoading = false;
    void this.persistTabState(tabId);
    this.emit('tab-loading', { tabId, isLoading: false });
  }

  async setZoomFactor(tabId: string, zoomFactor: number): Promise<void> {
    const view = await this.requireView(tabId);
    const normalized = Math.max(0.25, Math.min(5, zoomFactor));
    view.webContents.setZoomFactor(normalized);
  }

  async closeTab(tabId: string): Promise<void> {
    const view = this.tabs.get(tabId);
    if (!view && !this.tabMetadata.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    if (this.recording?.tabId === tabId) {
      await this.cancelRecording();
    }

    try {
      if (this.activeTabId === tabId) {
        const remainingTabs = Array.from(this.tabs.keys()).filter((id) => id !== tabId);
        if (remainingTabs.length > 0) {
          await this.switchTab(remainingTabs[0]);
        } else {
          this.activeTabId = null;
        }
      }

      await this.destroyTab(tabId, { removeState: true });

      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'tab',
        summary: `Closed tab ${tabId}`,
        createdAt: Date.now(),
      });
      this.emit('tab-closed', { tabId });
    } catch (error) {
      throw new Error(`Failed to close tab: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getTabs(): BrowserTab[] {
    return Array.from(this.tabMetadata.values()).sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  async connectCDP(tabId: string): Promise<void> {
    const view = await this.requireView(tabId);
    await this.cdpManager.attach(tabId, view.webContents);
    this.emit('cdp-connected', { tabId });
  }

  async disconnectCDP(tabId: string): Promise<void> {
    await this.cdpManager.detach(tabId);
    this.emit('cdp-disconnected', { tabId });
  }

  async sendCDPCommand(tabId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const response = await this.cdpManager.sendCommand(tabId, { method, params });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  isCDPConnected(tabId: string): boolean {
    return this.cdpManager.isAttached(tabId);
  }

  async getCookies(filter?: Electron.CookiesGetFilter): Promise<Electron.Cookie[]> {
    const ses = session.fromPartition(this.sessionPartition);
    return filter ? ses.cookies.get(filter) : ses.cookies.get({});
  }

  async setCookie(cookie: Electron.CookiesSetDetails): Promise<void> {
    const ses = session.fromPartition(this.sessionPartition);
    await ses.cookies.set(cookie);
  }

  getCaptureSettings(): BrowserCaptureSettings {
    return { ...this.captureSettings };
  }

  updateCaptureSettings(settings: Partial<BrowserCaptureSettings>): BrowserCaptureSettings {
    this.captureSettings = this.database.updateCaptureSettings(settings);
    this.emit('capture-settings-updated', { settings: this.captureSettings });
    this.recordContextEvent({
      type: 'capture',
      summary: `Capture ${this.captureSettings.paused ? 'paused' : this.captureSettings.enabled ? 'configured' : 'disabled'}`,
      metadata: {
        enabled: this.captureSettings.enabled,
        paused: this.captureSettings.paused,
        retentionDays: this.captureSettings.retentionDays,
        maxEvents: this.captureSettings.maxEvents,
      },
      createdAt: Date.now(),
    });
    return this.getCaptureSettings();
  }

  getContextEvents(options?: { limit?: number; tabId?: string }): BrowserContextEvent[] {
    return this.database.getContextEvents(options);
  }

  clearContextEvents(): void {
    this.database.clearContextEvents();
    this.emit('context-updated', { cleared: true });
  }

  getRecordingState(): BrowserRecordingState {
    if (!this.recording) {
      return { isRecording: false, stepCount: 0 };
    }

    return {
      isRecording: true,
      tabId: this.recording.tabId,
      workflowName: this.recording.workflowName,
      startedAt: this.recording.startedAt,
      stepCount: this.recording.steps.length,
    };
  }

  async startRecording(options?: { tabId?: string; workflowName?: string }): Promise<BrowserRecordingState> {
    if (this.recording) {
      throw new Error('A workflow recording is already in progress');
    }

    const tabId = await this.resolveTabId(options?.tabId, true);
    const metadata = this.requireTab(tabId);
    this.recording = {
      tabId,
      workflowName: sanitizeText(options?.workflowName, 120) || DEFAULT_WORKFLOW_NAME,
      startedAt: Date.now(),
      startUrl: metadata.url || 'about:blank',
      steps: [],
      parameters: new Map(),
    };

    await this.installRecordingHooks(tabId);
    this.recordContextEvent({
      tabId,
      pageId: tabId,
      type: 'workflow',
      summary: `Started recording "${this.recording.workflowName}"`,
      url: sanitizeUrl(metadata.url),
      title: sanitizeText(metadata.title),
      createdAt: Date.now(),
    });
    this.emit('recording-updated', this.getRecordingState());
    return this.getRecordingState();
  }

  async stopRecording(options?: { save?: boolean; workflowName?: string }): Promise<BrowserWorkflow | null> {
    if (!this.recording) {
      return null;
    }

    const recording = this.recording;
    this.recording = null;
    await this.uninstallRecordingHooks(recording.tabId).catch(() => {});

    if (options?.save === false) {
      this.emit('recording-updated', this.getRecordingState());
      return null;
    }

    if (recording.steps.length === 0 && recording.startUrl) {
      recording.steps.push({
        id: createId('wf-step'),
        type: 'navigate',
        label: 'Open the starting page',
        url: recording.startUrl,
      });
    }

    const now = Date.now();
    const workflow: BrowserWorkflow = sanitizeWorkflowForPersistence({
      id: createId('workflow'),
      name: sanitizeText(options?.workflowName, 120) || recording.workflowName,
      description: 'Recorded in the built-in browser workspace.',
      createdAt: now,
      updatedAt: now,
      sourceTabId: recording.tabId,
      startUrl: recording.startUrl,
      parameters: Array.from(recording.parameters.values()),
      steps: recording.steps,
    });

    const saved = this.database.saveWorkflow(workflow);
    this.recordContextEvent({
      tabId: recording.tabId,
      pageId: recording.tabId,
      type: 'workflow',
      summary: `Saved workflow "${saved.name}" with ${saved.steps.length} step${saved.steps.length === 1 ? '' : 's'}`,
      url: sanitizeUrl(saved.startUrl),
      createdAt: Date.now(),
    });
    this.emit('recording-updated', this.getRecordingState());
    this.emit('workflows-updated', { workflowId: saved.id });
    return saved;
  }

  async cancelRecording(): Promise<BrowserRecordingState> {
    if (this.recording) {
      const tabId = this.recording.tabId;
      this.recording = null;
      await this.uninstallRecordingHooks(tabId).catch(() => {});
      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'workflow',
        summary: 'Cancelled recording',
        createdAt: Date.now(),
      });
    }

    this.emit('recording-updated', this.getRecordingState());
    return this.getRecordingState();
  }

  getWorkflows(): BrowserWorkflow[] {
    return this.database.getWorkflows();
  }

  getWorkflow(workflowId: string): BrowserWorkflow | null {
    return this.database.getWorkflow(workflowId);
  }

  saveWorkflow(workflow: BrowserWorkflow): BrowserWorkflow {
    const now = Date.now();
    const normalized: BrowserWorkflow = sanitizeWorkflowForPersistence({
      ...workflow,
      updatedAt: now,
      createdAt: workflow.createdAt || now,
      parameters: Array.isArray(workflow.parameters) ? workflow.parameters : [],
      steps: Array.isArray(workflow.steps) ? workflow.steps : [],
    });
    const saved = this.database.saveWorkflow(normalized);
    this.emit('workflows-updated', { workflowId: saved.id });
    return saved;
  }

  deleteWorkflow(workflowId: string): void {
    this.database.deleteWorkflow(workflowId);
    this.emit('workflows-updated', { workflowId, deleted: true });
  }

  async replayWorkflow(workflowId: string, options?: WorkflowReplayOptions): Promise<BrowserWorkflowRunResult> {
    const workflow = this.database.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const tabId = await this.resolveReplayTabId(workflow, options);
    const variables = this.resolveWorkflowVariables(workflow, options?.parameters);
    const runId = createId('run');
    const replayState: WorkflowReplayState = {
      runId,
      tabId,
      downloadedFiles: [],
      pendingDownloads: new Set(),
      screenshots: [],
      extractedData: {},
    };

    this.replayRuns.set(runId, replayState);
    const startedAt = Date.now();
    const activity = this.emitAiActivity({
      action: `Replaying workflow: ${workflow.name}`,
      pageId: tabId,
      details: `${workflow.steps.length} steps`,
      status: 'running',
    });

    try {
      await this.switchTab(tabId);

      // 确保 CDP 已连接到目标 tab
      if (!this.cdpManager.isAttached(tabId)) {
        await this.connectCDP(tabId);
      }

      for (const step of workflow.steps) {
        await this.runWorkflowStep(tabId, step, variables, replayState);
      }

      await this.waitForReplayDownloads(replayState, 15_000);

      const metadata = this.requireTab(tabId);
      const snapshot = await this.captureExtractionSnapshot(tabId).catch(() => null);
      const result: BrowserWorkflowRunResult = {
        runId,
        workflowId,
        status: 'success',
        finalUrl: metadata.url || snapshot?.url || '',
        downloadedFiles: replayState.downloadedFiles,
        screenshots: replayState.screenshots,
        extractedData: {
          ...replayState.extractedData,
          page_title: snapshot?.title || metadata.title || '',
          page_preview: snapshot?.textPreview || '',
        },
        startedAt,
        finishedAt: Date.now(),
      };
      this.database.saveWorkflowRun(result);
      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'workflow',
        summary: `Workflow "${workflow.name}" completed`,
        url: sanitizeUrl(result.finalUrl),
        createdAt: Date.now(),
        metadata: {
          downloadedFiles: result.downloadedFiles.length,
          screenshots: result.screenshots.length,
        },
      });
      this.finishAiActivity(activity, 'success', `Finished on ${sanitizeUrl(result.finalUrl) || 'current page'}`);
      this.replayRuns.delete(runId);
      return result;
    } catch (error) {
      const metadata = this.tabMetadata.get(tabId);
      const message = error instanceof Error ? error.message : String(error);
      const result: BrowserWorkflowRunResult = {
        runId,
        workflowId,
        status: 'error',
        finalUrl: metadata?.url || '',
        downloadedFiles: replayState.downloadedFiles,
        screenshots: replayState.screenshots,
        extractedData: { ...replayState.extractedData },
        error: message,
        startedAt,
        finishedAt: Date.now(),
      };
      this.database.saveWorkflowRun(result);
      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'workflow',
        summary: `Workflow "${workflow.name}" failed`,
        url: sanitizeUrl(result.finalUrl),
        createdAt: Date.now(),
        metadata: { error: message },
      });
      this.finishAiActivity(activity, 'error', message);
      this.replayRuns.delete(runId);
      return result;
    }
  }

  async cleanup(): Promise<void> {
    const tabIds = Array.from(this.tabMetadata.keys());

    for (const tabId of tabIds) {
      try {
        await this.persistTabState(tabId);
      } catch (error) {
        console.error(`Failed to save tab state ${tabId}:`, error);
      }
    }

    for (const tabId of tabIds) {
      try {
        await this.destroyTab(tabId, { removeState: false });
      } catch (error) {
        console.error(`Failed to destroy tab ${tabId}:`, error);
      }
    }

    this.activeTabId = null;
    await this.cdpManager.cleanup();
    this.database.close();
  }

  private createView(): WebContentsView {
    return new WebContentsView({
      webPreferences: {
        partition: this.sessionPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
  }

  private setupViewListeners(tabId: string, view: WebContentsView): void {
    const metadata = this.requireTab(tabId);

    view.webContents.setWindowOpenHandler((details) => {
      const targetUrl = details.url;
      const isHttpUrl = /^https?:\/\//i.test(targetUrl);
      const forceExternal = details.features.includes('lumos_external=1');

      if (!isHttpUrl) {
        return { action: 'deny' };
      }

      if (forceExternal) {
        void shell.openExternal(targetUrl);
        return { action: 'deny' };
      }

      void (async () => {
        try {
          const createdTabId = await this.createTab(targetUrl);
          await this.switchTab(createdTabId);
          const hostWindow = this.mainWindow as BrowserWindow;
          if (!hostWindow.webContents.isDestroyed()) {
            hostWindow.webContents.send('content-browser:open-url-in-tab', {
              url: targetUrl,
              pageId: createdTabId,
            });
          }
        } catch (error) {
          console.error('[browser] Failed to open target=_blank URL in new tab:', error);
        }
      })();

      return { action: 'deny' };
    });

    view.webContents.on('did-start-loading', () => {
      metadata.isLoading = true;
      void this.persistTabState(tabId);
      this.emit('tab-loading', { tabId, isLoading: true });
    });

    view.webContents.on('did-finish-load', () => {
      this.refreshTabMetadata(tabId, view);
      this.database.addHistory({
        tabId,
        url: metadata.url,
        title: metadata.title,
        visitedAt: Date.now(),
      });
      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'load',
        summary: `Loaded ${sanitizeText(metadata.title) || sanitizeUrl(metadata.url) || 'page'}`,
        url: sanitizeUrl(metadata.url),
        title: sanitizeText(metadata.title),
        createdAt: Date.now(),
      });
      this.emit('tab-loaded', { tabId, metadata });
      if (this.recording?.tabId === tabId) {
        void this.installRecordingHooks(tabId);
      }
    });

    view.webContents.on('did-navigate', (_event, url) => {
      metadata.url = url;
      metadata.canGoBack = getCanGoBack(view.webContents);
      metadata.canGoForward = getCanGoForward(view.webContents);
      void this.persistTabState(tabId);
      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'navigation',
        summary: `Navigated to ${sanitizeUrl(url) || 'page'}`,
        url: sanitizeUrl(url),
        title: sanitizeText(metadata.title),
        createdAt: Date.now(),
      });
      this.emit('tab-url-updated', { tabId, url });
    });

    view.webContents.on('did-navigate-in-page', (_event, url) => {
      metadata.url = url;
      metadata.canGoBack = getCanGoBack(view.webContents);
      metadata.canGoForward = getCanGoForward(view.webContents);
      void this.persistTabState(tabId);
      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'navigation',
        summary: `Updated route to ${sanitizeUrl(url) || 'page'}`,
        url: sanitizeUrl(url),
        title: sanitizeText(metadata.title),
        createdAt: Date.now(),
      });
      this.emit('tab-url-updated', { tabId, url });
    });

    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      metadata.isLoading = false;
      void this.persistTabState(tabId);
      this.emit('tab-loading', { tabId, isLoading: false });
      this.recordContextEvent({
        tabId,
        pageId: tabId,
        type: 'error',
        summary: `Failed to load ${sanitizeUrl(validatedURL || metadata.url) || 'page'}`,
        url: sanitizeUrl(validatedURL || metadata.url),
        title: sanitizeText(metadata.title),
        createdAt: Date.now(),
        metadata: { errorCode, errorDescription },
      });
      this.emit('tab-error', { tabId, errorCode, errorDescription });
    });

    view.webContents.on('page-title-updated', (_event, title) => {
      metadata.title = title;
      void this.persistTabState(tabId);
      this.emit('tab-title-updated', { tabId, title });
    });

    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      metadata.favicon = favicons[0];
      void this.persistTabState(tabId);
      this.emit('tab-favicon-updated', { tabId, favicon: favicons[0] });
    });

    view.webContents.on('console-message', (event) => {
      const message = typeof event.message === 'string' ? event.message : '';
      if (!message.startsWith(RECORDER_CONSOLE_PREFIX)) {
        return;
      }
      const raw = message.slice(RECORDER_CONSOLE_PREFIX.length);
      try {
        const payload = JSON.parse(raw) as RecorderConsoleEvent;
        this.handleRecordingConsoleEvent(tabId, payload);
      } catch (error) {
        console.warn('[browser] Failed to parse recorder payload:', error);
      }
    });
  }

  private setupContextMenu(tabId: string, view: WebContentsView): void {
    setupBrowserContextMenu(view, {
      onShareToAI: (content, type) => {
        this.recordContextEvent({
          tabId,
          pageId: tabId,
          type: 'ai',
          summary: `Shared ${type} to AI`,
          url: sanitizeUrl(this.tabMetadata.get(tabId)?.url),
          createdAt: Date.now(),
          metadata: { contentType: type },
        });
        this.emit('share-to-ai', { tabId, content, type });
      },
    });
  }

  private calculateBounds(): BrowserBounds {
    if (this.displayTarget === 'hidden') {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    if (this.displayTarget === 'panel' && this.panelBounds) {
      return this.panelBounds;
    }

    const windowBounds = this.mainWindow.getBounds();
    const layout = getPlatformLayout();
    return {
      x: 0,
      y: layout.titleBarHeight + layout.toolbarHeight,
      width: windowBounds.width,
      height: windowBounds.height - layout.titleBarHeight - layout.toolbarHeight,
    };
  }

  private normalizeBounds(bounds: BrowserBounds): BrowserBounds {
    return {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    };
  }

  private async evictIfNeeded(): Promise<void> {
    const activeViews = Array.from(this.tabs.values()).filter((view) => view !== null);
    if (activeViews.length < this.maxActiveViews) {
      return;
    }

    const candidates = Array.from(this.tabMetadata.values())
      .filter((tab) => {
        const view = this.tabs.get(tab.id);
        return view !== null && !tab.isPinned && tab.id !== this.activeTabId;
      })
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

    if (candidates.length === 0) {
      return;
    }

    const victim = candidates[0];
    await this.persistTabState(victim.id);
    const view = this.tabs.get(victim.id);
    if (view) {
      await this.disconnectCDP(victim.id).catch(() => {});
      this.mainWindow.contentView.removeChildView(view);
      view.webContents.destroy();
      this.tabs.set(victim.id, null);
    }
  }

  private async persistTabState(tabId: string): Promise<void> {
    const metadata = this.tabMetadata.get(tabId);
    if (!metadata) return;

    let scrollPosition = { x: 0, y: 0 };
    const view = this.tabs.get(tabId);
    if (view) {
      try {
        const result = await view.webContents.executeJavaScript(`
          JSON.stringify({ x: window.scrollX || 0, y: window.scrollY || 0 })
        `);
        scrollPosition = JSON.parse(result) as { x: number; y: number };
      } catch {
        // Best effort only.
      }
    } else {
      const saved = this.database.getTabState(tabId);
      scrollPosition = saved?.scrollPosition || scrollPosition;
    }

    const state: TabState = {
      id: tabId,
      url: metadata.url,
      title: metadata.title,
      favicon: metadata.favicon,
      scrollPosition,
      createdAt: metadata.createdAt,
      lastAccessedAt: metadata.lastAccessedAt,
    };
    this.database.saveTabState(state);
  }

  private async restoreTab(tabId: string): Promise<WebContentsView> {
    const metadata = this.requireTab(tabId);
    await this.evictIfNeeded();
    const view = this.createView();
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.mainWindow.contentView.addChildView(view);
    this.tabs.set(tabId, view);
    this.setupViewListeners(tabId, view);
    this.setupContextMenu(tabId, view);

    if (metadata.url && metadata.url !== 'about:blank') {
      await this.navigate(tabId, { url: metadata.url });
      const saved = this.database.getTabState(tabId);
      if (saved?.scrollPosition) {
        try {
          await view.webContents.executeJavaScript(`
            window.scrollTo(${saved.scrollPosition.x}, ${saved.scrollPosition.y});
          `);
        } catch {
          // Best effort only.
        }
      }
    }

    return view;
  }

  private async restoreSession(): Promise<void> {
    try {
      const savedTabs = this.database.getAllTabStates().slice(0, this.maxTabs);
      if (savedTabs.length > 0) {
        this.activeTabId = savedTabs[0].id;
      }
      for (const savedTab of savedTabs) {
        const metadata: BrowserTab = {
          id: savedTab.id,
          url: savedTab.url,
          title: savedTab.title,
          favicon: savedTab.favicon,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          createdAt: savedTab.createdAt,
          lastAccessedAt: savedTab.lastAccessedAt,
        };
        this.tabMetadata.set(savedTab.id, metadata);
        this.tabs.set(savedTab.id, null);
        this.emit('tab-created', { tabId: savedTab.id, metadata });
      }
    } catch (error) {
      console.error('Failed to restore session:', error);
    }
  }

  private async destroyTab(tabId: string, options?: { removeState?: boolean }): Promise<void> {
    await this.disconnectCDP(tabId).catch(() => {});

    const view = this.tabs.get(tabId);
    if (view) {
      try {
        this.mainWindow.contentView.removeChildView(view);
      } catch {
        // Ignore teardown races during shutdown.
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.destroy();
      }
    }

    this.tabs.delete(tabId);

    if (options?.removeState !== false) {
      this.tabMetadata.delete(tabId);
      this.database.deleteTabState(tabId);
    }
  }

  private refreshTabMetadata(tabId: string, view: WebContentsView): void {
    const metadata = this.requireTab(tabId);
    metadata.isLoading = false;
    metadata.url = view.webContents.getURL() || metadata.url;
    metadata.title = view.webContents.getTitle() || metadata.title;
    metadata.canGoBack = getCanGoBack(view.webContents);
    metadata.canGoForward = getCanGoForward(view.webContents);
    metadata.lastAccessedAt = Date.now();
    void this.persistTabState(tabId);
    this.emit('tab-loading', { tabId, isLoading: false });
    this.emit('tab-url-updated', { tabId, url: metadata.url });
  }

  private findTabIdByWebContents(webContents: WebContents): string | null {
    for (const [tabId, view] of this.tabs.entries()) {
      if (view?.webContents.id === webContents.id) {
        return tabId;
      }
    }
    return null;
  }

  private handleDownload(item: DownloadItem, webContents: WebContents): void {
    const tabId = this.findTabIdByWebContents(webContents);
    const fileName = item.getFilename();
    const targetDir = path.join(app.getPath('downloads'), 'Lumos Browser');
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, fileName);
    item.setSavePath(targetPath);

    const replay = Array.from(this.replayRuns.values()).find((entry) => entry.tabId === tabId);
    let pendingDownload: Promise<void> | null = null;
    let resolvePendingDownload: (() => void) | null = null;
    if (replay) {
      pendingDownload = new Promise<void>((resolve) => {
        resolvePendingDownload = resolve;
      });
      replay.pendingDownloads.add(pendingDownload);
    }

    this.recordContextEvent({
      tabId: tabId || undefined,
      pageId: tabId || undefined,
      type: 'download',
      summary: `Started download ${fileName}`,
      url: sanitizeUrl(item.getURL()),
      createdAt: Date.now(),
      metadata: { path: targetPath, state: 'started' },
    });
    this.emit('download-created', { tabId, fileName, path: targetPath });

    item.on('updated', (_event, state) => {
      this.emit('download-updated', {
        tabId,
        fileName,
        path: targetPath,
        state,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      });
    });

    item.once('done', (_event, state) => {
      if (replay && state === 'completed') {
        replay.downloadedFiles.push(targetPath);
      }
      if (replay && pendingDownload) {
        replay.pendingDownloads.delete(pendingDownload);
      }
      resolvePendingDownload?.();
      this.recordContextEvent({
        tabId: tabId || undefined,
        pageId: tabId || undefined,
        type: 'download',
        summary: `${state === 'completed' ? 'Downloaded' : 'Download ended'} ${fileName}`,
        url: sanitizeUrl(item.getURL()),
        createdAt: Date.now(),
        metadata: { path: targetPath, state },
      });
      this.emit('download-updated', { tabId, fileName, path: targetPath, state, done: true });
    });
  }

  private async waitForReplayDownloads(replayState: WorkflowReplayState, timeoutMs: number): Promise<void> {
    await sleep(300);

    if (replayState.pendingDownloads.size === 0) {
      return;
    }

    await Promise.race([
      Promise.allSettled(Array.from(replayState.pendingDownloads)),
      sleep(timeoutMs),
    ]);
  }

  private recordContextEvent(event: BrowserContextEvent): void {
    if (!this.captureSettings.enabled || this.captureSettings.paused) {
      return;
    }

    const saved = this.database.addContextEvent({
      ...event,
      url: sanitizeUrl(event.url),
      title: sanitizeText(event.title),
      summary: sanitizeText(event.summary, 260) || 'Browser event',
      metadata: event.metadata ? { ...event.metadata } : undefined,
    });
    this.emit('context-updated', { event: saved });
  }

  private async requireView(tabId: string): Promise<WebContentsView> {
    const metadata = this.requireTab(tabId);
    let view = this.tabs.get(tabId);
    if (!view) {
      metadata.lastAccessedAt = Date.now();
      view = await this.restoreTab(tabId);
    }
    return view;
  }

  private requireTab(tabId: string): BrowserTab {
    const metadata = this.tabMetadata.get(tabId);
    if (!metadata) {
      throw new Error(`Tab ${tabId} not found`);
    }
    return metadata;
  }

  private async ensureTabReady(tabId: string): Promise<void> {
    await this.switchTab(tabId);
    if (!this.isCDPConnected(tabId)) {
      await this.connectCDP(tabId);
    }
    await this.sendCDPCommand(tabId, 'Runtime.enable');
    await this.sendCDPCommand(tabId, 'Page.enable');
    await this.sendCDPCommand(tabId, 'DOM.enable');
  }

  private async evalInTab(tabId: string, expression: string, awaitPromise: boolean = true): Promise<unknown> {
    const result = (await this.sendCDPCommand(tabId, 'Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    return result?.result?.value;
  }

  private async readPageRuntimeState(tabId: string): Promise<PageRuntimeState | null> {
    try {
      const value = (await this.evalInTab(tabId, buildPageRuntimeStateScript(), true)) as Partial<PageRuntimeState> | undefined;
      return {
        readyState: typeof value?.readyState === 'string' ? value.readyState : 'loading',
        hasBody: Boolean(value?.hasBody),
        textLength: typeof value?.textLength === 'number' ? value.textLength : 0,
        title: typeof value?.title === 'string' ? value.title : '',
        url: typeof value?.url === 'string' ? value.url : '',
      };
    } catch {
      return null;
    }
  }

  private async waitForPageSettled(tabId: string, timeoutMs: number, requireText: boolean = false): Promise<void> {
    await this.ensureTabReady(tabId);
    const startedAt = Date.now();
    let stableSince = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const metadata = this.tabMetadata.get(tabId);
      const state = await this.readPageRuntimeState(tabId);
      const ready =
        !metadata?.isLoading
        && (state?.readyState === 'interactive' || state?.readyState === 'complete')
        && Boolean(state?.hasBody)
        && (!requireText || Boolean(state?.title) || (state?.textLength || 0) > 20);

      if (ready) {
        if (!stableSince) {
          stableSince = Date.now();
        }
        if (Date.now() - stableSince > 450) {
          return;
        }
      } else {
        stableSince = 0;
      }

      await sleep(250);
    }
  }

  private async resolveTabId(requestedTabId?: string, createIfMissing: boolean = false): Promise<string> {
    if (requestedTabId && this.tabMetadata.has(requestedTabId)) {
      return requestedTabId;
    }
    if (this.activeTabId && this.tabMetadata.has(this.activeTabId)) {
      return this.activeTabId;
    }
    const first = this.getTabs()[0];
    if (first) {
      return first.id;
    }
    if (createIfMissing) {
      const tabId = await this.createTab('about:blank');
      await this.switchTab(tabId);
      return tabId;
    }
    throw new Error('No browser tab is available');
  }

  private async resolveReplayTabId(workflow: BrowserWorkflow, options?: WorkflowReplayOptions): Promise<string> {
    if (options?.tabId && this.tabMetadata.has(options.tabId)) {
      return options.tabId;
    }
    if (this.activeTabId && this.tabMetadata.has(this.activeTabId)) {
      return this.activeTabId;
    }
    if (workflow.startUrl) {
      return this.createTab(workflow.startUrl);
    }
    return this.resolveTabId(undefined, true);
  }

  private async installRecordingHooks(tabId: string): Promise<void> {
    await this.ensureTabReady(tabId);
    await this.evalInTab(tabId, buildWorkflowRecorderScript(), true);
  }

  private async uninstallRecordingHooks(tabId: string): Promise<void> {
    try {
      await this.evalInTab(
        tabId,
        `(() => { if (window.__lumosWorkflowRecorderCleanup) window.__lumosWorkflowRecorderCleanup(); return true; })()`,
        true,
      );
    } catch {
      // Ignore teardown failures.
    }
  }

  private handleRecordingConsoleEvent(tabId: string, payload: RecorderConsoleEvent): void {
    if (!this.recording || this.recording.tabId !== tabId) {
      return;
    }

    if (payload.type === 'click') {
      if (!payload.selector && !payload.text) {
        return;
      }
      this.recording.steps.push({
        id: createId('wf-step'),
        type: 'click',
        label: sanitizeText(payload.text) || 'Click page element',
        selector: payload.selector,
        text: sanitizeText(payload.text),
      });
    }

    if (payload.type === 'input') {
      const label = sanitizeText(payload.label || payload.text) || 'Fill field';
      const value = typeof payload.value === 'string' ? payload.value : '';
      let paramRef: string | undefined;
      let storedValue: string | undefined = value;

      if (payload.masked || SENSITIVE_FIELD_RE.test(label)) {
        paramRef = this.ensureRecordingParameter(label, true);
        storedValue = undefined;
      }

      this.recording.steps.push({
        id: createId('wf-step'),
        type: 'input',
        label,
        selector: payload.selector,
        text: sanitizeText(payload.text || payload.label),
        value: storedValue,
        paramRef,
        metadata: {
          masked: Boolean(payload.masked),
          inputType: payload.inputType || 'text',
        },
      });
    }

    this.emit('recording-updated', this.getRecordingState());
  }

  private ensureRecordingParameter(label: string, secret: boolean): string {
    if (!this.recording) {
      throw new Error('Recording is not active');
    }

    const normalized = slugify(label, `param-${this.recording.parameters.size + 1}`);
    const existing = Array.from(this.recording.parameters.values()).find((item) => item.name === normalized);
    if (existing) {
      return existing.name;
    }

    const parameter: BrowserWorkflowParameter = {
      id: createId('wf-param'),
      name: normalized,
      label,
      required: true,
      secret,
      description: secret ? 'Provide this value before replaying the workflow.' : undefined,
    };
    this.recording.parameters.set(parameter.id, parameter);
    return parameter.name;
  }

  private resolveWorkflowVariables(
    workflow: BrowserWorkflow,
    provided?: Record<string, string>,
  ): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const parameter of workflow.parameters) {
      const providedValue = provided?.[parameter.name];
      const value = typeof providedValue === 'string' && providedValue.length > 0
        ? providedValue
        : parameter.defaultValue || '';
      if (parameter.required && !value) {
        throw new Error(`Missing required workflow parameter: ${parameter.label || parameter.name}`);
      }
      variables[parameter.name] = value;
    }
    return variables;
  }

  private async runWorkflowStep(
    tabId: string,
    step: BrowserWorkflowStep,
    variables: Record<string, string>,
    replayState: WorkflowReplayState,
  ): Promise<void> {
    switch (step.type) {
      case 'navigate': {
        const targetUrl = normalizeUrl(resolveTemplate(step.url, variables));
        await this.navigate(tabId, { url: targetUrl });
        await this.waitForPageSettled(tabId, step.timeoutMs || 12_000);
        return;
      }
      case 'back':
        await this.goBack(tabId);
        return;
      case 'forward':
        await this.goForward(tabId);
        return;
      case 'reload':
        await this.reload(tabId);
        return;
      case 'click': {
        await this.ensureTabReady(tabId);
        const result = (await this.evalInTab(
          tabId,
          buildClickStepScript(step, resolveTemplate(step.text, variables)),
          true,
        )) as { ok?: boolean; error?: string } | undefined;
        if (!result?.ok) {
          throw new Error(result?.error || `Failed to click "${step.label}"`);
        }
        await this.waitForPageSettled(tabId, step.timeoutMs || 8_000);
        return;
      }
      case 'input': {
        const value = step.paramRef ? variables[step.paramRef] : resolveTemplate(step.value, variables);
        await this.ensureTabReady(tabId);
        const result = (await this.evalInTab(
          tabId,
          buildInputStepScript(step, value || '', resolveTemplate(step.text, variables)),
          true,
        )) as { ok?: boolean; error?: string } | undefined;
        if (!result?.ok) {
          throw new Error(result?.error || `Failed to fill "${step.label}"`);
        }
        return;
      }
      case 'keypress': {
        await this.ensureTabReady(tabId);
        const result = (await this.evalInTab(tabId, buildKeypressStepScript(step.key || 'Enter'), true)) as
          | { ok?: boolean; error?: string }
          | undefined;
        if (!result?.ok) {
          throw new Error(result?.error || `Failed to press "${step.key || 'Enter'}"`);
        }
        await this.waitForPageSettled(tabId, step.timeoutMs || 8_000);
        return;
      }
      case 'wait': {
        const expectedText = resolveTemplate(step.waitForText || step.text || '', variables);
        const timeoutMs = step.timeoutMs || 10_000;
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          await this.ensureTabReady(tabId);
          const result = (await this.evalInTab(tabId, buildWaitForTextScript(expectedText), true)) as
            | { found?: boolean }
            | undefined;
          if (result?.found) {
            return;
          }
          await sleep(250);
        }
        throw new Error(`Timed out waiting for "${expectedText}"`);
      }
      case 'screenshot': {
        const filePath = await this.captureWorkflowScreenshot(tabId, resolveTemplate(step.screenshotName, variables) || step.label);
        replayState.screenshots.push(filePath);
        return;
      }
      default:
        throw new Error(`Unsupported workflow step: ${String(step.type)}`);
    }
  }

  private async captureWorkflowScreenshot(tabId: string, label?: string): Promise<string> {
    await this.ensureTabReady(tabId);
    const targetDir = path.join(app.getPath('downloads'), 'Lumos Browser', 'screenshots');
    fs.mkdirSync(targetDir, { recursive: true });
    const filePath = path.join(targetDir, `${slugify(label || 'screenshot', 'screenshot')}-${Date.now()}.png`);
    const result = (await this.sendCDPCommand(tabId, 'Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    })) as { data?: string };
    if (!result?.data) {
      throw new Error('Failed to capture screenshot');
    }
    fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
    return filePath;
  }

  private async captureExtractionSnapshot(tabId: string): Promise<{ url?: string; title?: string; textPreview?: string } | null> {
    await this.ensureTabReady(tabId);
    const value = (await this.evalInTab(tabId, buildSnapshotExtractionScript(), true)) as
      | { url?: string; title?: string; textPreview?: string }
      | undefined;
    return value || null;
  }

  emitAiActivity(activity: Omit<BrowserAiActivity, 'id' | 'startedAt'> & { status?: BrowserAiActivity['status'] }): BrowserAiActivity {
    const payload: BrowserAiActivity = {
      id: createId('ai-activity'),
      action: activity.action,
      details: activity.details,
      pageId: activity.pageId,
      status: activity.status || 'running',
      startedAt: Date.now(),
    };
    this.emit('ai-activity', payload);
    this.recordContextEvent({
      tabId: activity.pageId,
      pageId: activity.pageId,
      type: 'ai',
      summary: payload.action,
      url: sanitizeUrl(this.tabMetadata.get(activity.pageId || '')?.url),
      createdAt: Date.now(),
      metadata: { status: payload.status, details: payload.details },
    });
    return payload;
  }

  finishAiActivity(activity: BrowserAiActivity, status: BrowserAiActivity['status'], details?: string): void {
    this.emit('ai-activity', {
      ...activity,
      status,
      details: details || activity.details,
      finishedAt: Date.now(),
    });
  }
}
