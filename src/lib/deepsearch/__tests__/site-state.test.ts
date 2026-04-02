import type {
  DeepSearchSiteRecord,
  DeepSearchSiteStateRecord,
} from '@/types';
import {
  DEEPSEARCH_PAGE_VALIDATION_BLOCKED,
  getDeepSearchSiteVisibleLastError,
  isDeepSearchSiteReady,
  requiresManualPageValidation,
} from '../site-state';

function createLiveState(overrides?: Partial<DeepSearchSiteStateRecord>): DeepSearchSiteStateRecord {
  return {
    siteKey: 'zhihu',
    displayName: 'Zhihu',
    loginState: 'missing',
    lastCheckedAt: '2026-03-28 10:00:00',
    lastLoginAt: null,
    blockingReason: '',
    lastError: '',
    createdAt: '2026-03-28 10:00:00',
    updatedAt: '2026-03-28 10:00:00',
    ...overrides,
  };
}

function createSite(overrides?: Partial<DeepSearchSiteRecord>): DeepSearchSiteRecord {
  return {
    id: 'site-1',
    siteKey: 'zhihu',
    displayName: 'Zhihu',
    baseUrl: 'https://www.zhihu.com/',
    cookieStatus: 'missing',
    hasCookie: false,
    cookiePreview: '',
    cookieExpiresAt: null,
    lastValidatedAt: null,
    validationMessage: '',
    notes: '',
    createdAt: '2026-03-28 10:00:00',
    updatedAt: '2026-03-28 10:00:00',
    liveState: null,
    ...overrides,
  };
}

describe('deepsearch site-state helpers', () => {
  it('treats only confirmed live login as ready', () => {
    expect(isDeepSearchSiteReady(createSite())).toBe(false);
    expect(isDeepSearchSiteReady(createSite({
      cookieStatus: 'valid',
      hasCookie: true,
      liveState: createLiveState({ loginState: 'missing' }),
    }))).toBe(false);
    expect(isDeepSearchSiteReady(createSite({
      liveState: createLiveState({ loginState: 'connected' }),
    }))).toBe(true);
  });

  it('keeps page validation sentinel internal', () => {
    const liveState = createLiveState({
      loginState: 'suspected_expired',
      lastError: DEEPSEARCH_PAGE_VALIDATION_BLOCKED,
    });

    expect(requiresManualPageValidation(liveState)).toBe(true);
    expect(getDeepSearchSiteVisibleLastError(liveState)).toBe('');
  });

  it('still exposes ordinary runtime errors', () => {
    const liveState = createLiveState({
      loginState: 'error',
      lastError: 'BROWSER_BRIDGE_HTTP_500',
    });

    expect(requiresManualPageValidation(liveState)).toBe(false);
    expect(getDeepSearchSiteVisibleLastError(liveState)).toBe('BROWSER_BRIDGE_HTTP_500');
  });
});
