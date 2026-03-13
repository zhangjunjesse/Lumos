/**
 * Browser IPC Handlers
 * 处理渲染进程与浏览器管理器之间的通信
 */

import { ipcMain, BrowserWindow } from 'electron';
import { BrowserManager, type BrowserDisplayTarget } from '../browser/browser-manager';
import type { BrowserWorkflow } from '../../src/types/browser';

const browserEventNames = [
  'tab-created',
  'tab-closed',
  'tab-switched',
  'tab-loaded',
  'tab-loading',
  'tab-url-updated',
  'tab-title-updated',
  'tab-favicon-updated',
  'tab-error',
  'share-to-ai',
  'download-created',
  'download-updated',
  'ai-activity',
  'context-updated',
  'capture-settings-updated',
  'recording-updated',
  'workflows-updated',
] as const;

type BrowserEventName = (typeof browserEventNames)[number];

let ipcHandlersRegistered = false;
let boundManager: BrowserManager | null = null;
let unbindManagerEvents: (() => void) | null = null;

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidDisplayTarget(target: unknown): target is BrowserDisplayTarget {
  return target === 'default' || target === 'panel' || target === 'hidden';
}

function bindBrowserManagerEvents(
  getBrowserManager: () => BrowserManager | null,
  forwardEvent: (eventName: BrowserEventName, data: unknown) => void
): void {
  const manager = getBrowserManager();
  if (manager === boundManager) {
    return;
  }

  if (unbindManagerEvents) {
    unbindManagerEvents();
    unbindManagerEvents = null;
  }

  boundManager = manager;
  if (!manager) {
    return;
  }

  const listeners: Array<{ eventName: BrowserEventName; listener: (data: unknown) => void }> = [];

  for (const eventName of browserEventNames) {
    const listener = (data: unknown) => forwardEvent(eventName, data);
    manager.on(eventName, listener);
    listeners.push({ eventName, listener });
  }

  unbindManagerEvents = () => {
    for (const { eventName, listener } of listeners) {
      manager.off(eventName, listener);
    }
  };
}

