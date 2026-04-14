import {
  BUILTIN_CLAUDE_MODEL_IDS,
  findProviderModelOption,
  resolveProviderModelForRequest,
} from '@/lib/model-metadata';

describe('model-metadata', () => {
  test('matches provider models by normalized prefix when provider stores versioned ids', () => {
    const option = findProviderModelOption('doubao-seed-2.0-lite', [
      { value: 'doubao-seed-2-0-lite-260215', label: 'doubao-seed-2-0-lite-260215' },
      { value: 'doubao-seed-2-0-pro-260215', label: 'doubao-seed-2-0-pro-260215' },
    ]);

    expect(option).toEqual({
      value: 'doubao-seed-2-0-lite-260215',
      label: 'doubao-seed-2-0-lite-260215',
    });
  });

  test('maps claude-style requests onto anthropic-compatible gateways with custom model catalogs', () => {
    expect(resolveProviderModelForRequest({
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      base_url: 'http://api.miki.zj.cn',
      capabilities: '["agent-chat"]',
      model_catalog: JSON.stringify([
        { value: 'doubao-seed-2-0-lite-260215', label: 'doubao-seed-2-0-lite-260215' },
      ]),
      model_catalog_source: 'manual',
      model_catalog_updated_at: null,
    }, BUILTIN_CLAUDE_MODEL_IDS.sonnet)).toBe('doubao-seed-2-0-lite-260215');
  });

  test('keeps built-in claude ids for anthropic providers without custom non-claude models', () => {
    expect(resolveProviderModelForRequest({
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      base_url: 'https://api.anthropic.com',
      capabilities: '["agent-chat"]',
      model_catalog: '[]',
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
    }, 'sonnet')).toBe(BUILTIN_CLAUDE_MODEL_IDS.sonnet);
  });
});
