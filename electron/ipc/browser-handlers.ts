/**
 * Browser IPC Handlers
 * 处理渲染进程与浏览器管理器之间的通信
 */

import { ipcMain, BrowserWindow } from 'electron';
import { BrowserManager } from '../browser/browser-manager';

export function setupBrowserIPC(browserManager: BrowserManager): void {
  // 创建标签页
  ipcMain.handle('browser:create-tab', async (_event, url?: string) => {
    try {
      const tabId = await browserManager.createTab(url);
      return { success: true, tabId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 关闭标签页
  ipcMain.handle('browser:close-tab', async (_event, tabId: string) => {
    try {
      await browserManager.closeTab(tabId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 切换标签页
  ipcMain.handle('browser:switch-tab', async (_event, tabId: string) => {
    try {
      await browserManager.switchTab(tabId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 获取所有标签页
  ipcMain.handle('browser:get-tabs', async () => {
    try {
      const tabs = browserManager.getTabs();
      const activeTabId = browserManager.getActiveTabId();
      return { success: true, tabs, activeTabId };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 导航
  ipcMain.handle('browser:navigate', async (_event, tabId: string, url: string, timeout?: number) => {
    try {
      await browserManager.navigate(tabId, { url, timeout });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 获取 Cookies
  ipcMain.handle('browser:get-cookies', async (_event, filter?: any) => {
    try {
      const cookies = await browserManager.getCookies(filter);
      return { success: true, cookies };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 设置 Cookie
  ipcMain.handle('browser:set-cookie', async (_event, cookie: Electron.CookiesSetDetails) => {
    try {
      await browserManager.setCookie(cookie);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // CDP 连接
  ipcMain.handle('browser:connect-cdp', async (_event, tabId: string) => {
    try {
      await browserManager.connectCDP(tabId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // CDP 断开
  ipcMain.handle('browser:disconnect-cdp', async (_event, tabId: string) => {
    try {
      await browserManager.disconnectCDP(tabId);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // CDP 发送命令
  ipcMain.handle('browser:send-cdp-command', async (_event, tabId: string, method: string, params?: any) => {
    try {
      const result = await browserManager.sendCDPCommand(tabId, method, params);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // CDP 连接状态
  ipcMain.handle('browser:is-cdp-connected', async (_event, tabId: string) => {
    try {
      const connected = browserManager.isCDPConnected(tabId);
      return { success: true, connected };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 监听浏览器事件并转发到渲染进程
  const forwardEvent = (eventName: string, data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send('browser:event', eventName, data);
    });
  };

  browserManager.on('tab-created', (data) => forwardEvent('tab-created', data));
  browserManager.on('tab-closed', (data) => forwardEvent('tab-closed', data));
  browserManager.on('tab-switched', (data) => forwardEvent('tab-switched', data));
  browserManager.on('tab-loaded', (data) => forwardEvent('tab-loaded', data));
  browserManager.on('tab-loading', (data) => forwardEvent('tab-loading', data));
  browserManager.on('tab-title-updated', (data) => forwardEvent('tab-title-updated', data));
  browserManager.on('tab-favicon-updated', (data) => forwardEvent('tab-favicon-updated', data));
  browserManager.on('tab-error', (data) => forwardEvent('tab-error', data));
  browserManager.on('share-to-ai', (data) => forwardEvent('share-to-ai', data));
}
