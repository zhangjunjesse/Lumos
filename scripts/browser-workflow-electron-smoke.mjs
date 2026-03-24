#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const nextCliPath = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const electronBin = path.join(repoRoot, 'node_modules', '.bin', 'electron');
const tscCliPath = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const buildElectronScript = path.join(repoRoot, 'scripts', 'build-electron.mjs');
const smokeEntryRelativePath = 'src/lib/workflow/workflow-browser-runtime.smoke.ts';

const HEALTH_TIMEOUT_MS = 120_000;
const BRIDGE_TIMEOUT_MS = 60_000;
const PROCESS_SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_LOG_LINES = 200;

function log(message) {
  console.error(`[workflow-browser-smoke] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, '');
}

function ensureLocalBinary(binaryPath) {
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Missing local dependency binary: ${binaryPath}`);
  }
}

function appendLogs(buffer, label, chunk) {
  const text = chunk.toString('utf-8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    buffer.push(`[${label}] ${line}`);
    if (buffer.length > MAX_LOG_LINES) {
      buffer.shift();
    }
    console.error(`[${label}] ${line}`);
  }
}

function spawnManagedProcess(label, command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  const recentLogs = [];
  child.stdout?.on('data', (chunk) => appendLogs(recentLogs, label, chunk));
  child.stderr?.on('data', (chunk) => appendLogs(recentLogs, `${label}:err`, chunk));

  let exitCode = null;
  let exitSignal = null;
  child.on('exit', (code, signal) => {
    exitCode = code;
    exitSignal = signal;
  });

  return {
    label,
    child,
    recentLogs,
    get exited() {
      return exitCode !== null || exitSignal !== null;
    },
    get exitSummary() {
      return exitCode !== null
        ? `exit code ${exitCode}`
        : exitSignal !== null
          ? `signal ${exitSignal}`
          : 'still running';
    },
  };
}

async function runCommand(label, command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      if (options.echoStdout !== false) {
        appendLogs([], label, chunk);
      }
    });

    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      if (options.echoStderr !== false) {
        appendLogs([], `${label}:err`, chunk);
      }
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const result = {
        code,
        signal,
        stdout,
        stderr,
        combined: `${stdout}${stderr}`.trim(),
      };

      if (code === 0 || options.allowFailure === true) {
        resolve(result);
        return;
      }

      reject(new Error(
        `${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}\n${result.combined}`.trim(),
      ));
    });
  });
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a free port')));
        return;
      }

      server.close(() => resolve(address.port));
    });
  });
}

function buildManagedProcessError(handle, context) {
  const logs = handle.recentLogs.length > 0
    ? `\nRecent logs:\n${handle.recentLogs.join('\n')}`
    : '';
  return new Error(`${context}: ${handle.label} exited with ${handle.exitSummary}${logs}`);
}

