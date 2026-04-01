/**
 * MCP environment variable enrichers.
 *
 * Each built-in MCP that needs runtime env injection registers an enricher here.
 * Adding a new built-in MCP: write an enricher function + add to ENRICHER_MAP.
 */
import fs from 'fs';
import path from 'path';
import { dataDir } from '@/lib/db';
import { getFeishuCredentials } from '@/lib/feishu-config';
import { resolveProviderForCapability } from '@/lib/provider-resolver';

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-image-preview';

/** Context passed to every enricher. Built once per resolve call. */
export interface McpEnrichContext {
  sessionWorkingDirectory?: string;
  sessionId?: string;
  dataDir: string;
  /** Browser bridge info from HTTP request headers (chat route only). */
  browserBridgeOverride?: { url?: string; token?: string };
}

export type McpEnvEnricher = (
  env: Record<string, string>,
  context: McpEnrichContext,
) => Record<string, string>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickNonEmpty(...values: Array<string | undefined>): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function parseExtraEnv(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') env[k] = v;
    }
    return env;
  } catch {
    return {};
  }
}

/** Read browser bridge URL/token from ~/.lumos/runtime/browser-bridge.json. */
export function readBrowserBridgeFromRuntimeFile(): { url?: string; token?: string } {
  try {
    const runtimePath = path.join(dataDir, 'runtime', 'browser-bridge.json');
    if (!fs.existsSync(runtimePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf-8')) as { url?: unknown; token?: unknown };
    return {
      url: typeof parsed.url === 'string' ? parsed.url : undefined,
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Enricher functions
// ---------------------------------------------------------------------------

function enrichFeishuEnv(env: Record<string, string>, ctx: McpEnrichContext): Record<string, string> {
  const { appId, appSecret } = getFeishuCredentials();
  return {
    ...env,
    FEISHU_APP_ID: appId,
    FEISHU_APP_SECRET: appSecret,
    FEISHU_TOKEN_PATH: path.join(ctx.dataDir, 'auth', 'feishu.json'),
  };
}

function enrichBilibiliEnv(env: Record<string, string>): Record<string, string> {
  if (env.BILIBILI_SESSDATA) return env;
  return { ...env, BILIBILI_SESSDATA: process.env.BILIBILI_SESSDATA || '' };
}

function enrichBrowserBridgeEnv(env: Record<string, string>, ctx: McpEnrichContext): Record<string, string> {
  const runtimeBridge = readBrowserBridgeFromRuntimeFile();
  return {
    ...env,
    LUMOS_BROWSER_BRIDGE_URL: pickNonEmpty(
      ctx.browserBridgeOverride?.url,
      runtimeBridge.url,
      process.env.LUMOS_BROWSER_BRIDGE_URL,
      env.LUMOS_BROWSER_BRIDGE_URL,
    ),
    LUMOS_BROWSER_BRIDGE_TOKEN: pickNonEmpty(
      ctx.browserBridgeOverride?.token,
      runtimeBridge.token,
      process.env.LUMOS_BROWSER_BRIDGE_TOKEN,
      env.LUMOS_BROWSER_BRIDGE_TOKEN,
    ),
  };
}

function enrichDeepsearchEnv(env: Record<string, string>, ctx: McpEnrichContext): Record<string, string> {
  return { ...env, LUMOS_SESSION_ID: ctx.sessionId || '' };
}

function enrichGeminiEnv(env: Record<string, string>, ctx: McpEnrichContext): Record<string, string> {
  const provider = resolveProviderForCapability({
    moduleKey: 'image',
    capability: 'image-gen',
    allowDefault: false,
  });
  const providerEnv = parseExtraEnv(provider?.extra_env);
  const providerApiKey = pickNonEmpty(provider?.api_key, providerEnv.GEMINI_API_KEY);
  const providerBaseUrl = pickNonEmpty(provider?.base_url, providerEnv.GEMINI_BASE_URL);
  const providerModel = pickNonEmpty(providerEnv.GEMINI_MODEL, providerEnv.GEMINI_IMAGE_MODEL);

  return {
    ...env,
    GEMINI_API_KEY: pickNonEmpty(providerApiKey, env.GEMINI_API_KEY),
    GEMINI_BASE_URL: pickNonEmpty(providerBaseUrl, env.GEMINI_BASE_URL, DEFAULT_GEMINI_BASE_URL),
    GEMINI_MODEL: pickNonEmpty(providerModel, env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL),
    GEMINI_OUTPUT_DIR: pickNonEmpty(env.GEMINI_OUTPUT_DIR, ctx.sessionWorkingDirectory),
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ENRICHER_MAP: Record<string, McpEnvEnricher> = {
  'feishu': enrichFeishuEnv,
  'bilibili': enrichBilibiliEnv,
  'browser': enrichBrowserBridgeEnv,
  'chrome-devtools': enrichBrowserBridgeEnv,
  'chrome_devtools': enrichBrowserBridgeEnv,
  'deepsearch': enrichDeepsearchEnv,
  'gemini-image': enrichGeminiEnv,
  'gemini_image': enrichGeminiEnv,
};
