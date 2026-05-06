import type { ProviderModelGroup } from '@/types';

export const CHAT_DEFAULT_PROVIDER_STORAGE_KEY = 'lumos:chat-default-provider-id';
export const CHAT_DEFAULT_MODEL_STORAGE_KEY = 'lumos:chat-default-model';
export const LEGACY_CHAT_DEFAULT_MODEL_STORAGE_KEY = 'lumos:last-model';
export const LEGACY_CODEPILOT_MODEL_STORAGE_KEY = 'codepilot:last-model';

function normalizeProviderId(providerId?: string | null): string {
  return providerId?.trim() || '';
}

function normalizeModel(model?: string | null): string {
  return model?.trim() || '';
}

export function getPreferredChatProviderId(options: {
  requestProviderId?: string | null;
  sessionProviderId?: string | null;
}): string | undefined {
  const requestProviderId = normalizeProviderId(options.requestProviderId);
  if (requestProviderId) {
    return requestProviderId;
  }

  const sessionProviderId = normalizeProviderId(options.sessionProviderId);
  return sessionProviderId || undefined;
}

export function shouldPersistChatProviderBinding(options: {
  requestProviderId?: string | null;
  sessionProviderId?: string | null;
  resolvedProviderId?: string | null;
}): boolean {
  const requestProviderId = normalizeProviderId(options.requestProviderId);
  const sessionProviderId = normalizeProviderId(options.sessionProviderId);
  const resolvedProviderId = normalizeProviderId(options.resolvedProviderId);

  if (!resolvedProviderId) {
    return false;
  }

  if (requestProviderId) {
    return resolvedProviderId !== sessionProviderId;
  }

  return !sessionProviderId;
}

function findProviderGroup(groups: ProviderModelGroup[], providerId?: string | null): ProviderModelGroup | undefined {
  const normalized = normalizeProviderId(providerId);
  if (!normalized) return undefined;
  return groups.find((group) => group.provider_id === normalized);
}

function groupHasModel(group: ProviderModelGroup | undefined, model?: string | null): boolean {
  const normalized = normalizeModel(model);
  if (!group || !normalized) return false;
  return group.models.some((option) => option.value === normalized);
}

function pickModelForGroup(options: {
  group: ProviderModelGroup;
  currentModel?: string | null;
  storedModel?: string | null;
  backendDefaultModel?: string | null;
}): string {
  const candidates = [
    normalizeModel(options.currentModel),
    normalizeModel(options.storedModel),
    normalizeModel(options.group.default_model),
    normalizeModel(options.backendDefaultModel),
  ];

  for (const candidate of candidates) {
    if (groupHasModel(options.group, candidate)) {
      return candidate;
    }
  }

  return options.group.models[0]?.value || '';
}

export function filterVisibleChatProviderGroups(
  groups: ProviderModelGroup[],
  customProvidersLocked: boolean,
): ProviderModelGroup[] {
  return customProvidersLocked
    ? groups.filter((group) => group.provider_origin === 'system')
    : groups;
}

export function resolveChatProviderModelSelection(options: {
  groups: ProviderModelGroup[];
  sessionProviderId?: string | null;
  currentModel?: string | null;
  storedProviderId?: string | null;
  storedModel?: string | null;
  defaultProviderId?: string | null;
  backendDefaultModel?: string | null;
}): {
  providerId: string;
  model: string;
  provider: ProviderModelGroup | undefined;
  sessionProviderAvailable: boolean;
  storedProviderAvailable: boolean;
  defaultProviderAvailable: boolean;
} {
  const sessionGroup = findProviderGroup(options.groups, options.sessionProviderId);
  const storedGroup = findProviderGroup(options.groups, options.storedProviderId);
  const defaultGroup = findProviderGroup(options.groups, options.defaultProviderId);
  const provider = sessionGroup || storedGroup || defaultGroup || options.groups[0];

  if (!provider) {
    return {
      providerId: '',
      model: '',
      provider: undefined,
      sessionProviderAvailable: false,
      storedProviderAvailable: false,
      defaultProviderAvailable: false,
    };
  }

  return {
    providerId: provider.provider_id,
    model: pickModelForGroup({
      group: provider,
      currentModel: options.currentModel,
      storedModel: options.storedModel,
      backendDefaultModel: options.backendDefaultModel,
    }),
    provider,
    sessionProviderAvailable: Boolean(sessionGroup),
    storedProviderAvailable: Boolean(storedGroup),
    defaultProviderAvailable: Boolean(defaultGroup),
  };
}
