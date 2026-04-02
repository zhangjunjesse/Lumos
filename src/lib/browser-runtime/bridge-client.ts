import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BrowserBridgeRuntimeConfig {
  baseUrl: string;
  token: string;
  source: 'env' | 'runtime-file';
}

export interface BrowserBridgeResponse {
  ok?: boolean;
  error?: string;
  message?: string;
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
  };
}

export function resolveBrowserBridgeRuntimeConfig(): BrowserBridgeRuntimeConfig | null {
  const envUrl = pickNonEmpty(process.env.LUMOS_BROWSER_BRIDGE_URL);
  const envToken = pickNonEmpty(process.env.LUMOS_BROWSER_BRIDGE_TOKEN);
  if (envUrl && envToken) {
    return {
      baseUrl: normalizeBaseUrl(envUrl),
      token: envToken,
      source: 'env',
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
    };
    if (typeof parsed.url !== 'string' || typeof parsed.token !== 'string') {
      return null;
    }

    return {
      baseUrl: normalizeBaseUrl(parsed.url),
      token: parsed.token,
      source: 'runtime-file',
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
): Promise<T> {
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    method: 'GET',
    headers: buildHeaders(config),
  });

  return parseBridgeResponse<T>(response);
}

export async function postToBrowserBridge<T extends BrowserBridgeResponse>(
  config: BrowserBridgeRuntimeConfig,
  pathname: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(body),
  });

  return parseBridgeResponse<T>(response);
}

export async function checkBrowserBridgeReady(
  config: BrowserBridgeRuntimeConfig,
): Promise<{ ready: boolean; status: number; error?: string }> {
  try {
    const response = await fetch(`${config.baseUrl}/health`);
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
