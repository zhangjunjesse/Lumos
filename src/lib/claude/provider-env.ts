import type { ApiProvider } from '@/types';

const CLAUDE_AUTH_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
] as const;

export type ClaudeAuthEnvKey = typeof CLAUDE_AUTH_ENV_KEYS[number];
export type AnthropicProvider = ApiProvider & {
  provider_type: 'anthropic';
};

export type ClaudeLocalAuthProvider = AnthropicProvider & {
  auth_mode: 'local_auth';
};

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
    applyExtraEnv(env, parseProviderExtraEnv(provider.extra_env), {
      blockAuthEnv: true,
    });

    return {
      activeProvider: provider,
      authSource: 'local_auth',
      usesLocalAuth: true,
    };
  }

  if (provider?.api_key) {
    env.ANTHROPIC_AUTH_TOKEN = provider.api_key;
    env.ANTHROPIC_API_KEY = provider.api_key;

    if (provider.base_url) {
      env.ANTHROPIC_BASE_URL = provider.base_url;
    }

    applyExtraEnv(env, parseProviderExtraEnv(provider.extra_env));

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
