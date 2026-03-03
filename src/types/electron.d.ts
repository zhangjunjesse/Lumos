/**
 * Global type declarations for the Electron preload API.
 * Exposed via contextBridge.exposeInMainWorld('electronAPI', ...) in electron/preload.ts.
 */

interface ElectronInstallAPI {
  checkPrerequisites: () => Promise<{
    hasNode: boolean;
    nodeVersion?: string;
    hasClaude: boolean;
    claudeVersion?: string;
  }>;
  start: (options?: { includeNode?: boolean }) => Promise<void>;
  cancel: () => Promise<void>;
  getLogs: () => Promise<string[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onProgress: (callback: (data: any) => void) => () => void;
}

interface UpdateStatusEvent {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: {
    version: string;
    releaseNotes?: string | { version: string; note: string }[] | null;
    releaseName?: string | null;
    releaseDate?: string;
  };
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

interface ElectronUpdaterAPI {
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => Promise<void>;
  onStatus: (callback: (data: UpdateStatusEvent) => void) => () => void;
}

interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  isPinned: boolean;
  lastAccess: number;
}

interface ElectronBrowserAPI {
  createTab: (url?: string) => Promise<{ success: boolean; tabId?: string; error?: string }>;
  closeTab: (tabId: string) => Promise<{ success: boolean; error?: string }>;
  switchTab: (tabId: string) => Promise<{ success: boolean; error?: string }>;
  getTabs: () => Promise<{ success: boolean; tabs?: BrowserTab[]; activeTabId?: string; error?: string }>;
  navigate: (tabId: string, url: string, timeout?: number) => Promise<{ success: boolean; error?: string }>;
  getCookies: (filter?: any) => Promise<{ success: boolean; cookies?: any[]; error?: string }>;
  setCookie: (cookie: any) => Promise<{ success: boolean; error?: string }>;
  connectCDP: (tabId: string) => Promise<{ success: boolean; error?: string }>;
  disconnectCDP: (tabId: string) => Promise<{ success: boolean; error?: string }>;
  sendCDPCommand: (tabId: string, method: string, params?: any) => Promise<{ success: boolean; result?: any; error?: string }>;
  isCDPConnected: (tabId: string) => Promise<{ success: boolean; connected?: boolean; error?: string }>;
  onEvent: (callback: (event: string, data: any) => void) => () => void;
}

interface ElectronAPI {
  versions: {
    electron: string;
    node: string;
    chrome: string;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
  };
  dialog: {
    openFolder: (options?: {
      defaultPath?: string;
      title?: string;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  install: ElectronInstallAPI;
  updater?: ElectronUpdaterAPI;
  browser: ElectronBrowserAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
