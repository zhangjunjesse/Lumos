import { AdsPowerProvider, DEFAULT_ADSPOWER_API_BASE_URL } from '../adspower-provider';

describe('AdsPowerProvider', () => {
  test('does not expose a context without a configured profile id', () => {
    const provider = new AdsPowerProvider();

    expect(provider.isReady()).toBe(false);
    expect(provider.getContext('adspower:any')).toBeNull();
    expect(provider.getSession('adspower:any')).toBeNull();
  });

  test('exposes the configured profile as a browser context', () => {
    const provider = new AdsPowerProvider({
      apiBaseUrl: DEFAULT_ADSPOWER_API_BASE_URL,
      profileId: 'profile-001',
      profileName: 'US Store 001',
    });

    expect(provider.getDefaultContextId()).toBe('adspower:profile-001');
    expect(provider.isReady('adspower:profile-001')).toBe(true);
    expect(provider.getContext('adspower:profile-001')).toMatchObject({
      id: 'adspower:profile-001',
      providerId: 'adspower',
      profileId: 'profile-001',
      displayName: 'US Store 001',
      providerType: 'adspower',
    });
    expect(provider.getSession('adspower:profile-001')?.contextId).toBe('adspower:profile-001');
  });
});
