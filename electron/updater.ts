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
async function configureProxy() {
  try {
    const proxy = await session.defaultSession.resolveProxy('https://github.com');
    // proxy returns "DIRECT" or "PROXY host:port" / "SOCKS5 host:port" etc.
    if (proxy && proxy !== 'DIRECT') {
      const match = proxy.match(/^(?:PROXY|HTTPS)\s+(.+)/i);
      if (match) {
        process.env.HTTPS_PROXY = `http://${match[1]}`;
        console.log('[updater] Using system proxy:', process.env.HTTPS_PROXY);
      }
      const socksMatch = proxy.match(/^SOCKS5?\s+(.+)/i);
      if (socksMatch) {
        process.env.HTTPS_PROXY = `socks5://${socksMatch[1]}`;
        console.log('[updater] Using system SOCKS proxy:', process.env.HTTPS_PROXY);
      }
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
