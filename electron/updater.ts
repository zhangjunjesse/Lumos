import { autoUpdater } from 'electron-updater';
import type { BrowserWindow } from 'electron';
import { ipcMain, session } from 'electron';

let mainWindow: BrowserWindow | null = null;
let updaterInitialized = false;
let downloadInFlight: Promise<unknown> | null = null;
let downloadedInfo: {
  version: string;
  releaseNotes?: string;
  releaseName?: string | null;
  releaseDate?: string;
} | null = null;

function sendStatus(data: Record<string, unknown>) {
  mainWindow?.webContents.send('updater:status', data);
}

function formatReleaseNotes(releaseNotes: unknown): string {
  if (typeof releaseNotes === 'string') {
    return releaseNotes;
  }
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }
        const note = 'note' in item ? item.note : null;
        return typeof note === 'string' ? note : '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

function formatUpdateInfo(info: {
  version: string;
  releaseNotes?: unknown;
  releaseName?: string | null;
  releaseDate?: string;
}) {
  return {
    version: info.version,
    releaseNotes: formatReleaseNotes(info.releaseNotes),
    releaseName: info.releaseName,
    releaseDate: info.releaseDate,
  };
}

function startBackgroundDownload(reason: 'auto' | 'manual'): Promise<unknown> {
  if (downloadedInfo) {
    sendStatus({ status: 'downloaded', info: downloadedInfo, reason, cached: true });
    return Promise.resolve({ status: 'downloaded', info: formatUpdateInfo(downloadedInfo) });
  }
  if (downloadInFlight) {
    return downloadInFlight;
  }

  console.log(`[updater] Starting ${reason} update download`);
  sendStatus({ status: 'download-started', reason });
  downloadInFlight = autoUpdater.downloadUpdate()
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[updater] Download failed:', message);
      sendStatus({ status: 'error', error: message });
      return { status: 'error', error: message };
    })
    .finally(() => {
      downloadInFlight = null;
    });
  return downloadInFlight;
}

/**
 * Resolve system proxy for GitHub and inject into electron-updater
 * so that VPN / proxy tools are respected during update downloads.
 */
// 更新主源是国内镜像(必须直连);只有 GitHub 兜底源才需要走系统代理(国内翻墙)。
// host 与 electron-builder.yml 的 publish generic url 对应。
const UPDATE_MIRROR_HOST = 'lumos.miki.zj.cn';

async function configureProxy() {
  try {
    const proxy = await session.defaultSession.resolveProxy('https://github.com');
    // proxy returns "DIRECT" or "PROXY host:port" / "SOCKS5 host:port" etc.
    if (proxy && proxy !== 'DIRECT') {
      const match = proxy.match(/^(?:PROXY|HTTPS)\s+(.+)/i);
      if (match) {
        process.env.HTTPS_PROXY = `http://${match[1]}`;
      }
      const socksMatch = proxy.match(/^SOCKS5?\s+(.+)/i);
      if (socksMatch) {
        process.env.HTTPS_PROXY = `socks5://${socksMatch[1]}`;
      }
    }

    // 只要环境里有 HTTPS_PROXY(本函数刚设的、或 VPN/shell 早已导出的),就给镜像加
    // NO_PROXY 直连——否则那部分用户的镜像下载仍会被绕去代理(Chromium 解析返回 DIRECT
    // 但进程里已有 HTTPS_PROXY 的场景)。
    if (process.env.HTTPS_PROXY) {
      // 关键:把国内镜像加进 NO_PROXY,让它直连——否则镜像下载也被绕去国外代理节点,
      // 国内→国外→绕回广州,把域名镜像的速度优势全毁掉(用户"更新慢"的元凶之一)。
      const existing = (process.env.NO_PROXY || process.env.no_proxy || '').trim();
      const parts = existing ? existing.split(',').map((s) => s.trim()).filter(Boolean) : [];
      if (!parts.includes(UPDATE_MIRROR_HOST)) {
        parts.push(UPDATE_MIRROR_HOST);
      }
      process.env.NO_PROXY = parts.join(',');
      process.env.no_proxy = process.env.NO_PROXY;
      console.log('[updater] proxy for GitHub, direct for mirror:', process.env.HTTPS_PROXY, '| NO_PROXY:', process.env.NO_PROXY);
    }
  } catch (err) {
    console.warn('[updater] Failed to resolve proxy:', err);
  }
}

export function initAutoUpdater(win: BrowserWindow) {
  mainWindow = win;

  if (updaterInitialized) {
    return;
  }
  updaterInitialized = true;

  // Configuration — download updates in the background and only prompt after
  // the installer is already cached locally.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // For private repos: configure GitHub token
  // Use environment variable for security (set GH_TOKEN during build)
  if (process.env.GH_TOKEN) {
    autoUpdater.requestHeaders = {
      Authorization: `token ${process.env.GH_TOKEN}`,
    };
    console.log('[updater] Using GitHub token from environment variable');
  }

  // Resolve and apply system proxy for update downloads
  configureProxy();

  // --- Events ---
  autoUpdater.on('checking-for-update', () => {
    sendStatus({ status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    const formattedInfo = formatUpdateInfo(info);
    if (downloadedInfo?.version !== formattedInfo.version) {
      downloadedInfo = null;
    }
    sendStatus({
      status: 'available',
      info: formattedInfo,
      autoDownload: true,
    });
    void startBackgroundDownload('auto');
  });

  autoUpdater.on('update-not-available', () => {
    sendStatus({ status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendStatus({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloadedInfo = formatUpdateInfo(info);
    sendStatus({
      status: 'downloaded',
      info: downloadedInfo,
    });
  });

  autoUpdater.on('error', (err) => {
    downloadInFlight = null;
    sendStatus({ status: 'error', error: err.message });
  });

  // --- IPC handlers ---
  ipcMain.removeHandler('updater:check');
  ipcMain.removeHandler('updater:download');
  ipcMain.removeHandler('updater:quit-and-install');

  ipcMain.handle('updater:check', async () => {
    if (downloadedInfo) {
      sendStatus({ status: 'downloaded', info: downloadedInfo, reason: 'manual', cached: true });
      return { status: 'downloaded', info: downloadedInfo };
    }
    return autoUpdater.checkForUpdates();
  });

  ipcMain.handle('updater:download', async () => {
    return startBackgroundDownload('manual');
  });

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall();
  });

  // Initial check after 10 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] Initial check failed:', err.message);
    });
  }, 10_000);

  // Periodic check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[updater] Periodic check failed:', err.message);
    });
  }, 4 * 60 * 60 * 1000);
}

export function setUpdaterWindow(win: BrowserWindow) {
  mainWindow = win;
}

/**
 * Register no-op updater handlers for dev mode to avoid IPC errors.
 */
export function registerUpdaterHandlers(win?: BrowserWindow) {
  if (win) mainWindow = win;

  // Ensure handlers are not duplicated
  ipcMain.removeHandler('updater:check');
  ipcMain.removeHandler('updater:download');
  ipcMain.removeHandler('updater:quit-and-install');

  ipcMain.handle('updater:check', async () => {
    sendStatus({ status: 'not-available', reason: 'dev' });
    return { status: 'not-available' };
  });

  ipcMain.handle('updater:download', async () => {
    sendStatus({ status: 'not-available', reason: 'dev' });
    return { status: 'not-available' };
  });

  ipcMain.handle('updater:quit-and-install', () => {
    sendStatus({ status: 'not-available', reason: 'dev' });
  });
}
