// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  // Expose ipcRenderer.invoke for database IPC calls
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  },
  shell: {
    openPath: (folderPath: string) => ipcRenderer.invoke('shell:open-path', folderPath),
    openExternal: (targetUrl: string) => ipcRenderer.invoke('shell:open-external', targetUrl),
  },
  auth: {
    open: (targetUrl: string) => ipcRenderer.invoke('window:open-auth', targetUrl),
  },
  dialog: {
    openFolder: (options?: { defaultPath?: string; title?: string }) =>
      ipcRenderer.invoke('dialog:open-folder', options),
    openFile: (options?: { defaultPath?: string; title?: string; filters?: Electron.FileFilter[]; multi?: boolean }) =>
      ipcRenderer.invoke('dialog:open-file', options),
  },
  install: {
    checkPrerequisites: () => ipcRenderer.invoke('install:check-prerequisites'),
    start: (options?: { includeNode?: boolean }) => ipcRenderer.invoke('install:start', options),
    cancel: () => ipcRenderer.invoke('install:cancel'),
    getLogs: () => ipcRenderer.invoke('install:get-logs'),
    onProgress: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('install:progress', listener);
      return () => { ipcRenderer.removeListener('install:progress', listener); };
    },
  },
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('updater:download'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
    onStatus: (callback: (data: unknown) => void) => {
      const listener = (_event: unknown, data: unknown) => callback(data);
      ipcRenderer.on('updater:status', listener);
      return () => { ipcRenderer.removeListener('updater:status', listener); };
    },
  },
  browser: {
    createTab: (url?: string) => ipcRenderer.invoke('browser:create-tab', url),
    closeTab: (tabId: string) => ipcRenderer.invoke('browser:close-tab', tabId),
    switchTab: (tabId: string) => ipcRenderer.invoke('browser:switch-tab', tabId),
    getTabs: () => ipcRenderer.invoke('browser:get-tabs'),
    navigate: (tabId: string, url: string, timeout?: number) =>
      ipcRenderer.invoke('browser:navigate', tabId, url, timeout),
    goBack: (tabId: string) => ipcRenderer.invoke('browser:go-back', tabId),
    goForward: (tabId: string) => ipcRenderer.invoke('browser:go-forward', tabId),
    reload: (tabId: string) => ipcRenderer.invoke('browser:reload', tabId),
    stop: (tabId: string) => ipcRenderer.invoke('browser:stop', tabId),
    setZoomFactor: (tabId: string, zoomFactor: number) =>
      ipcRenderer.invoke('browser:set-zoom-factor', tabId, zoomFactor),
    getCookies: (filter?: Electron.CookiesGetFilter) => ipcRenderer.invoke('browser:get-cookies', filter),
    setCookie: (cookie: Electron.CookiesSetDetails) => ipcRenderer.invoke('browser:set-cookie', cookie),
    connectCDP: (tabId: string) => ipcRenderer.invoke('browser:connect-cdp', tabId),
    disconnectCDP: (tabId: string) => ipcRenderer.invoke('browser:disconnect-cdp', tabId),
    sendCDPCommand: (tabId: string, method: string, params?: Record<string, unknown>) =>
      ipcRenderer.invoke('browser:send-cdp-command', tabId, method, params),
    isCDPConnected: (tabId: string) => ipcRenderer.invoke('browser:is-cdp-connected', tabId),
    getBridgeConfig: () => ipcRenderer.invoke('browser:get-bridge-config'),
    setDisplayTarget: (
      target: 'default' | 'panel' | 'hidden',
      bounds?: { x: number; y: number; width: number; height: number },
    ) => ipcRenderer.invoke('browser:set-display-target', target, bounds),
    getContextEvents: (options?: { limit?: number; tabId?: string }) =>
      ipcRenderer.invoke('browser:get-context-events', options),
    clearContextEvents: () => ipcRenderer.invoke('browser:clear-context-events'),
    getCaptureSettings: () => ipcRenderer.invoke('browser:get-capture-settings'),
    updateCaptureSettings: (settings: {
      enabled?: boolean;
      paused?: boolean;
      retentionDays?: number;
      maxEvents?: number;
    }) => ipcRenderer.invoke('browser:update-capture-settings', settings),
    startRecording: (options?: { tabId?: string; workflowName?: string }) =>
      ipcRenderer.invoke('browser:start-recording', options),
    stopRecording: (options?: { save?: boolean; workflowName?: string }) =>
      ipcRenderer.invoke('browser:stop-recording', options),
    cancelRecording: () => ipcRenderer.invoke('browser:cancel-recording'),
    getRecordingState: () => ipcRenderer.invoke('browser:get-recording-state'),
    getWorkflows: () => ipcRenderer.invoke('browser:get-workflows'),
    saveWorkflow: (workflow: unknown) => ipcRenderer.invoke('browser:save-workflow', workflow),
    deleteWorkflow: (workflowId: string) => ipcRenderer.invoke('browser:delete-workflow', workflowId),
    replayWorkflow: (workflowId: string, options?: { tabId?: string; parameters?: Record<string, string> }) =>
      ipcRenderer.invoke('browser:replay-workflow', workflowId, options),
    onEvent: (callback: (event: string, data: unknown) => void) => {
      const listener = (_event: unknown, eventName: string, data: unknown) =>
        callback(eventName, data);
      ipcRenderer.on('browser:event', listener);
      return () => { ipcRenderer.removeListener('browser:event', listener); };
    },
    onOpenInContentTab: (callback: (payload: { url: string; pageId?: string }) => void) => {
      const listener = (_event: unknown, data: { url?: string; pageId?: string } | null) => {
        const url = data?.url;
        if (typeof url === 'string' && url.length > 0) {
          const pageId = typeof data?.pageId === 'string' ? data.pageId : undefined;
          callback({ url, ...(pageId ? { pageId } : {}) });
        }
      };
      ipcRenderer.on('content-browser:open-url-in-tab', listener);
      return () => { ipcRenderer.removeListener('content-browser:open-url-in-tab', listener); };
    },
  },
});
