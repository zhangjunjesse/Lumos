import type { ApiProvider } from '@/types';

const CLAUDE_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

/**
 * Cloud provisioner 把 new-api 的 channel id 写在 extra_env 的这个 key 下，
 * 请求路径需要把它翻译成 HTTP 头发给 new-api（见 README 中 new-api 虚拟 provider
 * 路由章节）。不直接用 extra_env 存裸 header 字符串是为了跨 transport 复用：
 * Claude Agent SDK 走子进程 env，AI SDK 走 SDK 参数，入口解析一次即可。
 */
const UPSTREAM_CHANNEL_ENV_KEY = 'LUMOS_UPSTREAM_CHANNEL_ID';
const NEWAPI_SPECIFIC_CHANNEL_HEADER = 'Specific-Channel-Id';
const ADMIN_DEFAULT_MODEL_ENV_KEY = 'LUMOS_DEFAULT_MODEL';

export type ClaudeAuthEnvKey = typeof CLAUDE_AUTH_ENV_KEYS[number];
export type AnthropicProvider = ApiProvider & {
  provider_type: 'anthropic';
};

export type ClaudeLocalAuthProvider = AnthropicProvider & {
  auth_mode: 'local_auth';
};

export interface ClaudeProviderRoutingSnapshot {
  providerId?: string;
  providerName?: string;
  providerType?: string;
  apiProtocol?: string;
  authMode?: string;
  baseUrl?: string;
  upstreamChannelId?: string | null;
  anthropicCustomHeaders?: string;
}

function parseProviderExtraEnv(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Pull the new-api channel id out of extra_env. Returns a trimmed non-empty
 * string when the provisioner wrote one, or null otherwise. The value is a
 * string (not number) to stay honest about JSON env shape and let callers
 * splice it straight into a header.
 */
export function getUpstreamChannelIdFromExtraEnv(
  extraEnv: Record<string, string>,
): string | null {
  const raw = (extraEnv[UPSTREAM_CHANNEL_ENV_KEY] || '').trim();
  return raw.length > 0 ? raw : null;
}

/**
 * Pull the admin-configured default model from a system provider's extra_env.
 * Provisioner writes it under LUMOS_DEFAULT_MODEL. Empty string means the
 * admin didn't set one — caller should fall back to model_catalog[0].
 */
export function getAdminDefaultModelFromExtraEnv(
  extraEnv: Record<string, string>,
): string {
  return (extraEnv[ADMIN_DEFAULT_MODEL_ENV_KEY] || '').trim();
}

/**
 * Effective default model for a provider in priority order:
 *   1. user-set api_providers.default_model column (UI override)
 *   2. admin-set extra_env.LUMOS_DEFAULT_MODEL (provisioner sync)
 *   3. empty (let consumer fall back to catalog[0])
 *
 * UI shows the admin value when the user hasn't overridden it; consumer
 * code (chat route, workflow subagent) uses this same precedence so what
 * the user sees in 设置 → 服务商 matches what runs.
 */
export function getProviderEffectiveDefaultModel(
  provider: { default_model?: string; extra_env?: string } | null | undefined,
): string {
  if (!provider) return '';
  const userOverride = (provider.default_model || '').trim();
  if (userOverride) return userOverride;
  const env = parseProviderExtraEnv(provider.extra_env);
  return getAdminDefaultModelFromExtraEnv(env);
}

/**
 * new-api v0.12.x only hard-pins a request onto a specific channel when the
 * admin token is called as `sk-...-<channelId>`. Keep the older
 * `Specific-Channel-Id` header as a compatibility hint for gateways that still
 * inspect custom headers, but use the token suffix as the authoritative route.
 */
export function applyUpstreamChannelIdToApiKey(
  apiKey: string | null | undefined,
  upstreamChannelId: string | null | undefined,
): string {
  const trimmedApiKey = (apiKey || '').trim();
  const channelId = (upstreamChannelId || '').trim();
  if (!trimmedApiKey || !channelId) {
    return trimmedApiKey;
  }

  const suffix = `-${channelId}`;
  return trimmedApiKey.endsWith(suffix) ? trimmedApiKey : `${trimmedApiKey}${suffix}`;
}

/**
 * Convert the Lumos-private `LUMOS_UPSTREAM_CHANNEL_ID` hint into a
 * `Specific-Channel-Id: <id>` line merged into `ANTHROPIC_CUSTOM_HEADERS`,
 * which Claude Agent SDK's CLI passes through as an HTTP request header.
 * The private key itself is stripped so it does not leak into the child
 * process as a dead env var.
 */
function translateUpstreamChannelEnv(
  extraEnv: Record<string, string>,
): Record<string, string> {
  const channelId = getUpstreamChannelIdFromExtraEnv(extraEnv);
  if (!channelId) return extraEnv;

  const { [UPSTREAM_CHANNEL_ENV_KEY]: _private, ...rest } = extraEnv;
  void _private;
  const headerLine = `${NEWAPI_SPECIFIC_CHANNEL_HEADER}: ${channelId}`;
  const prior = (rest.ANTHROPIC_CUSTOM_HEADERS || '').trim();
  const merged = prior ? `${prior}\n${headerLine}` : headerLine;
  return { ...rest, ANTHROPIC_CUSTOM_HEADERS: merged };
}

export function getClaudeProviderRoutingSnapshot(
  provider?: ApiProvider | null,
): ClaudeProviderRoutingSnapshot | null {
  if (!provider) {
    return null;
  }

  const extraEnv = parseProviderExtraEnv(provider.extra_env);
  const translatedEnv = translateUpstreamChannelEnv(extraEnv);
  const upstreamChannelId = getUpstreamChannelIdFromExtraEnv(extraEnv);
  const anthropicCustomHeaders = translatedEnv.ANTHROPIC_CUSTOM_HEADERS?.trim() || '';

  return {
    providerId: provider.id,
    providerName: provider.name,
    providerType: provider.provider_type,
    apiProtocol: provider.api_protocol,
    authMode: provider.auth_mode,
    baseUrl: provider.base_url || undefined,
    upstreamChannelId,
    ...(anthropicCustomHeaders ? { anthropicCustomHeaders } : {}),
  };
}

export function isClaudeLocalAuthProvider(
  provider?: ApiProvider | null,
): provider is ClaudeLocalAuthProvider {
  return Boolean(
    provider
    && provider.provider_type === 'anthropic'
    && provider.auth_mode === 'local_auth',
  );
}

export function isAnthropicProvider(
  provider?: ApiProvider | null,
): provider is AnthropicProvider {
  return Boolean(provider && provider.provider_type === 'anthropic');
}

export function clearClaudeAndAnthropicEnv(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    if (key.startsWith('CLAUDE_') || key.startsWith('ANTHROPIC_')) {
      delete env[key];
    }
  }
}

