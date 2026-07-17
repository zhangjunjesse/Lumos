import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import readline from 'readline';
import type { ApiProvider } from '@/types';
import { findBundledClaudeSdkCliPath } from '@/lib/claude/sdk-paths';
import {
  findGitBash,
  getClaudeConfigDir,
  getExpandedPath,
} from '@/lib/platform';
import { sanitizeEnv } from '@/lib/claude/utils';
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources';
import {
  clearClaudeAndAnthropicEnv,
  isClaudeLocalAuthProvider,
} from './provider-env';

const LOCAL_AUTH_PROBE_TIMEOUT_MS = 15000;
const LOCAL_AUTH_STATUS_CACHE_TTL_MS = 60_000;

let cachedLocalAuthStatus:
  | {
      expiresAt: number;
      value: ClaudeLocalAuthStatus;
    }
  | null = null;

let inflightLocalAuthStatusPromise: Promise<ClaudeLocalAuthStatus> | null = null;

interface ClaudeProbeInitMessage {
  type?: string;
  subtype?: string;
  apiKeySource?: string;
  tokenSource?: string;
  claude_code_version?: string;
  model?: string;
}

interface ClaudeProbeAssistantContentBlock {
  type?: string;
  text?: string;
}

interface ClaudeProbeAssistantMessage {
  type?: string;
  error?: string;
  message?: {
    content?: ClaudeProbeAssistantContentBlock[] | string;
  };
}

interface ClaudeProbeResultMessage {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
}

export interface ClaudeLocalAuthStatus {
  available: boolean;
  authenticated: boolean;
  status: 'authenticated' | 'missing' | 'error';
  configDir: string;
  runtimeVersion?: string | null;
  authSource?: string | null;
  error?: string;
}

export class ClaudeLocalAuthRequiredError extends Error {
  code = 'CLAUDE_LOCAL_AUTH_REQUIRED';
  status: ClaudeLocalAuthStatus;

  constructor(message: string, status: ClaudeLocalAuthStatus) {
    super(message);
    this.name = 'ClaudeLocalAuthRequiredError';
    this.status = status;
  }
}

function stripAnsi(value: string): string {
  return value.replace(
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    '',
  );
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getClaudeRuntimeNodePath(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const relativePath = path.join(
    'node-runtime',
    process.platform,
    process.arch,
    `node${ext}`,
  );
  const bundledNode = resolveRuntimeResourcePath(relativePath);

  return bundledNode || path.join(process.cwd(), 'resources', relativePath);
}

function resolveNodeCommand(): string {
  const bundledNode = getClaudeRuntimeNodePath();
  if (fs.existsSync(bundledNode)) {
    return bundledNode;
  }

  return process.execPath;
}

/**
 * SDK 0.3.x 起 findBundledClaudeSdkCliPath() 返回的是平台原生二进制(claude / claude.exe),
 * 必须直接执行。绝不能再用 `node <binary>` —— node 会把二进制头(Mach-O / ELF / MZ)当 JS
 * 解析,直接 `SyntaxError: Invalid or unexpected token`(用户 Windows 登录时截图的正是此错)。
 * 仅当路径是 .js / .mjs / .cjs 入口(历史 SDK 薄壳)时,才退回用 Node 启动。
 */
export function isNativeCliBinary(cliPath: string): boolean {
  return !/\.[mc]?js$/i.test(cliPath);
}

/** 把 CLI 参数解析成真正可 spawn 的命令 —— 原生二进制直跑,JS 入口才套 node。 */
export function resolveCliInvocation(
  cliPath: string,
  cliArgs: string[],
): { command: string; args: string[] } {
  if (isNativeCliBinary(cliPath)) {
    return { command: cliPath, args: cliArgs };
  }

  return { command: resolveNodeCommand(), args: [cliPath, ...cliArgs] };
}

function buildLocalAuthRuntimeEnv(): Record<string, string> {
  const env = { ...process.env as Record<string, string> };

  if (!env.HOME) {
    env.HOME = os.homedir();
  }
  if (!env.USERPROFILE) {
    env.USERPROFILE = os.homedir();
  }

  env.PATH = getExpandedPath();
  env.ELECTRON_RUN_AS_NODE = '1';

  clearClaudeAndAnthropicEnv(env);

  const claudeConfigDir = getClaudeConfigDir();
  env.CLAUDE_CONFIG_DIR = claudeConfigDir;

  if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    const gitBashPath = findGitBash();
    if (gitBashPath) {
      env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
    }
  }

  return sanitizeEnv(env);
}

