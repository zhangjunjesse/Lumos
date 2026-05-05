#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const DEFAULT_DEV_PORT = 3000;
const START_PORT_FALLBACK_LIMIT = 40;

const children = new Set();
let shuttingDown = false;

function parsePort(value) {
  if (!value) return null;
  const parsed = Number(String(value).trim());
  if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
    return parsed;
  }
  return null;
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findDevPort() {
  const requested = parsePort(process.env.LUMOS_DEV_SERVER_PORT || process.env.PORT);
  if (requested) {
    if (await canListen(requested)) {
      return requested;
    }
    throw new Error(`Requested dev server port ${requested} is already in use.`);
  }

  for (let offset = 0; offset <= START_PORT_FALLBACK_LIMIT; offset += 1) {
    const port = DEFAULT_DEV_PORT + offset;
    if (await canListen(port)) {
      if (port !== DEFAULT_DEV_PORT) {
        console.warn(`[electron-dev] Port ${DEFAULT_DEV_PORT} is busy; using ${port}.`);
      }
      return port;
    }
  }

  throw new Error(
    `No free dev server port found in ${DEFAULT_DEV_PORT}-${DEFAULT_DEV_PORT + START_PORT_FALLBACK_LIMIT}.`,
  );
}

function resolveScript(...segments) {
  const filePath = path.join(rootDir, ...segments);
  if (!existsSync(filePath)) {
    throw new Error(`Required script not found: ${filePath}`);
  }
  return filePath;
}

function makeEnv(port) {
  const lumosHome = path.join(homedir(), '.lumos');
  return {
    ...process.env,
    HOSTNAME: '127.0.0.1',
    PORT: String(port),
    LUMOS_DEV_SERVER_PORT: String(port),
    NEXT_PUBLIC_LUMOS_EDITION:
      process.env.NEXT_PUBLIC_LUMOS_EDITION || process.env.LUMOS_EDITION || 'open',
    LUMOS_CLAUDE_CONFIG_DIR: process.env.LUMOS_CLAUDE_CONFIG_DIR || path.join(lumosHome, '.claude'),
    LUMOS_DATA_DIR: process.env.LUMOS_DATA_DIR || lumosHome,
  };
}

function spawnChild(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: rootDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  children.add(child);

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[${label}] ${chunk}`);
  });
  child.once('exit', () => {
    children.delete(child);
  });

  return child;
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }

  const suffix = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${url}.${suffix}`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (children.size === 0) {
    process.exit(code);
  }

  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    process.exit(code);
  }, 3_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

try {
  const port = await findDevPort();
  const env = makeEnv(port);
  const nextBin = resolveScript('node_modules', 'next', 'dist', 'bin', 'next');
  const electronCli = resolveScript('node_modules', 'electron', 'cli.js');

  console.log(`[electron-dev] Starting Next dev server on http://127.0.0.1:${port}`);
  const nextProcess = spawnChild('next', process.execPath, [nextBin, 'dev', '--port', String(port)], env);

  waitForExit(nextProcess).then(({ code, signal }) => {
    if (!shuttingDown) {
      console.error(`[electron-dev] Next dev exited with ${signal || code}.`);
      shutdown(code || 1);
    }
  });

  const buildProcess = spawnChild('electron-build', process.execPath, ['scripts/build-electron.mjs'], env);
  const buildResult = await waitForExit(buildProcess);
  if (buildResult.code !== 0) {
    throw new Error(`Electron build failed with ${buildResult.signal || buildResult.code}.`);
  }

  await waitForHttp(`http://127.0.0.1:${port}/api/health`);
  console.log(`[electron-dev] Launching Electron against http://127.0.0.1:${port}`);

  const electronProcess = spawnChild('electron', process.execPath, [electronCli, '.'], env);
  const electronResult = await waitForExit(electronProcess);
  shutdown(electronResult.code || 0);
} catch (error) {
  console.error('[electron-dev]', error instanceof Error ? error.message : error);
  shutdown(1);
}
