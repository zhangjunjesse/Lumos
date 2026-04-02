import { listProviderPresets } from '@/lib/provider-presets';

describe('provider-presets', () => {
  test('knowledge module only exposes explicit text presets', () => {
    const presetIds = listProviderPresets({
      capability: 'text-gen',
      moduleKey: 'knowledge',
    }).map((preset) => preset.id);

    expect(presetIds).toEqual(expect.arrayContaining([
      'claude-text-api-key',
      'anthropic-compatible-text',
      'openrouter-text',
      'openai-compatible-text',
    ]));
    expect(presetIds).not.toContain('claude-api-key');
    expect(presetIds).not.toContain('claude-local-auth');
    expect(presetIds).not.toContain('anthropic-compatible-agent');
  });
});
