import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const HIDDEN_RUNTIME_PREFIX = '.lumos-next-runtime-';
const HIDDEN_RUNTIME_OWNER_FILE = '.owner.json';
const DESKTOP_RUNTIME_REL_PATHS = [
  path.join('resources', 'git-bash'),
  path.join('resources', 'node-runtime'),
  path.join('resources', 'python-runtime'),
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function withBuildNodeOptions(existing) {
  const parts = (existing || '').split(/\s+/).filter(Boolean);
  if (parts.some((part) => part.startsWith('--max-old-space-size='))) {
    return existing || '';
  }
  // 6144 OOMs since native-app platform + memory-v2 (~32k LOC, May 2026).
  // Both local pre-push hook and GitHub Actions ubuntu-latest verify-source
  // need ≥8192. Ubuntu-latest has 16GB RAM so 8GB heap is safe; override via
  // LUMOS_NEXT_BUILD_HEAP_MB for tight environments.
  const heapMb = process.env.LUMOS_NEXT_BUILD_HEAP_MB || '8192';
  return [...parts, `--max-old-space-size=${heapMb}`].join(' ');
}

function runtimeHiddenBase() {
  return process.env.LUMOS_NEXT_RUNTIME_HIDE_DIR || path.dirname(PROJECT_ROOT);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function moveDir(source, target) {
  // Windows briefly returns EPERM/EBUSY when antivirus (Defender) still holds
  // handles on a freshly extracted tree — e.g. right after download-git-bash.mjs
  // unpacks ~60MB and next-build.mjs tries to relocate it. Retry a few times,
  // then fall back to copy+remove (same path as EXDEV across volumes).
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      if (attempt > 0) sleepSync(250 * attempt);
      fs.renameSync(source, target);
      return;
    } catch (err) {
      lastErr = err;
      if (err?.code === 'EXDEV') break;
      if (err?.code !== 'EPERM' && err?.code !== 'EBUSY') throw err;
    }
  }
  try {
    fs.cpSync(source, target, { recursive: true });
    fs.rmSync(source, { recursive: true, force: true });
  } catch {
    throw lastErr;
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function readHiddenRuntimeOwner(hiddenRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(hiddenRoot, HIDDEN_RUNTIME_OWNER_FILE), 'utf8'));
  } catch {
    return null;
  }
}

function hiddenRuntimeOwnedByActiveBuild(hiddenRoot) {
  const owner = readHiddenRuntimeOwner(hiddenRoot);
  if (!owner) return false;
  if (owner.projectRoot && path.resolve(owner.projectRoot) !== PROJECT_ROOT) return true;
  return isProcessAlive(Number(owner.pid));
}

function hiddenRuntimeRelPaths(hiddenRoot) {
  return DESKTOP_RUNTIME_REL_PATHS.filter((relPath) => (
    fs.existsSync(path.join(hiddenRoot, relPath))
  ));
}

function restoreStaleHiddenRuntimeResources() {
  const hiddenBase = runtimeHiddenBase();
  if (!fs.existsSync(hiddenBase)) return;

  const entries = fs.readdirSync(hiddenBase, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(HIDDEN_RUNTIME_PREFIX)) continue;

    const hiddenRoot = path.join(hiddenBase, entry.name);
    const hiddenRelPaths = hiddenRuntimeRelPaths(hiddenRoot);
    if (hiddenRelPaths.length === 0) {
      try { fs.rmSync(hiddenRoot, { recursive: true, force: true }); } catch {}
      continue;
    }

    if (hiddenRuntimeOwnedByActiveBuild(hiddenRoot)) {
      console.warn(`[next-build] Found runtime resources hidden by an active build, skipping restore: ${hiddenRoot}`);
      continue;
    }

    const restored = [];
    for (const relPath of hiddenRelPaths) {
      const source = path.join(PROJECT_ROOT, relPath);
      const target = path.join(hiddenRoot, relPath);
      if (fs.existsSync(source)) {
        console.warn(`[next-build] Stale hidden runtime resource not restored because source already exists: ${relPath}`);
        continue;
      }

      fs.mkdirSync(path.dirname(source), { recursive: true });
      moveDir(target, source);
      restored.push(relPath);
    }

    if (restored.length > 0) {
      console.log(`[next-build] Restored stale hidden runtime resources: ${restored.join(', ')}`);
    }

    try { fs.rmSync(hiddenRoot, { recursive: true, force: true }); } catch {}
  }
}

function writeHiddenRuntimeOwner(hiddenRoot) {
  const owner = {
    pid: process.pid,
    projectRoot: PROJECT_ROOT,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(hiddenRoot, HIDDEN_RUNTIME_OWNER_FILE),
    `${JSON.stringify(owner, null, 2)}\n`,
  );
}

function hideDesktopRuntimeResources() {
  if (process.env.LUMOS_NEXT_HIDE_RUNTIME_RESOURCES === '0') {
    return () => {};
  }

  const hiddenBase = runtimeHiddenBase();
  const hiddenRoot = fs.mkdtempSync(path.join(hiddenBase, HIDDEN_RUNTIME_PREFIX));
  const moved = [];
  writeHiddenRuntimeOwner(hiddenRoot);

  try {
    for (const relPath of DESKTOP_RUNTIME_REL_PATHS) {
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
restoreStaleHiddenRuntimeResources();
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
