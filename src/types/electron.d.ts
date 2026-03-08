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
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  createdAt: number;
  lastAccessedAt: number;
}

interface ElectronBrowserAPI {
  createTab: (url?: string) => Promise<{ success: boolean; tabId?: string; error?: string }>;
  closeTab: (tabId: string) => Promise<{ success: boolean; error?: string }>;
  switchTab: (tabId: string) => Promise<{ success: boolean; error?: string }>;
  getTabs: () => Promise<{ success: boolean; tabs?: BrowserTab[]; activeTabId?: string; error?: string }>;
  navigate: (tabId: string, url: string, timeout?: number) => Promise<{ success: boolean; error?: string }>;
  getCookies: (filter?: Electron.CookiesGetFilter) => Promise<{ success: boolean; cookies?: Electron.Cookie[]; error?: string }>;
  setCookie: (cookie: Electron.CookiesSetDetails) => Promise<{ success: boolean; error?: string }>;
  connectCDP: (tabId: string) => Promise<{ success: boolean; error?: string }>;
  disconnectCDP: (tabId: string) => Promise<{ success: boolean; error?: string }>;
  sendCDPCommand: (tabId: string, method: string, params?: Record<string, unknown>) => Promise<{ success: boolean; result?: unknown; error?: string }>;
  isCDPConnected: (tabId: string) => Promise<{ success: boolean; connected?: boolean; error?: string }>;
  getBridgeConfig: () => Promise<{ success: boolean; url?: string; token?: string }>;
  setDisplayTarget: (
    target: 'default' | 'panel' | 'hidden',
    bounds?: { x: number; y: number; width: number; height: number },
  ) => Promise<{ success: boolean; error?: string }>;
  onEvent: (callback: (event: string, data: unknown) => void) => () => void;
  onOpenInContentTab: (callback: (payload: { url: string; pageId?: string }) => void) => () => void;
}

interface ElectronAPI {
  versions: {
    electron: string;
    node: string;
    chrome: string;
  };
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
    openExternal: (url: string) => Promise<void>;
  };
  auth: {
    open: (url: string) => Promise<void>;
  };
  dialog: {
    openFolder: (options?: {
      defaultPath?: string;
      title?: string;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
    openFile: (options?: {
      defaultPath?: string;
      title?: string;
      filters?: Electron.FileFilter[];
      multi?: boolean;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  install: ElectronInstallAPI;
  updater: ElectronUpdaterAPI;
  browser: ElectronBrowserAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
