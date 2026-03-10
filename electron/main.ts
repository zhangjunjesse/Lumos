import { app, BrowserWindow, nativeImage, dialog, session, utilityProcess, ipcMain, shell, safeStorage } from 'electron';
import path from 'path';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import { initAutoUpdater, setUpdaterWindow, registerUpdaterHandlers } from './updater';
import { BrowserManager } from './browser/browser-manager';
import { setupBrowserIPC } from './ipc/browser-handlers';
import { BrowserBridgeServer } from './browser/bridge-server';

let mainWindow: BrowserWindow | null = null;
let authWindow: BrowserWindow | null = null;
let browserManager: BrowserManager | null = null;
const browserBridgeContext: { browserManager: BrowserManager | null } = { browserManager: null };
let browserBridgeServer: BrowserBridgeServer | null = null;
let browserBridgeUrl = '';
let browserBridgeToken = '';
let serverProcess: Electron.UtilityProcess | null = null;
let serverPort: number | null = null;
let serverErrors: string[] = [];
let serverExited = false;
let serverExitCode: number | null = null;
let userShellEnv: Record<string, string> = {};
let isQuitting = false;
let appOriginPrefix = '';
const BROWSER_BRIDGE_RUNTIME_RELATIVE_PATH = path.join('runtime', 'browser-bridge.json');
const DEFAULT_PACKAGED_SERVER_PORT = 43127;

function getBrowserBridgeRuntimeFilePath(): string {
  const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
  return path.join(dataDir, BROWSER_BRIDGE_RUNTIME_RELATIVE_PATH);
}

function persistBrowserBridgeRuntime(url: string, token: string): void {
  try {
    const filePath = getBrowserBridgeRuntimeFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          url,
          token,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf-8',
    );
    console.log('[browser-bridge] runtime config persisted:', filePath);
  } catch (error) {
    console.warn('[browser-bridge] failed to persist runtime config:', error);
  }
}

function clearBrowserBridgeRuntime(): void {
  try {
    const filePath = getBrowserBridgeRuntimeFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn('[browser-bridge] failed to clear runtime config:', error);
  }
}

// --- Install orchestrator ---
interface InstallStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  error?: string;
}

interface InstallState {
  status: 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
  currentStep: string | null;
  steps: InstallStep[];
  logs: string[];
}

let installState: InstallState = {
  status: 'idle',
  currentStep: null,
  steps: [],
  logs: [],
};

let installProcess: ChildProcess | null = null;

const isDev = !app.isPackaged;

/**
 * Read or bootstrap the embedded default API key using Electron's safeStorage.
 * On first run, encrypts the raw key from LUMOS_DEFAULT_KEY or CODEPILOT_DEFAULT_KEY env var to disk.
 * On subsequent runs, decrypts from the persisted file.
 */
function initDefaultApiKey(): string | undefined {
  const encPath = path.join(app.getPath('userData'), 'default-key.enc');

  if (fs.existsSync(encPath)) {
    try {
      const encrypted = fs.readFileSync(encPath);
      return safeStorage.decryptString(encrypted);
    } catch {
      fs.unlinkSync(encPath);
    }
  }

  const rawKey = process.env.LUMOS_DEFAULT_KEY || process.env.CODEPILOT_DEFAULT_KEY;
  if (!rawKey) return undefined;

  if (process.env.CODEPILOT_DEFAULT_KEY && !process.env.LUMOS_DEFAULT_KEY) {
    console.warn('[electron] CODEPILOT_DEFAULT_KEY is deprecated. Please use LUMOS_DEFAULT_KEY instead.');
  }

  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(encPath, safeStorage.encryptString(rawKey));
  }
  return rawKey;
}

/**
 * Gracefully shut down the server process.
 * Sends kill() (SIGTERM) first, waits up to 3s for exit,
 * then force-kills via process.kill(pid, SIGKILL) as fallback.
 */
function killServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    const pid = serverProcess.pid;

    const timeout = setTimeout(() => {
      // Force kill — on Windows use taskkill to kill the entire process tree
      if (pid) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
          } else {
            process.kill(pid, 'SIGKILL');
          }
        } catch { /* already dead */ }
      }
      serverProcess = null;
      resolve();
    }, 3000);

    serverProcess.on('exit', () => {
      clearTimeout(timeout);
      serverProcess = null;
      resolve();
    });

    // On Windows, SIGTERM is not supported — use taskkill to kill the tree
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      serverProcess.kill();
    }
  });
}

