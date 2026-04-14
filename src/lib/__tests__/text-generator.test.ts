const streamTextMock = jest.fn();
const generateTextMock = jest.fn();
const createAnthropicMock = jest.fn();
const createOpenAIMock = jest.fn();
const getProviderMock = jest.fn();

jest.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
  generateText: (...args: unknown[]) => generateTextMock(...args),
  generateObject: jest.fn(),
}));

jest.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: (...args: unknown[]) => createAnthropicMock(...args),
}));

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: unknown[]) => createOpenAIMock(...args),
}));

jest.mock('@/lib/db', () => ({
  getProvider: (...args: unknown[]) => getProviderMock(...args),
}));

import { generateTextFromProvider } from '@/lib/text-generator';

describe('text-generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    streamTextMock.mockReturnValue({
      textStream: (async function* textStream() {
        yield 'ok';
      })(),
    });
    generateTextMock.mockResolvedValue({ text: 'ok' });
    createAnthropicMock.mockReturnValue((modelId: string) => ({ provider: 'anthropic', modelId }));
    createOpenAIMock.mockReturnValue((modelId: string) => ({ provider: 'openai', modelId }));
  });

  test('falls back to legacy anthropic creds in extra_env for text generation', async () => {
    getProviderMock.mockReturnValue({
      id: 'provider-1',
      name: 'Legacy Anthropic',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["text-gen"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
      base_url: '',
      api_key: '',
      is_active: 0,
      sort_order: 0,
      extra_env: JSON.stringify({
        ANTHROPIC_API_KEY: 'sk-extra',
        ANTHROPIC_BASE_URL: 'https://proxy.example.com/anthropic',
      }),
      model_catalog: '[]',
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 0,
      user_modified: 0,
      created_at: '2026-03-25 00:00:00',
      updated_at: '2026-03-25 00:00:00',
    });

    await expect(generateTextFromProvider({
      providerId: 'provider-1',
      model: 'claude-haiku-4-5',
      system: '',
      prompt: 'hello',
    })).resolves.toBe('ok');

    expect(createAnthropicMock).toHaveBeenCalledWith({
      apiKey: 'sk-extra',
      baseURL: 'https://proxy.example.com/anthropic/v1',
    });
  });

  test('maps requested model onto provider catalog before creating the language model', async () => {
    getProviderMock.mockReturnValue({
      id: 'provider-lumos-cloud',
      name: 'Lumos Cloud',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["text-gen"]',
      provider_origin: 'system',
      auth_mode: 'api_key',
      base_url: 'http://api.miki.zj.cn',
      api_key: 'sk-test',
      is_active: 1,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: JSON.stringify([
        { value: 'doubao-seed-2-0-lite-260215', label: 'doubao-seed-2-0-lite-260215' },
      ]),
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 1,
      user_modified: 0,
      created_at: '2026-04-10 00:00:00',
      updated_at: '2026-04-10 00:00:00',
    });

    await expect(generateTextFromProvider({
      providerId: 'provider-lumos-cloud',
      model: 'doubao-seed-2.0-lite',
      system: '',
      prompt: 'hello',
    })).resolves.toBe('ok');

    expect(createAnthropicMock).toHaveBeenCalledTimes(1);
    expect(createAnthropicMock.mock.results[0].value).toBeInstanceOf(Function);
    const anthropicFactory = createAnthropicMock.mock.results[0].value as (modelId: string) => unknown;
    expect(anthropicFactory('doubao-seed-2-0-lite-260215')).toEqual({
      provider: 'anthropic',
      modelId: 'doubao-seed-2-0-lite-260215',
    });
    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      model: {
        provider: 'anthropic',
        modelId: 'doubao-seed-2-0-lite-260215',
      },
    }));
  });
});
