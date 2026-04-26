import {
  getPreferredChatProviderId,
  shouldPersistChatProviderBinding,
} from '../provider-selection';

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
});
