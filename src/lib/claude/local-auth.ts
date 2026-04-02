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
import {
  clearClaudeAndAnthropicEnv,
  isClaudeLocalAuthProvider,
} from './provider-env';

const LOCAL_AUTH_PROBE_TIMEOUT_MS = 15000;
const LOCAL_AUTH_STATUS_CACHE_TTL_MS = 5000;

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
    // eslint-disable-next-line no-control-regex
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
  const bundledNode = path.join(
    process.resourcesPath || path.join(process.cwd(), 'resources'),
    'node-runtime',
    process.platform,
    process.arch,
    `node${ext}`,
  );

  return bundledNode;
}

function resolveNodeCommand(): string {
  const bundledNode = getClaudeRuntimeNodePath();
  if (fs.existsSync(bundledNode)) {
    return bundledNode;
  }

  return process.execPath;
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

function buildProbeArgs(cliPath: string): string[] {
  return [
    cliPath,
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

function buildLoginArgs(cliPath: string): string[] {
  return [cliPath, '/login'];
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

function getStatusCacheTtl(status: ClaudeLocalAuthStatus): number {
  if (status.authenticated) {
    return LOCAL_AUTH_STATUS_CACHE_TTL_MS;
  }

  return 1000;
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

  const nodePath = resolveNodeCommand();
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
      const spawnedChild = spawn(nodePath, buildProbeArgs(cliPath), {
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

function buildLoginCommand(nodePath: string, cliPath: string, configDir: string): string {
  const loginArgs = buildLoginArgs(cliPath).map(quoteForShell).join(' ');
  if (process.platform === 'win32') {
    return `set "CLAUDE_CONFIG_DIR=${configDir}" && set "ELECTRON_RUN_AS_NODE=1" && ${quoteForShell(nodePath)} ${loginArgs}`;
  }

  return `CLAUDE_CONFIG_DIR=${quoteForShell(configDir)} ELECTRON_RUN_AS_NODE=1 ${quoteForShell(nodePath)} ${loginArgs}`;
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
    ? '当前 Claude 本地登录未完成或已失效。请到 设置 > Claude 与服务商 重新登录后再试。'
    : `Claude 本地登录状态检测失败：${status.error || '未知错误'}`;

  throw new ClaudeLocalAuthRequiredError(message, status);
}

export function startClaudeLocalAuthSetup(): { command: string; configDir: string } {
  const cliPath = findBundledClaudeSdkCliPath();
  if (!cliPath) {
    throw new Error('未找到 Lumos 内置 Claude Runtime，无法启动登录流程');
  }

  const nodePath = resolveNodeCommand();
  const configDir = getClaudeConfigDir();
  const command = buildLoginCommand(nodePath, cliPath, configDir);

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
    const child = spawn('cmd.exe', ['/c', 'start', '"Lumos Claude Login"', 'cmd.exe', '/k', command], {
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
