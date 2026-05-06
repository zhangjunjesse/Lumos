import {
  getPreferredChatProviderId,
  resolveChatProviderModelSelection,
  shouldPersistChatProviderBinding,
} from '../provider-selection';
import type { ProviderModelGroup } from '@/types';

function group(input: Partial<ProviderModelGroup> & Pick<ProviderModelGroup, 'provider_id' | 'provider_origin'>): ProviderModelGroup {
  return {
    provider_id: input.provider_id,
    provider_name: input.provider_name || input.provider_id,
    provider_type: input.provider_type || 'anthropic',
    provider_origin: input.provider_origin,
    models: input.models || [
      { value: `${input.provider_id}-default`, label: `${input.provider_id} default` },
    ],
    default_model: input.default_model,
    model_catalog_source: input.model_catalog_source || 'manual',
    model_catalog_updated_at: input.model_catalog_updated_at ?? null,
    model_catalog_uses_default: input.model_catalog_uses_default ?? false,
  };
}

describe('chat provider selection helpers', () => {
  test('explicit request provider wins over bound session provider', () => {
    expect(getPreferredChatProviderId({
      requestProviderId: 'provider-fox',
      sessionProviderId: 'provider-uc',
    })).toBe('provider-fox');
  });

  test('blank request provider falls back to bound session provider', () => {
    expect(getPreferredChatProviderId({
      requestProviderId: '   ',
      sessionProviderId: 'provider-uc',
    })).toBe('provider-uc');
  });

  test('explicit request should persist when it changes the binding', () => {
    expect(shouldPersistChatProviderBinding({
      requestProviderId: 'provider-fox',
      sessionProviderId: 'provider-uc',
      resolvedProviderId: 'provider-fox',
    })).toBe(true);
  });

  test('empty session should persist the first resolved provider', () => {
    expect(shouldPersistChatProviderBinding({
      requestProviderId: '',
      sessionProviderId: '',
      resolvedProviderId: 'provider-fox',
    })).toBe(true);
  });

  test('same bound provider does not need another write', () => {
    expect(shouldPersistChatProviderBinding({
      requestProviderId: 'provider-uc',
      sessionProviderId: 'provider-uc',
      resolvedProviderId: 'provider-uc',
    })).toBe(false);
  });

  test('stored user chat provider wins over backend default for a new session', () => {
    const result = resolveChatProviderModelSelection({
      groups: [
        group({ provider_id: 'system-default', provider_origin: 'system' }),
        group({ provider_id: 'system-picked', provider_origin: 'system' }),
      ],
      storedProviderId: 'system-picked',
      defaultProviderId: 'system-default',
    });

    expect(result.providerId).toBe('system-picked');
    expect(result.model).toBe('system-picked-default');
  });

  test('session provider wins over stored user default in an existing session', () => {
    const result = resolveChatProviderModelSelection({
      groups: [
        group({ provider_id: 'session-provider', provider_origin: 'system' }),
        group({ provider_id: 'stored-provider', provider_origin: 'system' }),
      ],
      sessionProviderId: 'session-provider',
      storedProviderId: 'stored-provider',
    });

    expect(result.providerId).toBe('session-provider');
  });

  test('missing or hidden stored provider falls back to backend default', () => {
    const result = resolveChatProviderModelSelection({
      groups: [
        group({ provider_id: 'system-default', provider_origin: 'system' }),
      ],
      storedProviderId: 'custom-hidden',
      defaultProviderId: 'system-default',
    });

    expect(result.providerId).toBe('system-default');
  });

  test('provider default model is used before first catalog model', () => {
    const result = resolveChatProviderModelSelection({
      groups: [
        group({
          provider_id: 'system-a',
          provider_origin: 'system',
          default_model: 'model-b',
          models: [
            { value: 'model-a', label: 'Model A' },
            { value: 'model-b', label: 'Model B' },
          ],
        }),
      ],
      defaultProviderId: 'system-a',
    });

    expect(result.model).toBe('model-b');
  });

  test('stored user default model wins when available in selected provider', () => {
    const result = resolveChatProviderModelSelection({
      groups: [
        group({
          provider_id: 'system-a',
          provider_origin: 'system',
          default_model: 'model-b',
          models: [
            { value: 'model-a', label: 'Model A' },
            { value: 'model-b', label: 'Model B' },
          ],
        }),
      ],
      defaultProviderId: 'system-a',
      storedModel: 'model-a',
    });

    expect(result.model).toBe('model-a');
  });
});
