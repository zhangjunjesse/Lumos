import type {
  ProviderApiProtocol,
  ProviderAuthMode,
  ProviderCapability,
  ProviderOrigin,
} from '@/types';

const VALID_API_PROTOCOLS = new Set<ProviderApiProtocol>([
  'anthropic-messages',
  'openai-compatible',
]);

const VALID_PROVIDER_CAPABILITIES = new Set<ProviderCapability>([
  'agent-chat',
  'text-gen',
  'image-gen',
  'embedding',
]);

const VALID_PROVIDER_ORIGINS = new Set<ProviderOrigin>([
  'system',
  'preset',
  'custom',
]);

const VALID_PROVIDER_AUTH_MODES = new Set<ProviderAuthMode>([
  'api_key',
  'local_auth',
]);

export function normalizeProviderType(providerType?: string | null): string {
  const normalized = providerType?.trim();
  return normalized || 'anthropic';
}

export function getDefaultApiProtocolForProviderType(providerType?: string | null): ProviderApiProtocol {
  switch (normalizeProviderType(providerType)) {
    case 'openrouter':
    case 'gemini-image':
    case 'volcengine':
      return 'openai-compatible';
    default:
      return 'anthropic-messages';
  }
}

export function getDefaultCapabilitiesForProviderType(providerType?: string | null): ProviderCapability[] {
  switch (normalizeProviderType(providerType)) {
    case 'gemini-image':
    case 'volcengine':
      return ['image-gen'];
    default:
      return ['text-gen'];
  }
}

export function getDefaultProviderOrigin(isBuiltin?: boolean | number | null): ProviderOrigin {
  return isBuiltin ? 'system' : 'custom';
}

export function getDefaultAuthMode(_providerType?: string | null): ProviderAuthMode {
  return 'api_key';
}

export function normalizeProviderApiProtocol(
  apiProtocol?: string | null,
  providerType?: string | null,
): ProviderApiProtocol {
  if (apiProtocol && VALID_API_PROTOCOLS.has(apiProtocol as ProviderApiProtocol)) {
    return apiProtocol as ProviderApiProtocol;
  }
  return getDefaultApiProtocolForProviderType(providerType);
}

export function normalizeProviderOrigin(
  providerOrigin?: string | null,
  isBuiltin?: boolean | number | null,
): ProviderOrigin {
  if (isBuiltin) {
    return 'system';
  }
  if (providerOrigin && VALID_PROVIDER_ORIGINS.has(providerOrigin as ProviderOrigin)) {
    return providerOrigin as ProviderOrigin;
  }
  return getDefaultProviderOrigin(isBuiltin);
}

export function normalizeProviderAuthMode(
  authMode?: string | null,
  providerType?: string | null,
): ProviderAuthMode {
  const normalizedProviderType = normalizeProviderType(providerType);
  if (authMode && VALID_PROVIDER_AUTH_MODES.has(authMode as ProviderAuthMode)) {
    if (authMode === 'local_auth' && normalizedProviderType !== 'anthropic') {
      throw new Error('local_auth is only supported for anthropic providers');
    }
    return authMode as ProviderAuthMode;
  }
  return getDefaultAuthMode(normalizedProviderType);
}

export function parseProviderCapabilities(
  capabilities?: string | ProviderCapability[] | null,
  providerType?: string | null,
): ProviderCapability[] {
  if (Array.isArray(capabilities)) {
    const normalizedArray = capabilities.filter((item): item is ProviderCapability => (
      typeof item === 'string' && VALID_PROVIDER_CAPABILITIES.has(item as ProviderCapability)
    ));
    if (normalizedArray.length > 0) {
      return [...new Set(normalizedArray)];
    }
    return getDefaultCapabilitiesForProviderType(providerType);
  }

  if (typeof capabilities === 'string' && capabilities.trim()) {
    try {
      const parsed = JSON.parse(capabilities);
      if (Array.isArray(parsed)) {
        const normalizedArray = parsed.filter((item): item is ProviderCapability => (
          typeof item === 'string' && VALID_PROVIDER_CAPABILITIES.has(item as ProviderCapability)
        ));
        if (normalizedArray.length > 0) {
          return [...new Set(normalizedArray)];
        }
      }
    } catch {
      // Invalid JSON falls back to provider defaults.
    }
  }

  return getDefaultCapabilitiesForProviderType(providerType);
}

export function serializeProviderCapabilities(
  capabilities?: string | ProviderCapability[] | null,
  providerType?: string | null,
): string {
  return JSON.stringify(parseProviderCapabilities(capabilities, providerType));
}

export function providerSupportsCapability(
  provider: Pick<{ capabilities: string; provider_type: string }, 'capabilities' | 'provider_type'>,
  capability: ProviderCapability,
): boolean {
  const normalizedCapabilities = new Set(
    parseProviderCapabilities(provider.capabilities, provider.provider_type),
  );

  if (normalizedCapabilities.has(capability)) {
    return true;
  }

  if (capability === 'text-gen' && normalizedCapabilities.has('agent-chat')) {
    return true;
  }

  return false;
}

export function providerExplicitlySupportsCapability(
  provider: Pick<{ capabilities: string; provider_type: string }, 'capabilities' | 'provider_type'>,
  capability: ProviderCapability,
): boolean {
  const normalizedCapabilities = new Set(
    parseProviderCapabilities(provider.capabilities, provider.provider_type),
  );

  return normalizedCapabilities.has(capability);
}

export function resolveProviderPersistenceFields(input: {
  providerType?: string | null;
  apiProtocol?: string | null;
  capabilities?: string | ProviderCapability[] | null;
  providerOrigin?: string | null;
  authMode?: string | null;
  isBuiltin?: boolean | number | null;
}): {
  providerType: string;
  apiProtocol: ProviderApiProtocol;
  capabilities: string;
  providerOrigin: ProviderOrigin;
  authMode: ProviderAuthMode;
} {
  const providerType = normalizeProviderType(input.providerType);

  return {
    providerType,
    apiProtocol: normalizeProviderApiProtocol(input.apiProtocol, providerType),
    capabilities: serializeProviderCapabilities(input.capabilities, providerType),
    providerOrigin: normalizeProviderOrigin(input.providerOrigin, input.isBuiltin),
    authMode: normalizeProviderAuthMode(input.authMode, providerType),
  };
}
