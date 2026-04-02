const getSettingMock = jest.fn();
const resolveProviderForCapabilityMock = jest.fn();
const generateTextFromProviderMock = jest.fn();

jest.mock('@/lib/db', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

jest.mock('@/lib/provider-resolver', () => ({
  resolveProviderForCapability: (...args: unknown[]) => resolveProviderForCapabilityMock(...args),
}));

jest.mock('@/lib/text-generator', () => ({
  generateTextFromProvider: (...args: unknown[]) => generateTextFromProviderMock(...args),
}));

import { BUILTIN_CLAUDE_MODEL_IDS } from '@/lib/model-metadata';
import { callKnowledgeModel } from '@/lib/knowledge/llm';

describe('knowledge llm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSettingMock.mockReturnValue('');
    generateTextFromProviderMock.mockResolvedValue('ok');
  });

  test('maps claude-style fallback requests onto the selected knowledge provider model catalog', async () => {
    resolveProviderForCapabilityMock.mockReturnValue({
      id: 'provider-knowledge',
      name: 'Knowledge Text',
      provider_type: 'custom',
      api_protocol: 'openai-compatible',
      capabilities: '["text-gen"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
      base_url: 'https://example.com/v1',
      api_key: 'sk-test',
      is_active: 0,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: JSON.stringify([
        { value: 'gpt-4.1-mini', label: 'GPT 4.1 Mini' },
      ]),
      model_catalog_source: 'manual',
      model_catalog_updated_at: '2026-03-25 00:00:00',
      notes: '',
      is_builtin: 0,
      user_modified: 0,
      created_at: '2026-03-25 00:00:00',
      updated_at: '2026-03-25 00:00:00',
    });

    await expect(callKnowledgeModel({
      model: BUILTIN_CLAUDE_MODEL_IDS.haiku,
      maxTokens: 256,
      prompt: 'hello',
    })).resolves.toBe('ok');

    expect(generateTextFromProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-knowledge',
      model: 'gpt-4.1-mini',
    }));
  });

  test('rejects openai-compatible knowledge providers that have no model catalog or known defaults', async () => {
    resolveProviderForCapabilityMock.mockReturnValue({
      id: 'provider-empty',
      name: 'Broken Knowledge Provider',
      provider_type: 'custom',
      api_protocol: 'openai-compatible',
      capabilities: '["text-gen"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
      base_url: 'https://example.com/v1',
      api_key: 'sk-test',
      is_active: 0,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: '[]',
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 0,
      user_modified: 0,
      created_at: '2026-03-25 00:00:00',
      updated_at: '2026-03-25 00:00:00',
    });

    await expect(callKnowledgeModel({
      model: BUILTIN_CLAUDE_MODEL_IDS.haiku,
      maxTokens: 256,
      prompt: 'hello',
    })).rejects.toThrow('未配置可用模型');

    expect(generateTextFromProviderMock).not.toHaveBeenCalled();
  });

  test('prefers configured anthropic-compatible gateway models over built-in Claude ids', async () => {
    resolveProviderForCapabilityMock.mockReturnValue({
      id: 'provider-xiaomi',
      name: 'Xiaomi Gateway',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["text-gen"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
      base_url: 'https://api.xiaomimimo.com/anthropic',
      api_key: 'sk-test',
      is_active: 0,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: JSON.stringify([
        { value: 'mimo-v2-pro', label: 'Mimo V2 Pro' },
      ]),
      model_catalog_source: 'manual',
      model_catalog_updated_at: '2026-03-25 00:00:00',
      notes: '',
      is_builtin: 0,
      user_modified: 0,
      created_at: '2026-03-25 00:00:00',
      updated_at: '2026-03-25 00:00:00',
    });

    await expect(callKnowledgeModel({
      model: BUILTIN_CLAUDE_MODEL_IDS.haiku,
      maxTokens: 256,
      prompt: 'hello',
    })).resolves.toBe('ok');

    expect(generateTextFromProviderMock).toHaveBeenCalledTimes(1);
    expect(generateTextFromProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-xiaomi',
      model: 'mimo-v2-pro',
    }));
  });

  test('allows agent-chat-only providers to be reused for knowledge enhancement', async () => {
    resolveProviderForCapabilityMock.mockReturnValue({
      id: 'provider-chat-only',
      name: 'Chat Only Provider',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
      base_url: 'https://example.com/anthropic',
      api_key: 'sk-test',
      is_active: 0,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: JSON.stringify([
        { value: 'chat-model', label: 'Chat Model' },
      ]),
      model_catalog_source: 'manual',
      model_catalog_updated_at: '2026-03-25 00:00:00',
      notes: '',
      is_builtin: 0,
      user_modified: 0,
      created_at: '2026-03-25 00:00:00',
      updated_at: '2026-03-25 00:00:00',
    });

    await expect(callKnowledgeModel({
      model: BUILTIN_CLAUDE_MODEL_IDS.haiku,
      maxTokens: 256,
      prompt: 'hello',
    })).resolves.toBe('ok');

    expect(generateTextFromProviderMock).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-chat-only',
      model: 'chat-model',
    }));
  });
});
