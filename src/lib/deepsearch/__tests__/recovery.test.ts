import {
  buildDeepSearchWaitingLoginRecoveryCopy,
  canResumeDeepSearchRunAfterProbe,
  deriveDeepSearchRunSiteProbeSummary,
} from '../recovery';
import type { DeepSearchRunRecord, DeepSearchSiteRecord } from '@/types';

function createSite(
  siteKey: string,
  displayName: string,
  loginState: DeepSearchSiteRecord['liveState'] extends infer T
    ? T extends { loginState: infer U }
      ? U
      : never
    : never,
  blockingReason = '',
): DeepSearchSiteRecord {
  return {
    id: `site-${siteKey}`,
    siteKey,
    displayName,
    baseUrl: `https://${siteKey}.example.com`,
    cookieStatus: 'valid',
    hasCookie: true,
    cookiePreview: 'cookie',
    cookieExpiresAt: null,
    lastValidatedAt: null,
    validationMessage: '',
    notes: '',
    createdAt: '2026-03-28 00:00:00',
    updatedAt: '2026-03-28 00:00:00',
    liveState: {
      siteKey,
      displayName,
      loginState,
      lastCheckedAt: '2026-03-28 00:00:00',
      lastLoginAt: loginState === 'connected' ? '2026-03-28 00:00:00' : null,
      blockingReason,
      lastError: '',
      createdAt: '2026-03-28 00:00:00',
      updatedAt: '2026-03-28 00:00:00',
    },
  };
}

function createRun(strictness: DeepSearchRunRecord['strictness'], siteKeys: string[]): Pick<DeepSearchRunRecord, 'strictness' | 'siteKeys'> {
  return {
    strictness,
    siteKeys,
  };
}

describe('deepsearch recovery helpers', () => {
  it('marks only connected sites as eligible', () => {
    const probe = deriveDeepSearchRunSiteProbeSummary(
      createRun('best_effort', ['zhihu', 'juejin']),
      [
        createSite('zhihu', 'Zhihu', 'connected'),
        createSite('juejin', 'Juejin', 'missing', 'No shared login cookie was detected for this site.'),
      ],
    );

    expect(probe.eligibleSiteKeys).toEqual(['zhihu']);
    expect(probe.blockedSiteKeys).toEqual(['juejin']);
    expect(probe.blockedReasons).toEqual([
      'Juejin: No shared login cookie was detected for this site.',
    ]);
  });

  it('allows best-effort runs to resume when at least one site is ready', () => {
    const probe = deriveDeepSearchRunSiteProbeSummary(
      createRun('best_effort', ['zhihu', 'juejin']),
      [
        createSite('zhihu', 'Zhihu', 'connected'),
        createSite('juejin', 'Juejin', 'expired', 'Only expired shared login cookies were detected for this site.'),
      ],
    );

    expect(canResumeDeepSearchRunAfterProbe(createRun('best_effort', ['zhihu', 'juejin']), probe)).toBe(true);
  });

  it('keeps strict runs blocked until every site is ready', () => {
    const probe = deriveDeepSearchRunSiteProbeSummary(
      createRun('strict', ['zhihu', 'juejin']),
      [
        createSite('zhihu', 'Zhihu', 'connected'),
        createSite('juejin', 'Juejin', 'expired', 'Only expired shared login cookies were detected for this site.'),
      ],
    );

    expect(canResumeDeepSearchRunAfterProbe(createRun('strict', ['zhihu', 'juejin']), probe)).toBe(false);

    const copy = buildDeepSearchWaitingLoginRecoveryCopy(createRun('strict', ['zhihu', 'juejin']), probe);
    expect(copy.statusMessage).toContain('Strict mode is blocked');
    expect(copy.executionMarkdown).toContain('Juejin');
  });

  it('reports missing login when no site is ready', () => {
    const probe = deriveDeepSearchRunSiteProbeSummary(
      createRun('best_effort', ['zhihu']),
      [
        createSite('zhihu', 'Zhihu', 'missing', 'No shared login cookie was detected for this site.'),
      ],
    );

    expect(canResumeDeepSearchRunAfterProbe(createRun('best_effort', ['zhihu']), probe)).toBe(false);

    const copy = buildDeepSearchWaitingLoginRecoveryCopy(createRun('best_effort', ['zhihu']), probe);
    expect(copy.statusMessage).toContain('No selected site currently has a confirmed shared login state');
    expect(copy.executionMarkdown).toContain('No selected site passed the shared-login probe');
  });
});
