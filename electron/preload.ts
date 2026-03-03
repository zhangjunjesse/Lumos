// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  shell: {
    openPath: (folderPath: string) => ipcRenderer.invoke('shell:open-path', folderPath),
  },
  dialog: {
    openFolder: (options?: { defaultPath?: string; title?: string }) =>
      ipcRenderer.invoke('dialog:open-folder', options),
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
    getCookies: (filter?: any) => ipcRenderer.invoke('browser:get-cookies', filter),
    setCookie: (cookie: any) => ipcRenderer.invoke('browser:set-cookie', cookie),
    connectCDP: (tabId: string) => ipcRenderer.invoke('browser:connect-cdp', tabId),
    disconnectCDP: (tabId: string) => ipcRenderer.invoke('browser:disconnect-cdp', tabId),
    sendCDPCommand: (tabId: string, method: string, params?: any) =>
      ipcRenderer.invoke('browser:send-cdp-command', tabId, method, params),
    isCDPConnected: (tabId: string) => ipcRenderer.invoke('browser:is-cdp-connected', tabId),
    onEvent: (callback: (event: string, data: unknown) => void) => {
      const listener = (_event: unknown, eventName: string, data: unknown) =>
        callback(eventName, data);
      ipcRenderer.on('browser:event', listener);
      return () => { ipcRenderer.removeListener('browser:event', listener); };
    },
  },
});