/**
 * Verify that better_sqlite3.node in standalone resources is compatible
 * with this Electron runtime's ABI. If it was built for a different
 * Node.js ABI (e.g. system Node v22 ABI 127 vs Electron's ABI 143),
 * show a clear error instead of a cryptic MODULE_NOT_FOUND crash.
 */
function checkNativeModuleABI(): void {
  if (isDev) return; // Skip in dev mode

  const standaloneDir = path.join(process.resourcesPath, 'standalone');

  // Find better_sqlite3.node recursively
  function findNodeFile(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findNodeFile(fullPath);
        if (found) return found;
      } else if (entry.name === 'better_sqlite3.node') {
        return fullPath;
      }
    }
    return null;
  }

  const nodeFile = findNodeFile(path.join(standaloneDir, 'node_modules'));
  if (!nodeFile) {
    console.warn('[ABI check] better_sqlite3.node not found in standalone resources');
    return;
  }

  try {
    // Attempt to load the native module to verify ABI compatibility
    process.dlopen({ exports: {} } as NodeModule, nodeFile);
    console.log(`[ABI check] better_sqlite3.node ABI is compatible (${nodeFile})`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('NODE_MODULE_VERSION')) {
      console.error(`[ABI check] ABI mismatch detected: ${msg}`);
      dialog.showErrorBox(
        'CodePilot - Native Module ABI Mismatch',
        `The bundled better-sqlite3 native module was compiled for a different Node.js version.\n\n` +
        `${msg}\n\n` +
        `This usually means the build process did not correctly recompile native modules for Electron.\n` +
        `Please rebuild the application or report this issue.`
      );
      app.quit();
    } else {
      // Other load errors (missing dependencies, etc.) -- log but don't block
      console.warn(`[ABI check] Could not verify better_sqlite3.node: ${msg}`);
    }
  }
}

/**
 * Read the user's full shell environment by running a login shell.
 * When Electron is launched from Dock/Finder (macOS) or desktop launcher
 * (Linux), process.env is very limited and won't include vars from
 * .zshrc/.bashrc (e.g. API keys, nvm PATH).
 */
function loadUserShellEnv(): Record<string, string> {
  // Windows GUI apps inherit the full user environment
  if (process.platform === 'win32') {
    return {};
  }
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const result = execFileSync(shell, ['-ilc', 'env'], {
      timeout: 5000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const env: Record<string, string> = {};
    for (const line of result.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.slice(0, idx);
        const value = line.slice(idx + 1);
        env[key] = value;
      }
    }
    console.log(`Loaded ${Object.keys(env).length} env vars from user shell`);
    return env;
  } catch (err) {
    console.warn('Failed to load user shell env:', err);
    return {};
  }
}

/**
 * Build an expanded PATH that includes common locations for node, npm globals,
 * claude, nvm, homebrew, etc. Shared by the server launcher and install orchestrator.
 */
function getExpandedShellPath(): string {
  const home = os.homedir();
  const shellPath = userShellEnv.PATH || process.env.PATH || '';
  const sep = path.delimiter;

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const winExtra = [
      path.join(appData, 'npm'),
      path.join(localAppData, 'npm'),
      path.join(home, '.npm-global', 'bin'),
      path.join(home, '.local', 'bin'),
      path.join(home, '.claude', 'bin'),
    ];
    const allParts = [shellPath, ...winExtra].join(sep).split(sep).filter(Boolean);
    return [...new Set(allParts)].join(sep);
  } else {
    const basePath = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin`;
    const raw = `${basePath}:${home}/.npm-global/bin:${home}/.local/bin:${home}/.claude/bin:${shellPath}`;
    const allParts = raw.split(':').filter(Boolean);
    return [...new Set(allParts)].join(':');
  }
}

function tryListenOnPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        server.close(() => resolve(addr.port));
      } else {
        server.close(() => reject(new Error(`Failed to bind port ${port}`)));
      }
    });
  });
}

function getPreferredServerPort(): number {
  const raw = process.env.LUMOS_SERVER_PORT?.trim();
  if (!raw) return DEFAULT_PACKAGED_SERVER_PORT;

  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }

  console.warn(`[main] Invalid LUMOS_SERVER_PORT: ${raw}. Falling back to ${DEFAULT_PACKAGED_SERVER_PORT}.`);
  return DEFAULT_PACKAGED_SERVER_PORT;
}

async function getPort(preferredPort?: number): Promise<number> {
  if (preferredPort) {
    try {
      return await tryListenOnPort(preferredPort);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') {
        throw error;
      }
      console.warn(`[main] Preferred port ${preferredPort} unavailable (${err.code}), falling back to a random port.`);
    }
  }

  return tryListenOnPort(0);
}

async function waitForServer(port: number, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // If the server process already exited, fail fast
    if (serverExited) {
      throw new Error(
        `Server process exited with code ${serverExitCode}.\n\n${serverErrors.join('\n')}`
      );
    }
    try {
      await new Promise<void>((resolve, reject) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const req = require('http').get(`http://127.0.0.1:${port}/api/health`, (res: { statusCode?: number }) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  throw new Error(
    `Server startup timeout after ${timeout / 1000}s.\n\n${serverErrors.length > 0 ? 'Server output:\n' + serverErrors.slice(-10).join('\n') : 'No server output captured.'}`
  );
}

