import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface BrowserBridgeRuntimeConfig {
  baseUrl: string;
  token: string;
  source: 'env' | 'runtime-file';
}

interface BrowserBridgeResponse {
  ok?: boolean;
  error?: string;
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

export async function postToBrowserBridge<T extends BrowserBridgeResponse>(
  config: BrowserBridgeRuntimeConfig,
  pathname: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-lumos-bridge-token': config.token,
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok || !payload?.ok) {
    const errorMessage = payload?.error || `BROWSER_BRIDGE_HTTP_${response.status}`;
    throw new Error(errorMessage);
  }

  return payload;
}