function buildProbeArgs(): string[] {
  return [
    '-p',
    'ping',
    '--verbose',
    '--output-format',
    'stream-json',
    '--permission-mode',
    'plan',
    '--no-session-persistence',
    '--setting-sources',
    'project',
    '--settings',
    '{}',
  ];
}

function buildLoginArgs(): string[] {
  return ['/login'];
}

function extractAssistantText(message?: ClaudeProbeAssistantMessage['message']): string {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function readSandboxOauthAccountHint(configDir: string): boolean {
  const claudeConfigPath = path.join(configDir, '.claude.json');
  if (!fs.existsSync(claudeConfigPath)) {
    return false;
  }

  try {
    const raw = fs.readFileSync(claudeConfigPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      oauthAccount?: {
        accountUuid?: string;
      };
    };
    return Boolean(parsed.oauthAccount?.accountUuid);
  } catch {
    return false;
  }
}

function isMissingLoginMessage(value?: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized.includes('please run /login')
    || normalized.includes('not logged in');
}

const LOCAL_AUTH_ERROR_CACHE_TTL_MS = 30_000;

function getStatusCacheTtl(status: ClaudeLocalAuthStatus): number {
  if (status.authenticated) {
    return LOCAL_AUTH_STATUS_CACHE_TTL_MS;
  }

  return LOCAL_AUTH_ERROR_CACHE_TTL_MS;
}

function parseProbeLine(
  line: string,
  onInit: (message: ClaudeProbeInitMessage) => void,
  onAssistant: (message: ClaudeProbeAssistantMessage) => void,
  onError: (message: ClaudeProbeResultMessage | string) => void,
  onResult: (message: ClaudeProbeResultMessage) => void,
): void {
  const trimmed = stripAnsi(line).trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return;
  }

  const initMessage = safeJsonParse<ClaudeProbeInitMessage>(trimmed);
  if (initMessage?.type === 'system' && initMessage.subtype === 'init') {
    onInit(initMessage);
    return;
  }

  const assistantMessage = safeJsonParse<ClaudeProbeAssistantMessage>(trimmed);
  if (assistantMessage?.type === 'assistant') {
    onAssistant(assistantMessage);
    return;
  }

  const resultMessage = safeJsonParse<ClaudeProbeResultMessage>(trimmed);
  if (resultMessage?.type === 'result') {
    if (Array.isArray(resultMessage.errors) && resultMessage.errors.length > 0) {
      onError(resultMessage);
    }
    onResult(resultMessage);
  }
}

