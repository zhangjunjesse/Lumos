/**
 * BrowserManager - 管理内置浏览器的 WebContentsView 生命周期
 *
 * 功能：
 * - 创建和管理多个标签页（WebContentsView）
 * - 标签页切换和导航
 * - Cookie 管理
 * - 历史记录
 * - LRU 淘汰机制
 */

import { BaseWindow, BrowserWindow, WebContentsView, session } from 'electron';
import { EventEmitter } from 'events';
import { CDPManager } from './cdp-manager';
import { getPlatformLayout } from './platform-layout';
import { setupBrowserContextMenu } from './context-menu';
import { BrowserDatabase } from './browser-database';

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

export interface BrowserManagerOptions {
  maxTabs?: number;
  maxActiveViews?: number;
  sessionPartition?: string;
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
    // Keep browser views hidden until a concrete host (full browser page or right panel)
    // explicitly requests them. This prevents MCP-driven tab switches from overlaying
    // the main Lumos UI before the panel is mounted and measured.
    this.displayTarget = 'hidden';
    this.panelBounds = null;

    // 监听窗口大小变化
    this.setupWindowListeners();

    // 恢复上次会话的标签页
    this.restoreSession();
  }

  /**
   * 设置窗口监听器
   */
  private setupWindowListeners(): void {
    this.mainWindow.on('resize', () => {
      this.handleWindowResize();
    });

    this.mainWindow.on('maximize', () => {
      this.handleWindowResize();
    });

    this.mainWindow.on('unmaximize', () => {
      this.handleWindowResize();
    });

    this.mainWindow.on('enter-full-screen', () => {
      this.handleWindowResize();
    });

    this.mainWindow.on('leave-full-screen', () => {
      this.handleWindowResize();
    });
  }

  /**
   * 处理窗口大小变化
   */
  private handleWindowResize(): void {
    if (!this.activeTabId) {
      return;
    }

    const view = this.tabs.get(this.activeTabId);
    if (view) {
      view.setBounds(this.calculateBounds());
    }
  }

  /**
   * 设置浏览器显示目标
   * - default: 主窗口默认浏览器区域
   * - panel: 渲染到指定面板区域
   * - hidden: 完全隐藏 WebContentsView
   */
  setDisplayTarget(target: BrowserDisplayTarget, bounds?: BrowserBounds): void {
    this.displayTarget = target;

    if (target === 'panel') {
      this.panelBounds = bounds ? this.normalizeBounds(bounds) : null;
    } else if (target !== 'panel') {
      this.panelBounds = null;
    }

    this.handleWindowResize();
  }

  /**
   * 创建新标签页
   */
  async createTab(url?: string): Promise<string> {
    if (this.tabs.size >= this.maxTabs) {
      throw new Error(`Maximum tab limit (${this.maxTabs}) reached`);
    }

    const tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {
      // 检查是否需要淘汰旧标签
      await this.evictIfNeeded();

      const view = new WebContentsView({
        webPreferences: {
          partition: this.sessionPartition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });

      // 设置初始边界（隐藏状态）
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

      if (url) {
        await this.navigate(tabId, { url });
      }

      this.emit('tab-created', { tabId, metadata });
      return tabId;
    } catch (error) {
      this.tabs.delete(tabId);
      this.tabMetadata.delete(tabId);
      throw new Error(`Failed to create tab: ${error.message}`);
    }
  }

  /**
   * 切换到指定标签页
   */
  async switchTab(tabId: string): Promise<void> {
    if (this.activeTabId === tabId) {
      return;
    }

    const metadata = this.tabMetadata.get(tabId);
    if (!metadata) {
      throw new Error(`Tab ${tabId} not found`);
    }

    let view = this.tabs.get(tabId);

    // 如果 view 被淘汰了，需要恢复
    if (!view) {
      view = await this.restoreTab(tabId);
    }

    // 隐藏当前标签
    if (this.activeTabId) {
      const currentView = this.tabs.get(this.activeTabId);
      if (currentView) {
        currentView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }

    // 显示新标签
    const bounds = this.calculateBounds();
    view.setBounds(bounds);
    view.webContents.focus();

    this.activeTabId = tabId;
    metadata.lastAccessedAt = Date.now();

    this.emit('tab-switched', { tabId, metadata });
  }

  /**
   * 导航到指定 URL
   */
  async navigate(tabId: string, options: NavigationOptions): Promise<void> {
    const view = this.tabs.get(tabId);
    const metadata = this.tabMetadata.get(tabId);

    if (!view || !metadata) {
      throw new Error(`Tab ${tabId} not found`);
    }

    const timeout = options.timeout || 30000;
    const waitUntil = options.waitUntil || 'load';

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
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

      view.webContents.loadURL(options.url).catch((error) => {
        cleanup();
        reject(error);
      });
    });
  }

  /**
   * 设置标签页缩放比例
   */
  async setZoomFactor(tabId: string, zoomFactor: number): Promise<void> {
    const view = this.tabs.get(tabId);
    if (!view) {
      throw new Error(`Tab ${tabId} not found`);
    }

    const normalized = Math.max(0.25, Math.min(5, zoomFactor));
    view.webContents.setZoomFactor(normalized);
  }

  /**
   * 关闭标签页
   */
  async closeTab(tabId: string): Promise<void> {
    const view = this.tabs.get(tabId);

    if (!view && !this.tabMetadata.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }

    try {
      // 如果是当前标签，切换到其他标签
      if (this.activeTabId === tabId) {
        const remainingTabs = Array.from(this.tabs.keys()).filter(id => id !== tabId);
        if (remainingTabs.length > 0) {
          await this.switchTab(remainingTabs[0]);
        } else {
          this.activeTabId = null;
        }
      }

      if (view) {
        this.mainWindow.contentView.removeChildView(view);
        view.webContents.destroy();
      }

      this.tabs.delete(tabId);
      this.tabMetadata.delete(tabId);

      this.emit('tab-closed', { tabId });
    } catch (error) {
      throw new Error(`Failed to close tab: ${error.message}`);
    }
  }

  /**
   * 获取所有标签页
   */
  getTabs(): BrowserTab[] {
    return Array.from(this.tabMetadata.values())
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  /**
   * 获取当前活跃标签 ID
   */
  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  /**
   * 连接 CDP 到指定标签页
   */
  async connectCDP(tabId: string): Promise<void> {
    const view = this.tabs.get(tabId);
    if (!view) {
      throw new Error(`Tab ${tabId} not found or not active`);
    }

    try {
      await this.cdpManager.attach(tabId, view.webContents);
      this.emit('cdp-connected', { tabId });
    } catch (error) {
      throw new Error(`Failed to connect CDP: ${error.message}`);
    }
  }

  /**
   * 断开 CDP 连接
   */
  async disconnectCDP(tabId: string): Promise<void> {
    try {
      await this.cdpManager.detach(tabId);
      this.emit('cdp-disconnected', { tabId });
    } catch (error) {
      throw new Error(`Failed to disconnect CDP: ${error.message}`);
    }
  }

  /**
   * 发送 CDP 命令
   */
  async sendCDPCommand(tabId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await this.cdpManager.sendCommand(tabId, { method, params });
      if (response.error) {
        throw new Error(response.error.message);
      }
      return response.result;
    } catch (error) {
      throw new Error(`CDP command failed: ${error.message}`);
    }
  }

  /**
   * 获取 CDP 连接状态
   */
  isCDPConnected(tabId: string): boolean {
    return this.cdpManager.isAttached(tabId);
  }

  /**
   * 获取 Cookies
   */
  async getCookies(filter?: Electron.CookiesGetFilter): Promise<Electron.Cookie[]> {
    const ses = session.fromPartition(this.sessionPartition);

    try {
      if (filter) {
        return await ses.cookies.get(filter);
      }
      return await ses.cookies.get({});
    } catch (error) {
      throw new Error(`Failed to get cookies: ${error.message}`);
    }
  }

  /**
   * 设置 Cookie
   */
  async setCookie(cookie: Electron.CookiesSetDetails): Promise<void> {
    const ses = session.fromPartition(this.sessionPartition);

    try {
      await ses.cookies.set(cookie);
    } catch (error) {
      throw new Error(`Failed to set cookie: ${error.message}`);
    }
  }

  /**
   * 清理所有标签页
   */
  async cleanup(): Promise<void> {
    const tabIds = Array.from(this.tabs.keys());

    // 保存所有标签页状态
    for (const tabId of tabIds) {
      try {
        await this.saveTabState(tabId);
      } catch (error) {
        console.error(`Failed to save tab state ${tabId}:`, error);
      }
    }

    // 关闭所有标签页
    for (const tabId of tabIds) {
      try {
        await this.closeTab(tabId);
      } catch (error) {
        console.error(`Failed to close tab ${tabId}:`, error);
      }
    }

    await this.cdpManager.cleanup();
    this.database.close();
  }

  // 私有方法

  private setupViewListeners(tabId: string, view: WebContentsView): void {
    const metadata = this.tabMetadata.get(tabId)!;

    view.webContents.on('did-start-loading', () => {
      metadata.isLoading = true;
      this.emit('tab-loading', { tabId, isLoading: true });
    });

    view.webContents.on('did-finish-load', () => {
      metadata.isLoading = false;
      metadata.url = view.webContents.getURL();
      metadata.title = view.webContents.getTitle();
      metadata.canGoBack = view.webContents.canGoBack();
      metadata.canGoForward = view.webContents.canGoForward();

      this.emit('tab-loaded', { tabId, metadata });
    });

    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      metadata.isLoading = false;
      this.emit('tab-error', { tabId, errorCode, errorDescription });
    });

    view.webContents.on('page-title-updated', (_event, title) => {
      metadata.title = title;
      this.emit('tab-title-updated', { tabId, title });
    });

    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      metadata.favicon = favicons[0];
      this.emit('tab-favicon-updated', { tabId, favicon: favicons[0] });
    });
  }

  private setupContextMenu(tabId: string, view: WebContentsView): void {
    setupBrowserContextMenu(view, {
      onShareToAI: (content, type) => {
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

  private getTitleBarHeight(): number {
    return getPlatformLayout().titleBarHeight;
  }

  private async evictIfNeeded(): Promise<void> {
    const activeViews = Array.from(this.tabs.values()).filter(v => v !== null);

    if (activeViews.length >= this.maxActiveViews) {
      // 找到最久未使用的非固定标签
      const candidates = Array.from(this.tabMetadata.values())
        .filter(tab => {
          const view = this.tabs.get(tab.id);
          return view !== null && !tab.isPinned && tab.id !== this.activeTabId;
        })
        .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

      if (candidates.length > 0) {
        const victim = candidates[0];
        await this.saveTabState(victim.id);

        const view = this.tabs.get(victim.id);
        if (view) {
          this.mainWindow.contentView.removeChildView(view);
          view.webContents.destroy();
          this.tabs.set(victim.id, null);
        }

        console.log(`Evicted tab ${victim.id} (LRU)`);
      }
    }
  }

  private async saveTabState(tabId: string): Promise<void> {
    const metadata = this.tabMetadata.get(tabId);
    if (!metadata) return;

    const view = this.tabs.get(tabId);
    let scrollPosition = { x: 0, y: 0 };

    // 如果 view 还存在，获取滚动位置
    if (view) {
      try {
        const result = await view.webContents.executeJavaScript(`
          JSON.stringify({
            x: window.scrollX,
            y: window.scrollY
          })
        `);
        scrollPosition = JSON.parse(result);
      } catch (error) {
        console.error(`Failed to get scroll position for tab ${tabId}:`, error);
      }
    }

    this.database.saveTabState({
      id: tabId,
      url: metadata.url,
      title: metadata.title,
      favicon: metadata.favicon,
      scrollPosition,
      createdAt: metadata.createdAt,
      lastAccessedAt: metadata.lastAccessedAt,
    });

    console.log(`Saved state for tab ${tabId}`);
  }

  private async restoreTab(tabId: string): Promise<WebContentsView> {
    const metadata = this.tabMetadata.get(tabId);
    if (!metadata) {
      throw new Error(`Tab ${tabId} not found`);
    }

    await this.evictIfNeeded();

    const view = new WebContentsView({
      webPreferences: {
        partition: this.sessionPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    this.mainWindow.contentView.addChildView(view);
    this.tabs.set(tabId, view);

    this.setupViewListeners(tabId, view);
    this.setupContextMenu(tabId, view);

    // 恢复 URL
    if (metadata.url && metadata.url !== 'about:blank') {
      await this.navigate(tabId, { url: metadata.url });

      // 恢复滚动位置
      const savedState = this.database.getTabState(tabId);
      if (savedState?.scrollPosition) {
        try {
          await view.webContents.executeJavaScript(`
            window.scrollTo(${savedState.scrollPosition.x}, ${savedState.scrollPosition.y});
          `);
        } catch (error) {
          console.error(`Failed to restore scroll position for tab ${tabId}:`, error);
        }
      }
    }

    console.log(`Restored tab ${tabId}`);
    return view;
  }

  /**
   * 恢复上次会话的标签页
   */
  private async restoreSession(): Promise<void> {
    try {
      const savedTabs = this.database.getAllTabStates();

      // 只恢复最近的几个标签页（不超过 maxTabs）
      const tabsToRestore = savedTabs.slice(0, this.maxTabs);

      for (const savedTab of tabsToRestore) {
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
        this.tabs.set(savedTab.id, null); // 标记为未加载

        this.emit('tab-created', { tabId: savedTab.id, metadata });
      }

      console.log(`Restored ${tabsToRestore.length} tabs from previous session`);
    } catch (error) {
      console.error('Failed to restore session:', error);
    }
  }
}