function startServer(port: number): Electron.UtilityProcess {
  const standaloneDir = path.join(process.resourcesPath, 'standalone');
  const serverPath = path.join(standaloneDir, 'server.js');

  console.log(`Server path: ${serverPath}`);
  console.log(`Standalone dir: ${standaloneDir}`);

  serverErrors = [];
  serverExited = false;
  serverExitCode = null;

  const home = os.homedir();
  const constructedPath = getExpandedShellPath();

  const defaultKey = initDefaultApiKey();
  const claudeConfigDir = path.join(app.getPath('userData'), '.claude');

  const env: Record<string, string> = {
    ...userShellEnv,
    ...(process.env as Record<string, string>),
    // Ensure user shell env vars override (especially API keys)
    ...userShellEnv,
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    LUMOS_DATA_DIR: path.join(home, '.lumos'),
    HOME: home,
    USERPROFILE: home,
    PATH: constructedPath,
    // Sandbox: isolate CLI config into app's own directory
    LUMOS_CLAUDE_CONFIG_DIR: claudeConfigDir,
    ...(browserBridgeUrl ? { LUMOS_BROWSER_BRIDGE_URL: browserBridgeUrl } : {}),
    ...(browserBridgeToken ? { LUMOS_BROWSER_BRIDGE_TOKEN: browserBridgeToken } : {}),
    ...(defaultKey ? { LUMOS_DEFAULT_API_KEY: defaultKey } : {}),
    ...(process.env.CODEPILOT_DEFAULT_BASE_URL
      ? { CODEPILOT_DEFAULT_BASE_URL: process.env.CODEPILOT_DEFAULT_BASE_URL }
      : {}),
  };

  // Use Electron's utilityProcess to run the server in a child process
  // without spawning a separate Dock icon on macOS.
  const child = utilityProcess.fork(serverPath, [], {
    env,
    cwd: standaloneDir,
    stdio: 'pipe',
    serviceName: 'codepilot-server',
  });

  child.stdout?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    console.log(`[server] ${msg}`);
    serverErrors.push(msg);
  });

  child.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    console.error(`[server:err] ${msg}`);
    serverErrors.push(msg);
  });

  child.on('exit', (code) => {
    console.log(`Server process exited with code ${code}`);
    serverExited = true;
    serverExitCode = code;
    serverProcess = null;
  });

  return child;
}

function getIconPath(): string {
  if (isDev) {
    return path.join(process.cwd(), 'build', 'icon.png');
  }
  if (process.platform === 'win32') {
    return path.join(process.resourcesPath, 'icon.ico');
  }
  if (process.platform === 'linux') {
    return path.join(process.resourcesPath, 'icon.png');
  }
  return path.join(process.resourcesPath, 'icon.icns');
}

