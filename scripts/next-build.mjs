import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function withBuildNodeOptions(existing) {
  const parts = (existing || '').split(/\s+/).filter(Boolean);
  if (parts.some((part) => part.startsWith('--max-old-space-size='))) {
    return existing || '';
  }
  const heapMb = process.env.LUMOS_NEXT_BUILD_HEAP_MB || '6144';
  return [...parts, `--max-old-space-size=${heapMb}`].join(' ');
}

function hideDesktopRuntimeResources() {
  if (process.env.LUMOS_NEXT_HIDE_RUNTIME_RESOURCES === '0') {
    return () => {};
  }

  const relPaths = [
    path.join('resources', 'git-bash'),
    path.join('resources', 'node-runtime'),
    path.join('resources', 'python-runtime'),
  ];
  const hiddenBase = process.env.LUMOS_NEXT_RUNTIME_HIDE_DIR || path.dirname(PROJECT_ROOT);
  const hiddenRoot = fs.mkdtempSync(path.join(hiddenBase, '.lumos-next-runtime-'));
  const moved = [];

  const moveDir = (source, target) => {
    try {
      fs.renameSync(source, target);
    } catch (err) {
      if (err?.code !== 'EXDEV') throw err;
      fs.cpSync(source, target, { recursive: true });
      fs.rmSync(source, { recursive: true, force: true });
    }
  };

  try {
    for (const relPath of relPaths) {
      const source = path.join(PROJECT_ROOT, relPath);
      if (!fs.existsSync(source)) continue;
      const target = path.join(hiddenRoot, relPath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      moveDir(source, target);
      moved.push({ source, target });
    }
  } catch (err) {
    for (const item of moved.reverse()) {
      try {
        fs.mkdirSync(path.dirname(item.source), { recursive: true });
        if (fs.existsSync(item.target) && !fs.existsSync(item.source)) {
          moveDir(item.target, item.source);
        }
      } catch {
        // best effort restore; rethrow original error below
      }
    }
    try { fs.rmSync(hiddenRoot, { recursive: true, force: true }); } catch {}
    throw err;
  }

  if (moved.length > 0) {
    console.log(`[next-build] Temporarily hid desktop runtime resources: ${moved.map((item) => path.relative(PROJECT_ROOT, item.source)).join(', ')}`);
  }

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const item of moved.reverse()) {
      try {
        fs.mkdirSync(path.dirname(item.source), { recursive: true });
        if (fs.existsSync(item.target) && !fs.existsSync(item.source)) {
          moveDir(item.target, item.source);
        }
      } catch (err) {
        console.warn(`[next-build] Failed to restore ${item.source}: ${err.message}`);
      }
    }
    try { fs.rmSync(hiddenRoot, { recursive: true, force: true }); } catch {}
  };
}

function configureWindowsBuildHome(env) {
  if (process.platform !== 'win32') {
    return;
  }

  const baseDir = path.resolve(
    env.LUMOS_NEXT_BUILD_HOME
      || env.RUNNER_TEMP
      || path.join(os.tmpdir(), 'lumos-next-build-home')
  );
  const homeDir = path.join(baseDir, 'home');
  const appDataDir = path.join(homeDir, 'AppData', 'Roaming');
  const localAppDataDir = path.join(homeDir, 'AppData', 'Local');
  const lumosDataDir = path.join(homeDir, '.lumos');
  const claudeConfigDir = path.join(homeDir, '.claude');

  for (const dir of [homeDir, appDataDir, localAppDataDir, lumosDataDir, claudeConfigDir]) {
    ensureDir(dir);
  }

  // Windows user profiles contain protected junctions such as
  // "Application Data". Some build-time tracing/glob paths can otherwise walk
  // the real CI profile and fail with EPERM before Next finishes compiling.
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  env.APPDATA = appDataDir;
  env.LOCALAPPDATA = localAppDataDir;
  env.LUMOS_DATA_DIR = env.LUMOS_DATA_DIR || lumosDataDir;
  env.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR || claudeConfigDir;
  env.LUMOS_CLAUDE_CONFIG_DIR = env.LUMOS_CLAUDE_CONFIG_DIR || claudeConfigDir;

  console.log(`[next-build] Using isolated Windows build home: ${homeDir}`);
}

const env = {
  ...process.env,
  LUMOS_BUILD_PHASE: '1',
};
env.NODE_OPTIONS = withBuildNodeOptions(env.NODE_OPTIONS);

configureWindowsBuildHome(env);

const nextBin = require.resolve('next/dist/bin/next', { paths: [PROJECT_ROOT] });
const nextArgs = process.argv.slice(2);
const restoreRuntimeResources = hideDesktopRuntimeResources();
let restored = false;
function restoreOnce() {
  if (restored) return;
  restored = true;
  restoreRuntimeResources();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    restoreOnce();
    process.kill(process.pid, signal);
  });
}

let result;
try {
  result = spawnSync(process.execPath, [nextBin, ...(nextArgs.length > 0 ? nextArgs : ['build', '--webpack'])], {
    cwd: PROJECT_ROOT,
    env,
    stdio: 'inherit',
  });
} finally {
  restoreOnce();
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
