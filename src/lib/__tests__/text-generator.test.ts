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
});
