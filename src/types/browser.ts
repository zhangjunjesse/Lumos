/**
 * Browser API Types
 */

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

export interface BrowserAPIResponse<T = void> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface CreateTabResponse extends BrowserAPIResponse {
  tabId?: string;
}

export interface GetTabsResponse extends BrowserAPIResponse {
  tabs?: BrowserTab[];
  activeTabId?: string | null;
}

export interface GetCookiesResponse extends BrowserAPIResponse {
  cookies?: Electron.Cookie[];
}

export interface BrowserAPI {
  createTab: (url?: string) => Promise<CreateTabResponse>;
  closeTab: (tabId: string) => Promise<BrowserAPIResponse>;
  switchTab: (tabId: string) => Promise<BrowserAPIResponse>;
  getTabs: () => Promise<GetTabsResponse>;
  navigate: (tabId: string, url: string, timeout?: number) => Promise<BrowserAPIResponse>;
  getCookies: (filter?: Electron.CookiesGetFilter) => Promise<GetCookiesResponse>;
  setCookie: (cookie: Electron.CookiesSetDetails) => Promise<BrowserAPIResponse>;
  onEvent: (callback: (event: string, data: any) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: {
      versions: {
        electron: string;
        node: string;
        chrome: string;
      };
      shell: {
        openPath: (folderPath: string) => Promise<string>;
      };
      dialog: {
        openFolder: (options?: { defaultPath?: string; title?: string }) => Promise<string | null>;
      };
      install: {
        checkPrerequisites: () => Promise<any>;
        start: (options?: { includeNode?: boolean }) => Promise<any>;
        cancel: () => Promise<any>;
        getLogs: () => Promise<any>;
        onProgress: (callback: (data: unknown) => void) => () => void;
      };
      updater: {
        checkForUpdates: () => Promise<any>;
        downloadUpdate: () => Promise<any>;
        quitAndInstall: () => Promise<any>;
        onStatus: (callback: (data: unknown) => void) => () => void;
      };
      browser: BrowserAPI;
    };
  }
}

export {};
