const mockGetAllProviders = jest.fn();
const mockGetDefaultProvider = jest.fn();
const mockGetProvider = jest.fn();
const mockGetProviderModelOptions = jest.fn();
const mockResolveProviderModelForRequest = jest.fn();

jest.mock('@/lib/db/providers', () => ({
  getAllProviders: () => mockGetAllProviders(),
  getDefaultProvider: () => mockGetDefaultProvider(),
  getProvider: (id: string) => mockGetProvider(id),
}));

jest.mock('@/lib/model-metadata', () => ({
  getProviderModelOptions: (...args: unknown[]) => mockGetProviderModelOptions(...args),
  resolveProviderModelForRequest: (...args: unknown[]) => mockResolveProviderModelForRequest(...args),
}));

import {
  listTextGenProviderOptions,
  resolveWeChatTextGenerationTarget,
} from '../provider-options';

function provider(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'provider-1',
    name: overrides.name ?? 'Provider 1',
    provider_type: overrides.provider_type ?? 'anthropic',
    provider_origin: overrides.provider_origin ?? 'custom',
    auth_mode: overrides.auth_mode ?? 'api_key',
    capabilities: overrides.capabilities ?? '["text-gen"]',
    model_catalog: overrides.model_catalog ?? '[]',
    model_catalog_source: overrides.model_catalog_source ?? 'manual',
    model_catalog_updated_at: overrides.model_catalog_updated_at ?? null,
    api_protocol: overrides.api_protocol ?? 'anthropic-messages',
    base_url: overrides.base_url ?? '',
  };
}

function settings(providerId: string | null = null, model: string | null = null) {
  return {
    ai: {
      providerId,
      model,
      windowDays: 14,
      sensitivity: 'balanced',
      prompts: {
        followupExtractor: 'FOLLOWUP',
        dailyReporter: 'DAILY',
        topicExtractor: 'TOPIC',
      },
    },
  } as never;
}

describe('wechat assistant provider options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProviderModelOptions.mockReturnValue([{ value: 'model-1', label: 'Model 1' }]);
    mockResolveProviderModelForRequest.mockReturnValue('model-1');
  });

  it('hides local auth providers from the WeChat AI provider list', () => {
    mockGetDefaultProvider.mockReturnValue(provider({ id: 'api-key', name: 'API Key' }));
    mockGetAllProviders.mockReturnValue([
      provider({ id: 'api-key', name: 'API Key' }),
      provider({ id: 'local', name: '本地', auth_mode: 'local_auth' }),
      provider({ id: 'image', name: '图片', capabilities: '["image-gen"]' }),
    ]);

    expect(listTextGenProviderOptions()).toEqual([
      expect.objectContaining({ id: 'api-key', name: 'API Key', isDefault: true }),
    ]);
  });

  it('rejects a local auth default provider before resolving a model', () => {
    mockGetDefaultProvider.mockReturnValue(provider({ id: 'local', name: '本地', auth_mode: 'local_auth' }));

    const target = resolveWeChatTextGenerationTarget(settings());

    expect(target).toEqual(expect.objectContaining({
      ok: false,
      code: 'no_provider',
      message: expect.stringContaining('本地登录授权'),
    }));
    expect(mockResolveProviderModelForRequest).not.toHaveBeenCalled();
  });

  it('resolves an API Key text provider and model', () => {
    const apiProvider = provider({ id: 'api-key', name: 'API Key' });
    mockGetProvider.mockReturnValue(apiProvider);

    const target = resolveWeChatTextGenerationTarget(settings('api-key', 'model-1'));

    expect(target).toEqual({
      ok: true,
      provider: apiProvider,
      providerId: 'api-key',
      model: 'model-1',
    });
    expect(mockResolveProviderModelForRequest).toHaveBeenCalledWith(apiProvider, 'model-1', 'sonnet');
  });
});