export function setupBrowserIPC(getBrowserManager: () => BrowserManager | null): void {
  const forwardEvent = (eventName: BrowserEventName, data: unknown) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(window => {
      window.webContents.send('browser:event', eventName, data);
    });
  };

  bindBrowserManagerEvents(getBrowserManager, forwardEvent);
  if (ipcHandlersRegistered) {
    return;
  }
  ipcHandlersRegistered = true;

  const withManager = <T>(fn: (manager: BrowserManager) => Promise<T>) => {
    return async (): Promise<T> => {
      bindBrowserManagerEvents(getBrowserManager, forwardEvent);
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      return fn(manager);
    };
  };

  // 创建标签页
  ipcMain.handle('browser:create-tab', async (_event, url?: string) => {
    try {
      const tabId = await withManager((manager) => manager.createTab(url))();
      return { success: true, tabId };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // 关闭标签页
  ipcMain.handle('browser:close-tab', async (_event, tabId: string) => {
    try {
      await withManager((manager) => manager.closeTab(tabId))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // 切换标签页
  ipcMain.handle('browser:switch-tab', async (_event, tabId: string) => {
    try {
      await withManager((manager) => manager.switchTab(tabId))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // 获取所有标签页
  ipcMain.handle('browser:get-tabs', async () => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      const tabs = manager.getTabs();
      const activeTabId = manager.getActiveTabId();
      return { success: true, tabs, activeTabId };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // 导航
  ipcMain.handle('browser:navigate', async (_event, tabId: string, url: string, timeout?: number) => {
    try {
      await withManager((manager) => manager.navigate(tabId, { url, timeout }))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:go-back', async (_event, tabId: string) => {
    try {
      await withManager((manager) => manager.goBack(tabId))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:go-forward', async (_event, tabId: string) => {
    try {
      await withManager((manager) => manager.goForward(tabId))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:reload', async (_event, tabId: string) => {
    try {
      await withManager((manager) => manager.reload(tabId))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:stop', async (_event, tabId: string) => {
    try {
      await withManager((manager) => manager.stop(tabId))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // 设置缩放
  ipcMain.handle('browser:set-zoom-factor', async (_event, tabId: string, zoomFactor: number) => {
    try {
      await withManager((manager) => manager.setZoomFactor(tabId, zoomFactor))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // 获取 Cookies
  ipcMain.handle('browser:get-cookies', async (_event, filter?: Electron.CookiesGetFilter) => {
    try {
      const cookies = await withManager((manager) => manager.getCookies(filter))();
      return { success: true, cookies };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // 设置 Cookie
  ipcMain.handle('browser:set-cookie', async (_event, cookie: Electron.CookiesSetDetails) => {
    try {
      await withManager((manager) => manager.setCookie(cookie))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // CDP 连接
  ipcMain.handle('browser:connect-cdp', async (_event, tabId: string) => {
    try {
      await withManager((manager) => manager.connectCDP(tabId))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // CDP 断开
  ipcMain.handle('browser:disconnect-cdp', async (_event, tabId: string) => {
    try {
      await withManager((manager) => manager.disconnectCDP(tabId))();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  // CDP 发送命令
  ipcMain.handle(
    'browser:send-cdp-command',
    async (_event, tabId: string, method: string, params?: Record<string, unknown>) => {
      try {
        const result = await withManager((manager) => manager.sendCDPCommand(tabId, method, params))();
        return { success: true, result };
      } catch (error: unknown) {
        return { success: false, error: formatError(error) };
      }
    },
  );

  // CDP 连接状态
  ipcMain.handle('browser:is-cdp-connected', async (_event, tabId: string) => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      const connected = manager.isCDPConnected(tabId);
      return { success: true, connected };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle(
    'browser:set-display-target',
    async (
      _event,
      target: BrowserDisplayTarget,
      bounds?: { x?: number; y?: number; width?: number; height?: number },
    ) => {
      try {
        if (!isValidDisplayTarget(target)) {
          throw new Error(`Invalid browser display target: ${String(target)}`);
        }

        const manager = getBrowserManager();
        if (!manager) throw new Error('Browser manager is not initialized');

        if (target === 'panel') {
          if (
            !bounds
            || typeof bounds.x !== 'number'
            || typeof bounds.y !== 'number'
            || typeof bounds.width !== 'number'
            || typeof bounds.height !== 'number'
          ) {
            throw new Error('Panel bounds are required for target "panel"');
          }

          manager.setDisplayTarget('panel', {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
        } else {
          manager.setDisplayTarget(target);
        }

        return { success: true };
      } catch (error: unknown) {
        return { success: false, error: formatError(error) };
      }
    },
  );

  ipcMain.handle('browser:get-context-events', async (_event, options?: { limit?: number; tabId?: string }) => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      const events = manager.getContextEvents(options);
      return { success: true, events };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:clear-context-events', async () => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      manager.clearContextEvents();
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:get-capture-settings', async () => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      const settings = manager.getCaptureSettings();
      return { success: true, settings };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:update-capture-settings', async (_event, settings?: Record<string, unknown>) => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      const next = manager.updateCaptureSettings({
        enabled: typeof settings?.enabled === 'boolean' ? settings.enabled : undefined,
        paused: typeof settings?.paused === 'boolean' ? settings.paused : undefined,
        retentionDays: typeof settings?.retentionDays === 'number' ? settings.retentionDays : undefined,
        maxEvents: typeof settings?.maxEvents === 'number' ? settings.maxEvents : undefined,
      });
      return { success: true, settings: next };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle(
    'browser:start-recording',
    async (_event, options?: { tabId?: string; workflowName?: string }) => {
      try {
        const recording = await withManager((manager) => manager.startRecording(options))();
        return { success: true, recording };
      } catch (error: unknown) {
        return { success: false, error: formatError(error) };
      }
    },
  );

  ipcMain.handle(
    'browser:stop-recording',
    async (_event, options?: { save?: boolean; workflowName?: string }) => {
      try {
        const workflow = await withManager((manager) => manager.stopRecording(options))();
        return { success: true, workflow: workflow || undefined };
      } catch (error: unknown) {
        return { success: false, error: formatError(error) };
      }
    },
  );

  ipcMain.handle('browser:cancel-recording', async () => {
    try {
      const recording = await withManager((manager) => manager.cancelRecording())();
      return { success: true, recording };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:get-recording-state', async () => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      const recording = manager.getRecordingState();
      return { success: true, recording };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:get-workflows', async () => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      const workflows = manager.getWorkflows();
      return { success: true, workflows };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:save-workflow', async (_event, workflow: BrowserWorkflow) => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      const saved = manager.saveWorkflow(workflow);
      return { success: true, workflow: saved };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('browser:delete-workflow', async (_event, workflowId: string) => {
    try {
      const manager = getBrowserManager();
      if (!manager) throw new Error('Browser manager is not initialized');
      manager.deleteWorkflow(workflowId);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle(
    'browser:replay-workflow',
    async (_event, workflowId: string, options?: { tabId?: string; parameters?: Record<string, string> }) => {
      try {
        const result = await withManager((manager) => manager.replayWorkflow(workflowId, options))();
        return { success: true, result };
      } catch (error: unknown) {
        return { success: false, error: formatError(error) };
      }
    },
  );
}
