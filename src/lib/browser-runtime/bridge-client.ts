import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BrowserBridgeRuntimeConfig {
  baseUrl: string;
  token: string;
  source: 'env' | 'runtime-file';
  browserContextId?: string;
  lockOwnerId?: string;
}

export interface ResolveBrowserBridgeRuntimeConfigOptions {
  browserContextId?: string | null;
  lockOwnerId?: string | null;
}

export interface BrowserBridgeResponse {
  ok?: boolean;
  error?: string;
  message?: string;
}

interface BrowserBridgeRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

function pickNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function getConfiguredDataDir(): string {
  return process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildHeaders(config: BrowserBridgeRuntimeConfig): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'x-lumos-bridge-token': config.token,
    ...(config.browserContextId ? { 'x-lumos-browser-context-id': config.browserContextId } : {}),
    ...(config.lockOwnerId ? { 'x-lumos-browser-owner-id': config.lockOwnerId } : {}),
  };
}

function buildBridgeUrl(config: BrowserBridgeRuntimeConfig, pathname: string): string {
  const url = new URL(`${config.baseUrl}${pathname}`);
  if (config.browserContextId?.trim()) {
    url.searchParams.set('browserContextId', config.browserContextId.trim());
  }
  return url.toString();
}

export function resolveBrowserBridgeRuntimeConfig(
  options: ResolveBrowserBridgeRuntimeConfigOptions = {},
): BrowserBridgeRuntimeConfig | null {
  const envUrl = pickNonEmpty(process.env.LUMOS_BROWSER_BRIDGE_URL);
  const envToken = pickNonEmpty(process.env.LUMOS_BROWSER_BRIDGE_TOKEN);
  const requestedBrowserContextId = pickNonEmpty(options.browserContextId || undefined);
  const envBrowserContextId = pickNonEmpty(process.env.LUMOS_BROWSER_CONTEXT_ID);
  const requestedLockOwnerId = pickNonEmpty(options.lockOwnerId || undefined);
  const envLockOwnerId = pickNonEmpty(process.env.LUMOS_BROWSER_LOCK_OWNER, process.env.LUMOS_SESSION_ID);
  if (envUrl && envToken) {
    return {
      baseUrl: normalizeBaseUrl(envUrl),
      token: envToken,
      source: 'env',
      ...(pickNonEmpty(requestedBrowserContextId, envBrowserContextId)
        ? { browserContextId: pickNonEmpty(requestedBrowserContextId, envBrowserContextId) }
        : {}),
      ...(pickNonEmpty(requestedLockOwnerId, envLockOwnerId)
        ? { lockOwnerId: pickNonEmpty(requestedLockOwnerId, envLockOwnerId) }
        : {}),
    };
  }

  try {
    const runtimePath = path.join(getConfiguredDataDir(), 'runtime', 'browser-bridge.json');
    if (!fs.existsSync(runtimePath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as {
      url?: unknown;
      token?: unknown;
      browserContextId?: unknown;
    };
    if (typeof parsed.url !== 'string' || typeof parsed.token !== 'string') {
      return null;
    }

    const runtimeBrowserContextId = typeof parsed.browserContextId === 'string' && parsed.browserContextId.trim()
      ? parsed.browserContextId.trim()
      : undefined;

    return {
      baseUrl: normalizeBaseUrl(parsed.url),
      token: parsed.token,
      source: 'runtime-file',
      ...(pickNonEmpty(requestedBrowserContextId, runtimeBrowserContextId)
        ? { browserContextId: pickNonEmpty(requestedBrowserContextId, runtimeBrowserContextId) }
        : {}),
      ...(pickNonEmpty(requestedLockOwnerId, envLockOwnerId)
        ? { lockOwnerId: pickNonEmpty(requestedLockOwnerId, envLockOwnerId) }
        : {}),
    };
  } catch {
    return null;
  }
}

async function parseBridgeResponse<T extends BrowserBridgeResponse>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok || !payload?.ok) {
    const errorMessage = payload?.message || payload?.error || `BROWSER_BRIDGE_HTTP_${response.status}`;
    throw new Error(errorMessage);
  }
  return payload;
}

export async function getFromBrowserBridge<T extends BrowserBridgeResponse>(
  config: BrowserBridgeRuntimeConfig,
  pathname: string,
  options?: BrowserBridgeRequestOptions,
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? resolveDefaultBridgeTimeoutMs(pathname);
  const response = await fetchFromBrowserBridge(
    buildBridgeUrl(config, pathname),
    {
      method: 'GET',
      headers: buildHeaders(config),
    },
    {
      signal: options?.signal,
      timeoutMs,
      timeoutMessage: `Browser bridge request timed out (${timeoutMs}ms): ${pathname}`,
    },
  );

  return parseBridgeResponse<T>(response);
}

const DEFAULT_BRIDGE_TIMEOUT_MS = 30_000;
const DEFAULT_NAVIGATE_BRIDGE_TIMEOUT_MS = 120_000;
const DEFAULT_NEW_PAGE_BRIDGE_TIMEOUT_MS = 60_000;
const DEFAULT_PAGE_READ_BRIDGE_TIMEOUT_MS = 60_000;

function resolveDefaultBridgeTimeoutMs(pathname: string): number {
  switch (pathname) {
    case '/v1/pages/navigate':
      return DEFAULT_NAVIGATE_BRIDGE_TIMEOUT_MS;
    case '/v1/pages/new':
      return DEFAULT_NEW_PAGE_BRIDGE_TIMEOUT_MS;
    case '/v1/pages/snapshot':
    case '/v1/pages/screenshot':
      return DEFAULT_PAGE_READ_BRIDGE_TIMEOUT_MS;
    default:
      return DEFAULT_BRIDGE_TIMEOUT_MS;
  }
}

async function fetchFromBrowserBridge(
  url: string,
  init: RequestInit,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    timeoutMessage: string;
  },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted && !(options.signal?.aborted)) {
      throw new Error(options.timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function postToBrowserBridge<T extends BrowserBridgeResponse>(
  config: BrowserBridgeRuntimeConfig,
  pathname: string,
  body: Record<string, unknown>,
  options?: BrowserBridgeRequestOptions,
): Promise<T> {
  // When the endpoint contract already carries timeoutMs in the request body,
  // keep the transport timeout aligned so long waits are not aborted at the
  // default 30s client boundary before the bridge can respond.
  const bodyTimeoutMs = typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs) && body.timeoutMs > 0
    ? body.timeoutMs
    : undefined;
  const timeoutMs = options?.timeoutMs ?? bodyTimeoutMs ?? resolveDefaultBridgeTimeoutMs(pathname);
  const response = await fetchFromBrowserBridge(
    buildBridgeUrl(config, pathname),
    {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    },
    {
      signal: options?.signal,
      timeoutMs,
      timeoutMessage: `Browser bridge request timed out (${timeoutMs}ms): ${pathname}`,
    },
  );
  return await parseBridgeResponse<T>(response);
}

export async function checkBrowserBridgeReady(
  config: BrowserBridgeRuntimeConfig,
): Promise<{ ready: boolean; status: number; error?: string }> {
  try {
    const response = await fetch(buildBridgeUrl(config, '/health'));
    const payload = await response.json().catch(() => null) as { ready?: boolean; error?: string } | null;
    return {
      ready: Boolean(response.ok && payload?.ready),
      status: response.status,
      ...(payload?.error ? { error: payload.error } : {}),
    };
  } catch (error) {
    return {
      ready: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
