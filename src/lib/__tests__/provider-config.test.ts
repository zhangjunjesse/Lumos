import {
  parseProviderCapabilities,
  providerExplicitlySupportsCapability,
  providerSupportsCapability,
  resolveProviderPersistenceFields,
} from '@/lib/provider-config';

describe('provider-config capability defaults', () => {
  test('defaults generic providers to text-gen instead of agent-chat', () => {
    expect(parseProviderCapabilities(undefined, 'anthropic')).toEqual(['text-gen']);
    expect(parseProviderCapabilities(undefined, 'custom')).toEqual(['text-gen']);
    expect(parseProviderCapabilities(undefined, 'openrouter')).toEqual(['text-gen']);
  });

  test('keeps gemini-image restricted to image-gen by default', () => {
    expect(parseProviderCapabilities(undefined, 'gemini-image')).toEqual(['image-gen']);
  });

  test('allows explicit agent-chat capability to persist for chat providers', () => {
    const fields = resolveProviderPersistenceFields({
      providerType: 'anthropic',
      capabilities: ['agent-chat'],
      providerOrigin: 'system',
      authMode: 'api_key',
    });

    expect(fields.capabilities).toBe('["agent-chat"]');
    expect(providerSupportsCapability({
      provider_type: fields.providerType,
      capabilities: fields.capabilities,
    }, 'agent-chat')).toBe(true);
  });

  test('does not treat agent-chat as explicit text-gen support', () => {
    expect(providerSupportsCapability({
      provider_type: 'anthropic',
      capabilities: '["agent-chat"]',
    }, 'text-gen')).toBe(true);

    expect(providerExplicitlySupportsCapability({
      provider_type: 'anthropic',
      capabilities: '["agent-chat"]',
    }, 'text-gen')).toBe(false);
  });
});