function applyExtraEnv(
  env: Record<string, string>,
  extraEnv: Record<string, string>,
  options?: {
    blockAuthEnv?: boolean;
  },
): void {
  const blockedKeys = options?.blockAuthEnv
    ? new Set<ClaudeAuthEnvKey>(CLAUDE_AUTH_ENV_KEYS)
    : null;

  for (const [key, value] of Object.entries(extraEnv)) {
    if (blockedKeys?.has(key as ClaudeAuthEnvKey)) {
      continue;
    }

    if (value === '') {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
}

export interface InjectedClaudeProviderEnvResult {
  activeProvider?: ApiProvider;
  authSource: 'provider' | 'local_auth' | 'none';
  usesLocalAuth: boolean;
}

export function injectClaudeProviderEnv(
  env: Record<string, string>,
  provider?: ApiProvider,
): InjectedClaudeProviderEnvResult {
  if (isClaudeLocalAuthProvider(provider)) {
    applyExtraEnv(env, translateUpstreamChannelEnv(parseProviderExtraEnv(provider.extra_env)), {
      blockAuthEnv: true,
    });

    return {
      activeProvider: provider,
      authSource: 'local_auth',
      usesLocalAuth: true,
    };
  }

  if (provider?.api_key) {
    const parsedExtraEnv = parseProviderExtraEnv(provider.extra_env);
    const upstreamChannelId = getUpstreamChannelIdFromExtraEnv(parsedExtraEnv);
    const routedApiKey = applyUpstreamChannelIdToApiKey(provider.api_key, upstreamChannelId);

    env.ANTHROPIC_AUTH_TOKEN = routedApiKey;
    env.ANTHROPIC_API_KEY = routedApiKey;

    if (provider.base_url) {
      env.ANTHROPIC_BASE_URL = provider.base_url;
    }

    applyExtraEnv(env, translateUpstreamChannelEnv(parsedExtraEnv));

    return {
      activeProvider: provider,
      authSource: 'provider',
      usesLocalAuth: false,
    };
  }

  return {
    activeProvider: provider,
    authSource: 'none',
    usesLocalAuth: false,
  };
}