function createWindow(port: number) {
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    center: true,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset';
  } else if (process.platform === 'win32') {
    windowOptions.titleBarStyle = 'hidden';
    windowOptions.titleBarOverlay = {
      color: '#00000000',
      symbolColor: '#888888',
      height: 44,
    };
  }

  mainWindow = new BrowserWindow(windowOptions);

  appOriginPrefix = `http://127.0.0.1:${port}`;
  mainWindow.webContents.setWindowOpenHandler((details) => {
    const targetUrl = details.url;
    const isHttpUrl = /^https?:\/\//i.test(targetUrl);
    const forceExternal = details.features.includes('lumos_external=1');

    if (isDev) {
      console.log('[window-open:main]', {
        targetUrl,
        disposition: details.disposition,
        referrer: details.referrer?.url ?? '',
        forceExternal,
      });
    }

    if (forceExternal) {
      if (isHttpUrl) {
        void shell.openExternal(targetUrl);
      }
      return { action: 'deny' };
    }

    if (isHttpUrl) {
      // Page initiated target=_blank: forward to content panel browser tab.
      mainWindow?.webContents.send('content-browser:open-url-in-tab', { url: targetUrl });
    }
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.maximize();

  mainWindow.on('closed', () => {
    browserBridgeContext.browserManager = null;
    browserManager = null;
    mainWindow = null;
  });

  // 初始化 BrowserManager
  browserManager = new BrowserManager(mainWindow, {
    maxTabs: 10,
    maxActiveViews: 3,
    sessionPartition: 'persist:lumos-browser',
  });
  browserBridgeContext.browserManager = browserManager;

  // Register browser IPC and (re)bind event forwarding to current manager.
  setupBrowserIPC(() => browserManager);
}

function openAuthWindow(targetUrl: string) {
  if (!targetUrl) return;
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.loadURL(targetUrl);
    authWindow.focus();
    return;
  }

  authWindow = new BrowserWindow({
    width: 920,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    parent: mainWindow ?? undefined,
    modal: true,
    center: true,
    title: 'Lumos Login',
    icon: getIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  authWindow.setMenuBarVisibility(false);
  authWindow.loadURL(targetUrl);
  authWindow.on('closed', () => {
    authWindow = null;
  });
}

app.whenReady().then(async () => {
  // Clear stale bridge runtime file from previous crashes/restarts.
  clearBrowserBridgeRuntime();

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler((details) => {
      const targetUrl = details.url;
      const isHttpUrl = /^https?:\/\//i.test(targetUrl);
      const forceExternal = details.features.includes('lumos_external=1');

      if (isDev) {
        console.log('[window-open:global]', {
          sourceContentsId: contents.id,
          targetUrl,
          disposition: details.disposition,
          referrer: details.referrer?.url ?? '',
          forceExternal,
        });
      }

      if (forceExternal) {
        if (isHttpUrl) {
          void shell.openExternal(targetUrl);
        }
        return { action: 'deny' };
      }

      if (isHttpUrl && mainWindow && !targetUrl.startsWith(appOriginPrefix)) {
        mainWindow.webContents.send('content-browser:open-url-in-tab', { url: targetUrl });
      }
      return { action: 'deny' };
    });

    // Fallback: if any popup window is still created (e.g. special _blank flow),
    // immediately close it and forward the real URL into the content browser tab.
    contents.on('did-create-window', (createdWindow, details) => {
      const tryForwardToContentTab = (candidateUrl: string): boolean => {
        const isHttpUrl = /^https?:\/\//i.test(candidateUrl);
        if (!isHttpUrl || !mainWindow) {
          return false;
        }
        if (candidateUrl.startsWith(appOriginPrefix)) {
          return false;
        }

        if (isDev) {
          console.log('[window-open:fallback-forward]', {
            sourceContentsId: contents.id,
            candidateUrl,
          });
        }

        mainWindow.webContents.send('content-browser:open-url-in-tab', { url: candidateUrl });

        if (!createdWindow.isDestroyed()) {
          setImmediate(() => {
            if (!createdWindow.isDestroyed()) {
              createdWindow.close();
            }
          });
        }
        return true;
      };

      if (isDev) {
        console.log('[window-open:fallback-created]', {
          sourceContentsId: contents.id,
          initialUrl: details.url,
        });
      }

      if (tryForwardToContentTab(details.url)) {
        return;
      }

      const cleanup = () => {
        createdWindow.webContents.removeListener('did-start-navigation', onDidStartNavigation);
        createdWindow.webContents.removeListener('will-redirect', onWillRedirect);
        createdWindow.removeListener('closed', cleanup);
      };

      const onDidStartNavigation = (
        _event: unknown,
        navUrl: string,
        _isInPlace: boolean,
        isMainFrame: boolean
      ) => {
        if (!isMainFrame) return;
        if (tryForwardToContentTab(navUrl)) {
          cleanup();
        }
      };

      const onWillRedirect = (
        _event: unknown,
        navUrl: string,
      ) => {
        if (tryForwardToContentTab(navUrl)) {
          cleanup();
        }
      };

      createdWindow.webContents.on('did-start-navigation', onDidStartNavigation);
      createdWindow.webContents.on('will-redirect', onWillRedirect);
      createdWindow.on('closed', cleanup);
    });
  });

  // Load user's full shell environment (API keys, PATH, etc.)
  userShellEnv = loadUserShellEnv();

  // Start local browser bridge (for built-in chrome-devtools MCP).
  // Bridge can start before BrowserManager; requests will return unavailable
  // until a window is created and manager is initialized.
  browserBridgeServer = new BrowserBridgeServer(browserBridgeContext);
  try {
    await browserBridgeServer.start();
    browserBridgeUrl = browserBridgeServer.getBaseUrl();
    browserBridgeToken = browserBridgeServer.getToken();
    persistBrowserBridgeRuntime(browserBridgeUrl, browserBridgeToken);
  } catch (error) {
    console.error('[browser-bridge] failed to start:', error);
    browserBridgeServer = null;
    browserBridgeUrl = '';
    browserBridgeToken = '';
    clearBrowserBridgeRuntime();
  }

  // In dev mode, register updater IPC handlers early to avoid "No handler registered"
  if (isDev) {
    registerUpdaterHandlers();
  }

  // Verify native module ABI compatibility before starting the server
  checkNativeModuleABI();

  // === DATABASE: Initialize database and IPC handlers ===
  // TODO: 暂时禁用 Electron 主进程的数据库，因为与 Next.js 共享 better-sqlite3 有 ABI 冲突
  // 当前只有 Next.js 使用数据库，Electron 主进程不使用
  /*
  console.log('[main] Initializing database...');
  const db = initDatabase();
  const dbService = new DatabaseService(db);
  registerIpcHandlers(dbService);
  registerDbShutdownHandlers();
  console.log('[main] Database and IPC handlers initialized');
  */
  // === ISOLATION: Verify Claude CLI config directory ===
  const claudeConfigDir = path.join(app.getPath('userData'), '.claude');
  if (!fs.existsSync(claudeConfigDir)) {
    console.log('[main] Creating isolated Claude config directory:', claudeConfigDir);
    fs.mkdirSync(claudeConfigDir, { recursive: true });
  } else {
    console.log('[main] Isolated Claude config directory exists:', claudeConfigDir);
  }
  // Log warning if user's ~/.claude/ exists (potential pollution source)
  const userClaudeDir = path.join(os.homedir(), '.claude');
  if (fs.existsSync(userClaudeDir)) {
    console.warn('[main] WARNING: User ~/.claude/ directory detected. CodePilot uses isolated config at:', claudeConfigDir);
  }

  // Clear cache on version upgrade
  const currentVersion = app.getVersion();
  const versionFilePath = path.join(app.getPath('userData'), 'last-version.txt');
  try {
    const lastVersion = fs.existsSync(versionFilePath)
      ? fs.readFileSync(versionFilePath, 'utf-8').trim()
      : '';
    if (lastVersion && lastVersion !== currentVersion) {
      console.log(`Version changed from ${lastVersion} to ${currentVersion}, clearing cache...`);
      await session.defaultSession.clearCache();
      await session.defaultSession.clearStorageData({
        storages: ['cachestorage', 'serviceworkers'],
      });
      console.log('Cache cleared successfully');
    }
    fs.writeFileSync(versionFilePath, currentVersion, 'utf-8');
  } catch (err) {
    console.warn('Failed to check/clear version cache:', err);
  }

  // Skills sync moved to Next.js server to avoid better-sqlite3 ABI conflicts

  // Set macOS Dock icon
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = getIconPath();
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }

  // --- Install wizard IPC handlers ---

  ipcMain.handle('install:check-prerequisites', async () => {
    const expandedPath = getExpandedShellPath();
    const execEnv = { ...process.env, ...userShellEnv, PATH: expandedPath };
    const execOpts = { timeout: 5000, encoding: 'utf-8' as const, env: execEnv };

    let hasNode = false;
    let nodeVersion: string | undefined;
    try {
      const result = execFileSync('node', ['--version'], execOpts);
      nodeVersion = result.trim();
      hasNode = true;
    } catch {
      // node not found
    }

    let hasClaude = false;
    let claudeVersion: string | undefined;
    try {
      const claudeOpts = process.platform === 'win32'
        ? { ...execOpts, shell: true }
        : execOpts;
      const result = execFileSync('claude', ['--version'], claudeOpts);
      claudeVersion = result.trim();
      hasClaude = true;
    } catch {
      // claude not found
    }

    return { hasNode, nodeVersion, hasClaude, claudeVersion };
  });

  ipcMain.handle('install:start', (_event: Electron.IpcMainInvokeEvent, options?: { includeNode?: boolean }) => {
    if (installState.status === 'running') {
      throw new Error('Installation is already running');
    }

    const needsNode = options?.includeNode === true;

    // Reset state
    const steps: InstallStep[] = [];
    if (needsNode) {
      steps.push({ id: 'install-node', label: 'Installing Node.js', status: 'pending' });
    }
    steps.push(
      { id: 'check-node', label: 'Checking Node.js', status: 'pending' },
      { id: 'install-claude', label: 'Installing Claude Code', status: 'pending' },
      { id: 'verify', label: 'Verifying installation', status: 'pending' },
    );

    installState = {
      status: 'running',
      currentStep: null,
      steps,
      logs: [],
    };

    const expandedPath = getExpandedShellPath();
    const execEnv: Record<string, string> = {
      ...userShellEnv,
      ...(process.env as Record<string, string>),
      ...userShellEnv,
      PATH: expandedPath,
    };

    function sendProgress() {
      mainWindow?.webContents.send('install:progress', installState);
    }

    function setStep(id: string, status: InstallStep['status'], error?: string) {
      const step = installState.steps.find(s => s.id === id);
      if (step) {
        step.status = status;
        step.error = error;
      }
      installState.currentStep = id;
      sendProgress();
    }

    function addLog(line: string) {
      installState.logs.push(line);
      sendProgress();
    }

    // Run the installation sequence asynchronously
    (async () => {
      try {
        // Step 0 (optional): Install Node.js via package manager
        if (needsNode) {
          setStep('install-node', 'running');

          const nodeInstalled = await new Promise<boolean>((resolve) => {
            const isWin = process.platform === 'win32';
            const isMac = process.platform === 'darwin';
            let cmd: string;
            let args: string[];

            if (isMac) {
              // Try Homebrew
              const brewPaths = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
              const brewPath = brewPaths.find(p => fs.existsSync(p));
              if (!brewPath) {
                addLog('Homebrew not found. Cannot auto-install Node.js on macOS without Homebrew.');
                resolve(false);
                return;
              }
              cmd = brewPath;
              args = ['install', 'node'];
              addLog(`Running: ${brewPath} install node`);
            } else if (isWin) {
              cmd = 'winget';
              args = ['install', '-e', '--id', 'OpenJS.NodeJS.LTS', '--accept-source-agreements', '--accept-package-agreements'];
              addLog('Running: winget install -e --id OpenJS.NodeJS.LTS');
            } else {
              // Linux — no universal package manager
              addLog('Auto-install of Node.js is not supported on this platform.');
              resolve(false);
              return;
            }

            const child = spawn(cmd, args, {
              env: execEnv,
              shell: isWin,
              stdio: ['ignore', 'pipe', 'pipe'],
            });

            installProcess = child;

            child.stdout?.on('data', (data: Buffer) => {
              for (const line of data.toString().split('\n').filter(Boolean)) {
                addLog(line);
              }
            });
            child.stderr?.on('data', (data: Buffer) => {
              for (const line of data.toString().split('\n').filter(Boolean)) {
                addLog(line);
              }
            });
            child.on('error', (err) => {
              addLog(`Error: ${err.message}`);
              resolve(false);
            });
            child.on('close', (code) => {
              installProcess = null;
              resolve(code === 0);
            });
          });

          if (installState.status === 'cancelled') {
            setStep('install-node', 'failed', 'Cancelled');
            return;
          }

          if (!nodeInstalled) {
            setStep('install-node', 'failed', 'Could not auto-install Node.js.');
            installState.status = 'failed';
            sendProgress();
            return;
          }

          setStep('install-node', 'success');
          addLog('Node.js installation completed.');
        }

        // Step 1: Check node
        setStep('check-node', 'running');
        try {
          const nodeResult = execFileSync('node', ['--version'], {
            timeout: 5000,
            encoding: 'utf-8',
            env: execEnv,
          });
          addLog(`Node.js found: ${nodeResult.trim()}`);
          setStep('check-node', 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog(`Node.js not found: ${msg}`);
          setStep('check-node', 'failed', 'Node.js is not installed. Please install Node.js first.');
          installState.status = 'failed';
          sendProgress();
          return;
        }

        // Step 2: Install Claude Code via npm
        setStep('install-claude', 'running');
        addLog('Running: npm install -g @anthropic-ai/claude-code');

        const npmInstallSuccess = await new Promise<boolean>((resolve) => {
          const isWin = process.platform === 'win32';
          const npmCmd = isWin ? 'npm.cmd' : 'npm';

          const child = spawn(npmCmd, ['install', '-g', '@anthropic-ai/claude-code'], {
            env: execEnv,
            shell: isWin,
            stdio: ['ignore', 'pipe', 'pipe'],
          });

          installProcess = child;

          child.stdout?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              addLog(line);
            }
          });

          child.stderr?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n').filter(Boolean);
            for (const line of lines) {
              addLog(line);
            }
          });

          child.on('error', (err) => {
            addLog(`npm error: ${err.message}`);
            resolve(false);
          });

          child.on('close', (code) => {
            installProcess = null;
            if (code === 0) {
              addLog('npm install completed successfully');
              resolve(true);
            } else if (installState.status === 'cancelled') {
              addLog('Installation was cancelled');
              resolve(false);
            } else {
              addLog(`npm install exited with code ${code}`);
              resolve(false);
            }
          });
        });

        if (installState.status === 'cancelled') {
          setStep('install-claude', 'failed', 'Cancelled');
          return;
        }

        if (!npmInstallSuccess) {
          setStep('install-claude', 'failed', 'npm install failed. Check logs for details.');
          installState.status = 'failed';
          sendProgress();
          return;
        }

        setStep('install-claude', 'success');

        // Step 3: Verify claude is available
        setStep('verify', 'running');
        try {
          const verifyOpts = process.platform === 'win32'
            ? { timeout: 5000, encoding: 'utf-8' as const, env: execEnv, shell: true }
            : { timeout: 5000, encoding: 'utf-8' as const, env: execEnv };
          const claudeResult = execFileSync('claude', ['--version'], verifyOpts);
          addLog(`Claude Code installed: ${claudeResult.trim()}`);
          setStep('verify', 'success');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          addLog(`Verification failed: ${msg}`);
          setStep('verify', 'failed', 'Claude Code was installed but could not be verified.');
          installState.status = 'failed';
          sendProgress();
          return;
        }

        installState.status = 'success';
        installState.currentStep = null;
        sendProgress();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(`Unexpected error: ${msg}`);
        installState.status = 'failed';
        sendProgress();
      }
    })();
  });

  ipcMain.handle('install:cancel', () => {
    if (installState.status !== 'running') {
      return;
    }

    installState.status = 'cancelled';
    installState.logs.push('Cancelling installation...');

    if (installProcess) {
      const pid = installProcess.pid;
      try {
        if (process.platform === 'win32' && pid) {
          // Windows: kill entire process tree (shell: true spawns cmd.exe which
          // spawns npm/winget — child.kill() only kills the shell, not the tree)
          spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
        } else {
          installProcess.kill();
        }
      } catch {
        // already dead
      }
      installProcess = null;
      installState.logs.push('Installation process terminated.');
    }

    mainWindow?.webContents.send('install:progress', installState);
  });

  ipcMain.handle('install:get-logs', () => {
    return installState.logs;
  });

  // --- End install wizard IPC handlers ---

  // Open a folder in the system file manager (Finder / Explorer)
  ipcMain.handle('shell:open-path', async (_event: Electron.IpcMainInvokeEvent, folderPath: string) => {
    return shell.openPath(folderPath);
  });

  ipcMain.handle('shell:open-external', async (_event: Electron.IpcMainInvokeEvent, targetUrl: string) => {
    return shell.openExternal(targetUrl);
  });

  ipcMain.handle('window:open-auth', async (_event: Electron.IpcMainInvokeEvent, targetUrl: string) => {
    if (!mainWindow) return;
    openAuthWindow(targetUrl);
  });

  ipcMain.handle('browser:get-bridge-config', async () => {
    return {
      success: Boolean(browserBridgeUrl && browserBridgeToken),
      url: browserBridgeUrl,
      token: browserBridgeToken,
    };
  });

  // Native folder picker dialog
  ipcMain.handle('dialog:open-folder', async (_event, options?: { defaultPath?: string; title?: string }) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Select a project folder',
      defaultPath: options?.defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return { canceled: result.canceled, filePaths: result.filePaths };
  });

  // Native file picker dialog
  ipcMain.handle('dialog:open-file', async (_event, options?: { defaultPath?: string; title?: string; filters?: Electron.FileFilter[]; multi?: boolean }) => {
    if (!mainWindow) return { canceled: true, filePaths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: options?.title || 'Select a file',
      defaultPath: options?.defaultPath || undefined,
      filters: options?.filters,
      properties: options?.multi === false ? ['openFile'] : ['openFile', 'multiSelections'],
    });
    return { canceled: result.canceled, filePaths: result.filePaths };
  });

  try {
    let port: number;

    if (isDev) {
      port = 3000;
      console.log(`Dev mode: connecting to http://127.0.0.1:${port}`);
    } else {
      port = await getPort(getPreferredServerPort());
      console.log(`Starting server on port ${port}...`);
      serverProcess = startServer(port);
      await waitForServer(port);
      console.log('Server is ready');
    }

    serverPort = port;
    createWindow(port);

    // Start WebSocket listener via API
    try {
      const res = await fetch(`http://localhost:${port}/api/bridge/websocket`, { method: 'POST' });
      if (res.ok) {
        console.log('[Bridge] WebSocket listener started via API');
      }
    } catch (err) {
      console.error('[Bridge] Failed to start WebSocket listener:', err);
    }

    // Sync skills via API
    try {
      const res = await fetch(`http://localhost:${port}/api/skills/sync`, { method: 'POST' });
      if (res.ok) {
        console.log('[Skills] Synced successfully via API');
      }
    } catch (err) {
      console.error('[Skills] Failed to sync:', err);
    }

    // Initialize auto-updater in packaged mode only
    if (!isDev && mainWindow) {
      initAutoUpdater(mainWindow);
    } else if (mainWindow) {
      registerUpdaterHandlers(mainWindow);
    }
  } catch (err) {
    console.error('Failed to start:', err);
    dialog.showErrorBox(
      'CodePilot - Failed to Start',
      `The internal server could not start.\n\n${err instanceof Error ? err.message : String(err)}\n\nPlease try restarting the application.`
    );
    app.quit();
  }
});

