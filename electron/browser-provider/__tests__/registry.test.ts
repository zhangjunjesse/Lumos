import { DEFAULT_BROWSER_CONTEXT_ID } from '../types';
import { DEFAULT_EXTERNAL_CDP_CONTEXT_ID } from '../external-cdp-provider';
import { createBrowserProviderRegistry } from '../registry';

describe('BrowserProviderRegistry', () => {
  const originalExternalEndpoint = process.env.LUMOS_EXTERNAL_CDP_ENDPOINT;
  const originalBrowserExternalEndpoint = process.env.LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT;
  const originalAdsPowerUserId = process.env.LUMOS_ADSPOWER_USER_ID;
  const originalAdsPowerProfileId = process.env.LUMOS_ADSPOWER_PROFILE_ID;
  const originalAdsPowerProfileName = process.env.LUMOS_ADSPOWER_PROFILE_NAME;

  afterEach(() => {
    if (originalExternalEndpoint === undefined) {
      delete process.env.LUMOS_EXTERNAL_CDP_ENDPOINT;
    } else {
      process.env.LUMOS_EXTERNAL_CDP_ENDPOINT = originalExternalEndpoint;
    }
    if (originalBrowserExternalEndpoint === undefined) {
      delete process.env.LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT;
    } else {
      process.env.LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT = originalBrowserExternalEndpoint;
    }
    if (originalAdsPowerUserId === undefined) {
      delete process.env.LUMOS_ADSPOWER_USER_ID;
    } else {
      process.env.LUMOS_ADSPOWER_USER_ID = originalAdsPowerUserId;
    }
    if (originalAdsPowerProfileId === undefined) {
      delete process.env.LUMOS_ADSPOWER_PROFILE_ID;
    } else {
      process.env.LUMOS_ADSPOWER_PROFILE_ID = originalAdsPowerProfileId;
    }
    if (originalAdsPowerProfileName === undefined) {
      delete process.env.LUMOS_ADSPOWER_PROFILE_NAME;
    } else {
      process.env.LUMOS_ADSPOWER_PROFILE_NAME = originalAdsPowerProfileName;
    }
  });

  test('keeps the embedded context as the default context', () => {
    delete process.env.LUMOS_EXTERNAL_CDP_ENDPOINT;
    delete process.env.LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT;
    delete process.env.LUMOS_ADSPOWER_USER_ID;
    delete process.env.LUMOS_ADSPOWER_PROFILE_ID;
    delete process.env.LUMOS_ADSPOWER_PROFILE_NAME;

    const registry = createBrowserProviderRegistry(() => null);

    expect(registry.getDefaultContextId()).toBe(DEFAULT_BROWSER_CONTEXT_ID);
    expect(registry.isReady(DEFAULT_BROWSER_CONTEXT_ID)).toBe(false);
    expect(registry.getSession(DEFAULT_EXTERNAL_CDP_CONTEXT_ID)).toBeNull();
  });

  test('registers external CDP when the endpoint env var is present', () => {
    process.env.LUMOS_EXTERNAL_CDP_ENDPOINT = 'http://127.0.0.1:9222';
    delete process.env.LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT;
    delete process.env.LUMOS_ADSPOWER_USER_ID;
    delete process.env.LUMOS_ADSPOWER_PROFILE_ID;
    delete process.env.LUMOS_ADSPOWER_PROFILE_NAME;

    const registry = createBrowserProviderRegistry(() => null);

    expect(registry.isReady(DEFAULT_EXTERNAL_CDP_CONTEXT_ID)).toBe(true);
    expect(registry.getContext(DEFAULT_EXTERNAL_CDP_CONTEXT_ID)).toMatchObject({
      id: DEFAULT_EXTERNAL_CDP_CONTEXT_ID,
      providerId: 'external-cdp',
    });
  });

  test('registers AdsPower when a profile id env var is present', () => {
    delete process.env.LUMOS_EXTERNAL_CDP_ENDPOINT;
    delete process.env.LUMOS_BROWSER_EXTERNAL_CDP_ENDPOINT;
    process.env.LUMOS_ADSPOWER_USER_ID = 'profile-001';
    process.env.LUMOS_ADSPOWER_PROFILE_NAME = 'US Store 001';

    const registry = createBrowserProviderRegistry(() => null);

    expect(registry.isReady('adspower:profile-001')).toBe(true);
    expect(registry.getContext('adspower:profile-001')).toMatchObject({
      id: 'adspower:profile-001',
      providerId: 'adspower',
      displayName: 'US Store 001',
    });
  });
});
