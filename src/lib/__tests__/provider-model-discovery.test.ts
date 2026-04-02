import {
  buildProviderAuthHeaders,
  detectProviderModels,
  resolveAnthropicSdkBaseUrl,
} from '@/lib/provider-model-discovery';

describe('provider-model-discovery', () => {
  test('uses bearer auth for generic openai-compatible providers', () => {
    expect(buildProviderAuthHeaders({
      apiKey: 'sk-test',
      baseUrl: 'https://example.com/v1',
      providerType: 'custom',
      apiProtocol: 'openai-compatible',
    })).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer sk-test',
    });
  });

  test('rejects local_auth providers before any network probing', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(detectProviderModels({
      provider: {
        provider_type: 'anthropic',
        auth_mode: 'local_auth',
        base_url: '',
        api_key: '',
        extra_env: '{}',
      },
    })).rejects.toThrow('当前认证方式暂不支持自动探测模型，请在模型列表中手动填写可用模型');

    expect(fetchMock).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });

  test('normalizes anthropic-compatible base urls for the AI SDK', () => {
    expect(resolveAnthropicSdkBaseUrl({
      base_url: 'https://api.xiaomimimo.com/anthropic',
      extra_env: '{}',
    })).toBe('https://api.xiaomimimo.com/anthropic/v1');

    expect(resolveAnthropicSdkBaseUrl({
      base_url: 'https://api.xiaomimimo.com/anthropic/v1',
      extra_env: '{}',
    })).toBe('https://api.xiaomimimo.com/anthropic/v1');

    expect(resolveAnthropicSdkBaseUrl({
      base_url: 'https://api.xiaomimimo.com/anthropic/v1/messages',
      extra_env: '{}',
    })).toBe('https://api.xiaomimimo.com/anthropic/v1');
  });
});
