import type {
  DeepSearchSiteRecord,
  DeepSearchSiteStateRecord,
} from '@/types';

export const DEEPSEARCH_PAGE_VALIDATION_BLOCKED = 'PAGE_VALIDATION_BLOCKED';

/** Site keys that work without any login or cookie configuration */
const LOGIN_FREE_SITES = new Set(['wechat']);

export function isDeepSearchSiteLoginFree(siteKey: string): boolean {
  return LOGIN_FREE_SITES.has(siteKey);
}

export function isDeepSearchSiteReady(site: Pick<DeepSearchSiteRecord, 'siteKey' | 'liveState'>): boolean {
  if (LOGIN_FREE_SITES.has(site.siteKey)) return true;
  return site.liveState?.loginState === 'connected';
}

export function requiresManualPageValidation(
  liveState: Pick<DeepSearchSiteStateRecord, 'lastError'> | null | undefined,
): boolean {
  return liveState?.lastError === DEEPSEARCH_PAGE_VALIDATION_BLOCKED;
}

export function getDeepSearchSiteVisibleLastError(
  liveState: Pick<DeepSearchSiteStateRecord, 'lastError'> | null | undefined,
): string {
  const lastError = liveState?.lastError?.trim() || '';
  if (lastError === DEEPSEARCH_PAGE_VALIDATION_BLOCKED) {
    return '';
  }
  return lastError;
}
