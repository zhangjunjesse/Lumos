import {
  DEFAULT_EXTERNAL_CDP_CONTEXT_ID,
  ExternalCdpProvider,
  normalizeExternalCdpEndpoint,
} from '../external-cdp-provider';

describe('normalizeExternalCdpEndpoint', () => {
  test('accepts a DevTools HTTP base URL', () => {
    expect(normalizeExternalCdpEndpoint(' http://127.0.0.1:9222/ ')).toEqual({
      httpBaseUrl: 'http://127.0.0.1:9222',
    });
  });

  test('normalizes json helper URLs back to the DevTools HTTP base URL', () => {
    expect(normalizeExternalCdpEndpoint('http://127.0.0.1:9222/json/version')).toEqual({
      httpBaseUrl: 'http://127.0.0.1:9222',
    });
  });

  test('derives the HTTP base URL from a browser websocket endpoint', () => {
    expect(normalizeExternalCdpEndpoint('ws://127.0.0.1:9222/devtools/browser/abc')).toEqual({
      httpBaseUrl: 'http://127.0.0.1:9222',
      browserWebSocketUrl: 'ws://127.0.0.1:9222/devtools/browser/abc',
    });
  });

  test('keeps a reverse proxy base path when it is not a json helper URL', () => {
    expect(normalizeExternalCdpEndpoint('https://cdp.example.com/profiles/a/')).toEqual({
      httpBaseUrl: 'https://cdp.example.com/profiles/a',
    });
  });
});

describe('ExternalCdpProvider', () => {
  test('does not expose a context without an endpoint', () => {
    const provider = new ExternalCdpProvider();

    expect(provider.isReady(DEFAULT_EXTERNAL_CDP_CONTEXT_ID)).toBe(false);
    expect(provider.getContext(DEFAULT_EXTERNAL_CDP_CONTEXT_ID)).toBeNull();
    expect(provider.getSession(DEFAULT_EXTERNAL_CDP_CONTEXT_ID)).toBeNull();
  });

  test('exposes the default external CDP context when configured', () => {
    const provider = new ExternalCdpProvider('http://127.0.0.1:9222');
    const context = provider.getContext(DEFAULT_EXTERNAL_CDP_CONTEXT_ID);

    expect(provider.isReady(DEFAULT_EXTERNAL_CDP_CONTEXT_ID)).toBe(true);
    expect(context).toMatchObject({
      id: DEFAULT_EXTERNAL_CDP_CONTEXT_ID,
      providerId: 'external-cdp',
      profileId: 'default',
      providerType: 'external-cdp',
    });
    expect(provider.getSession(DEFAULT_EXTERNAL_CDP_CONTEXT_ID)?.contextId).toBe(DEFAULT_EXTERNAL_CDP_CONTEXT_ID);
  });
});