app.on('window-all-closed', async () => {
  if (feishuListener) {
    await feishuListener.stop();
    feishuListener = null;
  }
  await killServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    try {
      if (!isDev && !serverProcess) {
        const port = await getPort(getPreferredServerPort());
        serverProcess = startServer(port);
        await waitForServer(port);
        serverPort = port;
      }
      createWindow(serverPort || getPreferredServerPort());

      // Re-attach updater to the new window
      if (!isDev && mainWindow) {
        setUpdaterWindow(mainWindow);
      } else if (mainWindow) {
        registerUpdaterHandlers(mainWindow);
      }
    } catch (err) {
      console.error('Failed to restart server:', err);
    }
  }
});

app.on('before-quit', async (e) => {
  // Kill any running install process (tree-kill on Windows)
  if (installProcess) {
    const pid = installProcess.pid;
    try {
      if (process.platform === 'win32' && pid) {
        spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' });
      } else {
        installProcess.kill();
      }
    } catch { /* already dead */ }
    installProcess = null;
  }

  // 清理 BrowserManager
  if (browserManager) {
    try {
      await browserManager.cleanup();
    } catch (error) {
      console.error('Failed to cleanup BrowserManager:', error);
    }
    browserManager = null;
    browserBridgeContext.browserManager = null;
  }

  if (browserBridgeServer) {
    try {
      await browserBridgeServer.stop();
    } catch (error) {
      console.error('Failed to stop browser bridge server:', error);
    }
    browserBridgeServer = null;
    browserBridgeUrl = '';
    browserBridgeToken = '';
  }
  clearBrowserBridgeRuntime();

  // Stop WebSocket listener
  if (serverPort) {
    try {
      await fetch(`http://localhost:${serverPort}/api/bridge/websocket`, { method: 'DELETE' });
      console.log('[Bridge] WebSocket listener stopped');
    } catch {
      // Server might already be down
    }
  }

  // 清理 BridgeManager
  if (bridgeManager) {
    try {
      await bridgeManager.stop();
      console.log('[main] Bridge system stopped');
    } catch (error) {
      console.error('[main] Failed to stop Bridge system:', error);
    }
  }
  if (serverProcess && !isQuitting) {
    isQuitting = true;
    e.preventDefault();
    await killServer();
    app.quit();
  }
});