async function spawnClaudeProbeProcess(timeoutMs: number): Promise<ClaudeLocalAuthStatus> {
  const cliPath = findBundledClaudeSdkCliPath();
  const configDir = getClaudeConfigDir();

  if (!cliPath) {
    return {
      available: false,
      authenticated: false,
      status: 'error',
      configDir,
      error: '未找到 Lumos 内置 Claude Runtime',
    };
  }

  const { command: probeCommand, args: probeArgs } = resolveCliInvocation(cliPath, buildProbeArgs());
  const env = buildLocalAuthRuntimeEnv() as NodeJS.ProcessEnv;
  const hasSandboxOauthAccount = readSandboxOauthAccountHint(configDir);

  return await new Promise<ClaudeLocalAuthStatus>((resolve) => {
    let resolved = false;
    let lastError = '';
    let child: ChildProcess | null = null;
    let runtimeVersion: string | null = null;
    let authSource: string | null = null;

    const finish = (status: ClaudeLocalAuthStatus) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timer);
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
      resolve(status);
    };

    const timer = setTimeout(() => {
      finish({
        available: true,
        authenticated: false,
        status: 'error',
        configDir,
        error: lastError || 'Claude 本地登录状态检测超时',
      });
    }, timeoutMs);
    timer.unref?.();

    try {
      const spawnedChild = spawn(probeCommand, probeArgs, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child = spawnedChild;
    } catch (error) {
      finish({
        available: false,
        authenticated: false,
        status: 'error',
        configDir,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const handleLine = (line: string) => {
      parseProbeLine(
        line,
        (message) => {
          runtimeVersion = message.claude_code_version || null;
          authSource = message.tokenSource || message.apiKeySource || null;
          // Init message already contains auth source — if valid, resolve immediately
          // without waiting for the full ping roundtrip to the API.
          if (authSource && authSource !== 'none') {
            finish({
              available: true,
              authenticated: true,
              status: 'authenticated',
              configDir,
              runtimeVersion,
              authSource,
            });
          }
        },
        (message) => {
          const assistantText = extractAssistantText(message.message);
          if (message.error === 'authentication_failed' || isMissingLoginMessage(assistantText)) {
            finish({
              available: true,
              authenticated: false,
              status: 'missing',
              configDir,
              runtimeVersion,
              authSource: 'none',
              error: hasSandboxOauthAccount
                ? '检测到 Lumos 沙箱里已有 Claude 账号信息，但当前并没有可用登录态。请重新点击“登录 / 重新登录”，并在终端执行真正的 /login 流程。'
                : undefined,
            });
            return;
          }

          if (assistantText) {
            lastError = assistantText;
          }
        },
        (message) => {
          if (typeof message === 'string') {
            lastError = message;
            return;
          }
          lastError = message.errors?.join('\n') || lastError;
        },
        (message) => {
          if (message.subtype !== 'success') {
            return;
          }

          if (message.is_error) {
            if (isMissingLoginMessage(message.result) || message.errors?.some((error) => isMissingLoginMessage(error))) {
              finish({
                available: true,
                authenticated: false,
                status: 'missing',
                configDir,
                runtimeVersion,
                authSource: 'none',
                error: hasSandboxOauthAccount
                  ? '检测到 Lumos 沙箱里已有 Claude 账号信息，但当前并没有可用登录态。请重新点击“登录 / 重新登录”，并在终端执行真正的 /login 流程。'
                  : undefined,
              });
              return;
            }

            finish({
              available: true,
              authenticated: false,
              status: 'error',
              configDir,
              runtimeVersion,
              authSource,
              error: message.result || lastError || 'Claude 本地登录状态检测失败',
            });
            return;
          }

          finish({
            available: true,
            authenticated: true,
            status: 'authenticated',
            configDir,
            runtimeVersion,
            authSource: authSource && authSource !== 'none' ? authSource : 'local_auth',
          });
        },
      );
    };

    if (!child) {
      finish({
        available: false,
        authenticated: false,
        status: 'error',
        configDir,
        error: 'Claude 本地登录状态检测进程启动失败',
      });
      return;
    }

    if (!child.stdout || !child.stderr) {
      finish({
        available: false,
        authenticated: false,
        status: 'error',
        configDir,
        error: 'Claude 本地登录状态检测进程输出流不可用',
      });
      return;
    }

    readline.createInterface({ input: child.stdout }).on('line', handleLine);
    readline.createInterface({ input: child.stderr }).on('line', handleLine);

    child.on('error', (error) => {
      finish({
        available: false,
        authenticated: false,
        status: 'error',
        configDir,
        error: error.message,
      });
    });

    child.on('exit', () => {
      if (!resolved) {
        finish({
          available: true,
          authenticated: false,
          status: 'error',
          configDir,
          error: lastError || 'Claude 本地登录状态检测失败',
        });
      }
    });
  });
}

function quoteForShell(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildLoginCommand(cliPath: string, configDir: string): string {
  const { command, args } = resolveCliInvocation(cliPath, buildLoginArgs());
  const invocation = [command, ...args].map(quoteForShell).join(' ');
  if (process.platform === 'win32') {
    return `set "CLAUDE_CONFIG_DIR=${configDir}" && set "ELECTRON_RUN_AS_NODE=1" && ${invocation}`;
  }

  return `CLAUDE_CONFIG_DIR=${quoteForShell(configDir)} ELECTRON_RUN_AS_NODE=1 ${invocation}`;
}

/**
 * Windows 登录用临时 bat。每步独立 set + 引号包路径,整体由 bat 执行——
 * 避免内联 `set "X=Y" && ... && "claude.exe" /login` 经 cmd /c start ... cmd /k 多层
 * 传递时被嵌套引号 / && 拆坏(实测会把整条命令当文字喂给 claude,/login 根本没跑)。
 */
function buildWindowsLoginBat(cliPath: string, configDir: string): string {
  const { command, args } = resolveCliInvocation(cliPath, buildLoginArgs());
  const invocation = [command, ...args].map((part) => `"${part}"`).join(' ');
  return [
    '@echo off',
    `set "CLAUDE_CONFIG_DIR=${configDir}"`,
    'set "ELECTRON_RUN_AS_NODE=1"',
    invocation,
    '',
  ].join('\r\n');
}

/**
 * Fast filesystem-based auth check.
 * If the config file has a valid oauthAccount.accountUuid, we can assume
 * the user has authenticated and skip the expensive probe process.
 * The actual token validity will be verified when the Claude SDK is used.
 */
function fastFilesystemAuthCheck(): ClaudeLocalAuthStatus | null {
  const configDir = getClaudeConfigDir();
  // .credentials.json = /login 写下的真实 OAuth token(Windows 文件态),有它即视为已登录——
  // 比只看 .claude.json 的 oauthAccount 更直接可靠;token 实际有效性仍由后续 SDK 调用验证。
  const hasCredentials = fs.existsSync(path.join(configDir, '.credentials.json'));
  if (!hasCredentials && !readSandboxOauthAccountHint(configDir)) {
    return null;
  }

  return {
    available: true,
    authenticated: true,
    status: 'authenticated',
    configDir,
    authSource: 'local_auth',
  };
}

export async function getClaudeLocalAuthStatus(
  options?: {
    timeoutMs?: number;
    forceRefresh?: boolean;
  },
): Promise<ClaudeLocalAuthStatus> {
  const timeoutMs = options?.timeoutMs ?? LOCAL_AUTH_PROBE_TIMEOUT_MS;
  const now = Date.now();

  if (!options?.forceRefresh && cachedLocalAuthStatus && cachedLocalAuthStatus.expiresAt > now) {
    return cachedLocalAuthStatus.value;
  }

  // Fast path: check config file without spawning a process.
  // Covers the common case where the user has already logged in.
  const fastResult = fastFilesystemAuthCheck();
  if (fastResult) {
    cachedLocalAuthStatus = {
      value: fastResult,
      expiresAt: Date.now() + LOCAL_AUTH_STATUS_CACHE_TTL_MS,
    };
    return fastResult;
  }

  // Slow path: spawn a probe process (only when config file has no OAuth data).
  if (inflightLocalAuthStatusPromise) {
    return await inflightLocalAuthStatusPromise;
  }

  inflightLocalAuthStatusPromise = spawnClaudeProbeProcess(timeoutMs)
    .then((status) => {
      cachedLocalAuthStatus = {
        value: status,
        expiresAt: Date.now() + getStatusCacheTtl(status),
      };
      return status;
    })
    .finally(() => {
      inflightLocalAuthStatusPromise = null;
    });

  return await inflightLocalAuthStatusPromise;
}

export async function ensureClaudeLocalAuthReady(provider?: ApiProvider): Promise<void> {
  if (!isClaudeLocalAuthProvider(provider)) {
    return;
  }

  const status = await getClaudeLocalAuthStatus();
  if (status.authenticated) {
    return;
  }

  const message = status.status === 'missing'
    ? '当前 Claude 本地登录未完成或已失效。请到 设置 > 服务商 重新登录后再试。'
    : `Claude 本地登录状态检测失败：${status.error || '未知错误'}`;

  throw new ClaudeLocalAuthRequiredError(message, status);
}

export function startClaudeLocalAuthSetup(): { command: string; configDir: string } {
  const cliPath = findBundledClaudeSdkCliPath();
  if (!cliPath) {
    throw new Error('未找到 Lumos 内置 Claude Runtime，无法启动登录流程');
  }

  const configDir = getClaudeConfigDir();
  const command = buildLoginCommand(cliPath, configDir);

  if (process.platform === 'darwin') {
    const script = `tell application "Terminal"
activate
do script ${JSON.stringify(command)}
end tell`;
    const child = spawn('osascript', ['-e', script], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { command, configDir };
  }

  if (process.platform === 'win32') {
    // 写进临时 bat 整体执行,start 只负责开新窗口跑这个 bat —— 避开内联命令的嵌套引号/&& 转义被拆坏。
    const batPath = path.join(os.tmpdir(), 'lumos-claude-login.bat');
    fs.writeFileSync(batPath, buildWindowsLoginBat(cliPath, configDir), 'utf-8');
    const child = spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return { command, configDir };
  }

  const linuxTerminals = [
    ['x-terminal-emulator', ['-e', command]],
    ['gnome-terminal', ['--', 'bash', '-lc', command]],
    ['konsole', ['-e', command]],
    ['xfce4-terminal', ['-e', command]],
  ] as const;

  for (const [terminal, args] of linuxTerminals) {
    try {
      const child = spawn(terminal, [...args], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { command, configDir };
    } catch {
      // Try the next terminal candidate.
    }
  }

  throw new Error('当前系统没有可用终端，无法自动启动 Claude 登录流程');
}
