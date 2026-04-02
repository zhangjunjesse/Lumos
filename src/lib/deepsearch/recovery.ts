import type {
  DeepSearchRunRecord,
  DeepSearchSiteRecord,
} from '@/types';

export interface DeepSearchRunSiteProbeSummary {
  eligibleSiteKeys: string[];
  blockedSiteKeys: string[];
  blockedReasons: string[];
}

export interface DeepSearchWaitingLoginRecoveryCopy {
  statusMessage: string;
  resultSummary: string;
  executionMarkdown: string;
}

function getBlockedReason(siteKey: string, sitesByKey: Map<string, DeepSearchSiteRecord>): string {
  const site = sitesByKey.get(siteKey);
  const displayName = site?.displayName ?? siteKey;
  const liveState = site?.liveState;

  if (!liveState) {
    return `${displayName}: No shared-login probe has been run for this site yet.`;
  }

  const blockingReason = liveState.blockingReason.trim();
  if (blockingReason) {
    return `${displayName}: ${blockingReason}`;
  }

  if (liveState.lastError.trim()) {
    return `${displayName}: ${liveState.lastError.trim()}`;
  }

  return `${displayName}: ${liveState.loginState}`;
}

export function deriveDeepSearchRunSiteProbeSummary(
  run: Pick<DeepSearchRunRecord, 'siteKeys'>,
  sites: DeepSearchSiteRecord[],
): DeepSearchRunSiteProbeSummary {
  const sitesByKey = new Map(sites.map((site) => [site.siteKey, site]));
  const eligibleSiteKeys: string[] = [];
  const blockedSiteKeys: string[] = [];
  const blockedReasons: string[] = [];

  for (const siteKey of run.siteKeys) {
    const liveState = sitesByKey.get(siteKey)?.liveState;
    if (liveState?.loginState === 'connected') {
      eligibleSiteKeys.push(siteKey);
      continue;
    }

    blockedSiteKeys.push(siteKey);
    blockedReasons.push(getBlockedReason(siteKey, sitesByKey));
  }

  return {
    eligibleSiteKeys,
    blockedSiteKeys,
    blockedReasons,
  };
}

export function canResumeDeepSearchRunAfterProbe(
  run: Pick<DeepSearchRunRecord, 'strictness'>,
  probe: Pick<DeepSearchRunSiteProbeSummary, 'eligibleSiteKeys' | 'blockedSiteKeys'>,
): boolean {
  if (probe.eligibleSiteKeys.length === 0) {
    return false;
  }

  if (run.strictness === 'strict' && probe.blockedSiteKeys.length > 0) {
    return false;
  }

  return true;
}

export function buildDeepSearchWaitingLoginRecoveryCopy(
  run: Pick<DeepSearchRunRecord, 'strictness'>,
  probe: DeepSearchRunSiteProbeSummary,
): DeepSearchWaitingLoginRecoveryCopy {
  if (probe.eligibleSiteKeys.length === 0) {
    return {
      statusMessage: 'No selected site currently has a confirmed shared login state in the built-in browser.',
      resultSummary: 'Waiting for site login before runtime execution can continue.',
      executionMarkdown: [
        '## Login Probe',
        '',
        '- No selected site passed the shared-login probe.',
        ...probe.blockedReasons.map((reason) => `- ${reason}`),
      ].join('\n'),
    };
  }

  if (run.strictness === 'strict' && probe.blockedSiteKeys.length > 0) {
    return {
      statusMessage: 'Strict mode is blocked because at least one selected site still lacks a confirmed shared login state.',
      resultSummary: 'Waiting for all selected sites to pass the login probe.',
      executionMarkdown: [
        '## Login Probe',
        '',
        '- Strict mode blocked execution because some sites failed the shared-login probe.',
        ...probe.blockedReasons.map((reason) => `- ${reason}`),
      ].join('\n'),
    };
  }

  return {
    statusMessage: 'Shared login state has recovered enough for runtime dispatch.',
    resultSummary: 'Ready to resume browser runtime execution.',
    executionMarkdown: [
      '## Login Probe',
      '',
      `- Shared login-ready sites: ${probe.eligibleSiteKeys.length}`,
      ...(probe.blockedReasons.length > 0 ? ['', ...probe.blockedReasons.map((reason) => `- ${reason}`)] : []),
    ].join('\n'),
  };
}