async function waitForHttp(url, options) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    if (options.processHandle?.exited) {
      throw buildManagedProcessError(options.processHandle, `Waiting for ${url}`);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1_500);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (await options.isReady(response)) {
        return response;
      }
    } catch {
      // Keep polling until timeout.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForRuntimeConfig(runtimeConfigPath, processHandle) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < BRIDGE_TIMEOUT_MS) {
    if (processHandle?.exited) {
      throw buildManagedProcessError(processHandle, `Waiting for runtime config ${runtimeConfigPath}`);
    }

    if (fs.existsSync(runtimeConfigPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(runtimeConfigPath, 'utf-8'));
        if (typeof parsed.url === 'string' && typeof parsed.token === 'string') {
          return {
            baseUrl: normalizeBaseUrl(parsed.url),
            token: parsed.token,
          };
        }
      } catch {
        // Wait for a fully written file.
      }
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${runtimeConfigPath}`);
}

function extractLastJsonObject(text) {
  const normalized = text.trim();
  for (let index = normalized.lastIndexOf('{'); index >= 0; index = normalized.lastIndexOf('{', index - 1)) {
    const candidate = normalized.slice(index);
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning left until a valid JSON object is found.
    }
  }
  return null;
}

async function killManagedProcess(handle) {
  if (!handle) {
    return;
  }

  if (handle.exited) {
    return;
  }

  const pid = handle.child.pid;
  if (!pid) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      handle.child.kill('SIGTERM');
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    return;
  }

  const startedAt = Date.now();
  while (!handle.exited && Date.now() - startedAt < PROCESS_SHUTDOWN_TIMEOUT_MS) {
    await sleep(200);
  }

  if (handle.exited) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      handle.child.kill('SIGKILL');
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Ignore follow-up shutdown errors.
  }
}

async function compileSmokeRunner(tempRoot) {
  const distRoot = path.join(tempRoot, 'dist');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.workflow-browser-runtime.json');
  const tsBuildInfoPath = path.join(tempRoot, 'workflow-browser-runtime.tsbuildinfo');
  const bootstrapPath = path.join(tempRoot, 'workflow-browser-runtime.bootstrap.cjs');
  const emittedEntryPath = path.join(
    distRoot,
    smokeEntryRelativePath.replace(/^src\//, '').replace(/\.ts$/, '.js'),
  );

  fs.mkdirSync(tempRoot, { recursive: true });
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        extends: path.join(repoRoot, 'tsconfig.json'),
        compilerOptions: {
          noEmit: false,
          outDir: distRoot,
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'ES2022',
          baseUrl: repoRoot,
          incremental: false,
          tsBuildInfoFile: tsBuildInfoPath,
          isolatedModules: false,
          verbatimModuleSyntax: false,
        },
        include: [
          path.join(repoRoot, 'next-env.d.ts'),
          path.join(repoRoot, smokeEntryRelativePath),
        ],
      },
      null,
      2,
    ),
    'utf-8',
  );

  const compileResult = await runCommand(
    'tsc',
    process.execPath,
    [tscCliPath, '-p', tsconfigPath, '--pretty', 'false', '--noEmitOnError', 'false'],
    { allowFailure: true },
  );

  if (compileResult.code !== 0) {
    log('TypeScript emitted diagnostics during smoke compilation; continuing because emit succeeded.');
  }

  if (!fs.existsSync(emittedEntryPath)) {
    throw new Error(`Smoke entry was not emitted:\n${compileResult.combined}`.trim());
  }

  fs.writeFileSync(
    bootstrapPath,
    [
      `const tsconfigPaths = require(${JSON.stringify(path.join(repoRoot, 'node_modules', 'tsconfig-paths'))});`,
      `tsconfigPaths.register(${JSON.stringify({
        baseUrl: distRoot,
        paths: {
          '@/*': ['*'],
        },
      })});`,
      `require(${JSON.stringify(emittedEntryPath)});`,
    ].join('\n'),
    'utf-8',
  );

  return {
    bootstrapPath,
    compileResult,
  };
}

async function main() {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] || '', 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
    throw new Error(`Node 22+ is required. Current version: ${process.versions.node}`);
  }

  ensureLocalBinary(nextCliPath);
  ensureLocalBinary(electronBin);
  ensureLocalBinary(tscCliPath);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-browser-workflow-smoke-'));
  const instanceDir = path.join(tempRoot, 'instance');
  const claudeDir = path.join(instanceDir, '.claude');
  const tempHomeDir = path.join(tempRoot, 'home');
  const tempConfigDir = path.join(tempHomeDir, '.config');
  const smokeBuildRoot = path.join(tempRoot, 'smoke-build');
  const nextDistDir = '.next-workflow-smoke';
  const runtimeConfigPath = path.join(instanceDir, 'runtime', 'browser-bridge.json');
  const keepTempRoot = process.env.LUMOS_KEEP_BROWSER_SMOKE_TMP === '1';
  const port = await getFreePort();
  const nodeBinDir = path.dirname(process.execPath);
  const nodePath = [
    path.join(repoRoot, 'node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean).join(path.delimiter);

  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(tempHomeDir, { recursive: true });
  fs.mkdirSync(tempConfigDir, { recursive: true });

  const sharedEnv = {
    ...process.env,
    PATH: process.env.PATH ? `${nodeBinDir}:${process.env.PATH}` : nodeBinDir,
    NODE_PATH: nodePath,
    HOME: tempHomeDir,
    USERPROFILE: tempHomeDir,
    XDG_CONFIG_HOME: tempConfigDir,
    PORT: String(port),
    LUMOS_DEV_SERVER_PORT: String(port),
    LUMOS_SERVER_PORT: String(port),
    LUMOS_DATA_DIR: instanceDir,
    LUMOS_CLAUDE_CONFIG_DIR: claudeDir,
    LUMOS_NEXT_DIST_DIR: nextDistDir,
    LUMOS_BROWSER_SMOKE_TARGET_URL: `http://127.0.0.1:${port}/api/health`,
    NEXT_TELEMETRY_DISABLED: '1',
  };

  let nextHandle = null;
  let electronHandle = null;
  let completed = false;

  try {
    log(`temp root: ${tempRoot}`);
    log(`instance dir: ${instanceDir}`);
    log('building Electron main/preload bundle');
    await runCommand('build-electron', process.execPath, [buildElectronScript], {
      cwd: repoRoot,
      env: sharedEnv,
    });

    log(`starting Next dev server on http://127.0.0.1:${port}`);
    nextHandle = spawnManagedProcess('next', process.execPath, [nextCliPath, 'dev', '-p', String(port)], {
      cwd: repoRoot,
      env: sharedEnv,
    });

    await waitForHttp(`http://127.0.0.1:${port}/api/health`, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      processHandle: nextHandle,
      isReady: async (response) => response.ok,
    });

    log('starting Electron app');
    electronHandle = spawnManagedProcess('electron', electronBin, ['.'], {
      cwd: repoRoot,
      env: sharedEnv,
    });

    const bridgeConfig = await waitForRuntimeConfig(runtimeConfigPath, electronHandle);
    await waitForHttp(`${bridgeConfig.baseUrl}/health`, {
      timeoutMs: BRIDGE_TIMEOUT_MS,
      processHandle: electronHandle,
      isReady: async (response) => {
        if (!response.ok) {
          return false;
        }

        const payload = await response.json().catch(() => null);
        return payload?.ready === true;
      },
    });

    log('compiling workflow browser runtime smoke');
    const { bootstrapPath } = await compileSmokeRunner(smokeBuildRoot);

    log('running workflow browser runtime smoke');
    const smokeResult = await runCommand(
      'smoke',
      process.execPath,
      [bootstrapPath],
      {
        cwd: repoRoot,
        env: {
          ...sharedEnv,
          LUMOS_BROWSER_BRIDGE_URL: bridgeConfig.baseUrl,
          LUMOS_BROWSER_BRIDGE_TOKEN: bridgeConfig.token,
        },
        echoStdout: false,
      },
    );

    const smokePayload = extractLastJsonObject(smokeResult.stdout);
    if (!smokePayload) {
      throw new Error(`Failed to parse smoke JSON output:\n${smokeResult.stdout}`.trim());
    }

    if (smokePayload.skipped) {
      throw new Error(`Browser runtime smoke unexpectedly skipped: ${JSON.stringify(smokePayload)}`);
    }

    console.log(JSON.stringify({
      skipped: false,
      port,
      tempRoot,
      instanceDir,
      bridgeConfig: {
        baseUrl: bridgeConfig.baseUrl,
      },
      smoke: smokePayload,
    }, null, 2));
    completed = true;
  } finally {
    await killManagedProcess(electronHandle);
    await killManagedProcess(nextHandle);

    if (keepTempRoot || !completed) {
      log(`kept temp root for inspection: ${tempRoot}`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    fs.rmSync(path.join(repoRoot, nextDistDir), { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
