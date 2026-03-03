/**
 * Browser Integration Example
 * 展示如何集成所有浏览器模块
 */

import { BrowserWindow } from 'electron';
import { BrowserManager } from './browser/browser-manager';
import { CookieEncryptionManager } from './browser/cookie-encryption';
import { MCPCookiePermissionManager } from './browser/mcp-cookie-permission';
import { CookieSyncManager } from './browser/cookie-sync';
import { MCPEnvironmentManager } from './browser/mcp-environment';
import { setupBrowserIPC } from './ipc/browser-handlers';

export class BrowserIntegration {
  private browserManager: BrowserManager;
  private cookieEncryption: CookieEncryptionManager;
  private cookiePermission: MCPCookiePermissionManager;
  private cookieSync: CookieSyncManager;
  private mcpEnvironment: MCPEnvironmentManager;

  constructor(mainWindow: BrowserWindow) {
    // 初始化 BrowserManager
    this.browserManager = new BrowserManager(mainWindow, {
      maxTabs: 10,
      maxActiveViews: 3,
      sessionPartition: 'persist:lumos-browser',
    });

    // 初始化 Cookie 管理模块
    this.cookieEncryption = new CookieEncryptionManager();
    this.cookiePermission = new MCPCookiePermissionManager();
    this.cookieSync = new CookieSyncManager(
      'persist:lumos-browser',
      this.cookieEncryption,
      this.cookiePermission
    );
    this.mcpEnvironment = new MCPEnvironmentManager(this.cookieSync);

    // 设置 IPC handlers
    setupBrowserIPC(this.browserManager);

    // 设置 MCP Cookie 监听（示例）
    this.setupMCPCookieWatches();
  }

  /**
   * 设置 MCP Cookie 监听
   */
  private setupMCPCookieWatches(): void {
    // 示例：为 chrome-devtools MCP 设置 bilibili.com 的 SESSDATA 监听
    try {
      // 1. 授予权限
      this.cookiePermission.grantPermission('chrome-devtools', 'bilibili.com', 'system');

      // 2. 注册监听
      this.mcpEnvironment.registerCookieWatch('chrome-devtools', '.bilibili.com', 'SESSDATA');

      console.log('MCP cookie watch configured for chrome-devtools');
    } catch (error) {
      console.error('Failed to setup MCP cookie watch:', error);
    }
  }

  /**
   * 获取 MCP 环境变量（用于启动 MCP 服务器）
   */
  getMCPEnvironment(mcpName: string): Record<string, string> {
    return this.mcpEnvironment.getMCPEnvironment(mcpName);
  }

  /**
   * 清理所有资源
   */
  async cleanup(): Promise<void> {
    this.cookieSync.stop();
    await this.browserManager.cleanup();
    this.cookieEncryption.close();
    this.cookiePermission.close();
  }
}

// 使用示例：
// const browserIntegration = new BrowserIntegration(mainWindow);
// const mcpEnv = browserIntegration.getMCPEnvironment('chrome-devtools');
// // mcpEnv 现在包含 { BILIBILI_SESSDATA: '...' }
