import type { DeepSearchSiteRecord } from '@/types';

jest.mock('../service', () => ({
  createDeepSearchRunEntry: jest.fn(),
  getDeepSearchRunView: jest.fn(),
  listDeepSearchSitesView: jest.fn(),
  updateDeepSearchRunEntry: jest.fn(),
}));

jest.mock('../adapter-registry', () => ({
  getAdapter: jest.fn(),
}));

jest.mock('../adapter-context', () => ({
  createAdapterContext: jest.fn(),
}));

jest.mock('@/lib/browser-runtime/bridge-client', () => ({
  resolveBrowserBridgeRuntimeConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  getSetting: jest.fn(),
  getSession: jest.fn(),
}));

jest.mock('@/lib/knowledge/deepsearch-importer', () => ({
  archiveDeepSearchRun: jest.fn(),
}));

import { resolveRequestedSiteKeys } from '../tool-facade';

function createSite(siteKey: string, displayName: string, baseUrl: string): DeepSearchSiteRecord {
  return {
    id: `site-${siteKey}`,
    siteKey,
    displayName,
    baseUrl,
    cookieStatus: 'missing',
    hasCookie: false,
    cookiePreview: '',
    cookieExpiresAt: null,
    lastValidatedAt: null,
    validationMessage: '',
    notes: '',
    minFetchCount: 3,
    createdAt: '2026-05-08 00:00:00',
    updatedAt: '2026-05-08 00:00:00',
    liveState: {
      siteKey,
      displayName,
      loginState: 'connected',
      lastCheckedAt: '2026-05-08 00:00:00',
      lastLoginAt: '2026-05-08 00:00:00',
      blockingReason: '',
      lastError: '',
      createdAt: '2026-05-08 00:00:00',
      updatedAt: '2026-05-08 00:00:00',
    },
  };
}

describe('deepsearch tool site resolution', () => {
  const sites = [
    createSite('ctext', 'Chinese Text Project', 'https://ctext.org'),
    createSite('x', 'X / Twitter', 'https://x.com'),
  ];

  test('resolves explicit x site key to X instead of Chinese Text Project', () => {
    const resolved = resolveRequestedSiteKeys(['x'], '出海', sites);

    expect(resolved.siteKeys).toEqual(['x']);
  });

  test('infers X when a Chinese request mentions X next to Chinese characters', () => {
    const resolved = resolveRequestedSiteKeys(
      undefined,
      '用 deepsearch 搜 关键词为 出海 的X的内容',
      sites,
    );

    expect(resolved.siteKeys).toEqual(['x']);
  });
});
