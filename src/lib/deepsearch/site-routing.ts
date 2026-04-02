import type { DeepSearchRunPageBinding } from '@/types';
import type { DeepSearchPageExtractionResult } from './adapter-types';

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isZhihuDetailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname || '/';

    if (!(hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com'))) {
      return false;
    }

    return (
      /^\/question\/[^/]+/i.test(pathname)
      || /^\/p\/[^/]+/i.test(pathname)
      || /^\/zvideo\/[^/]+/i.test(pathname)
    );
  } catch {
    return false;
  }
}

export function resolveSiteSeedUrl(siteKey: string, baseUrl: string, queryText: string): string {
  const query = queryText.trim();
  if (!query) {
    return baseUrl.trim() || 'about:blank';
  }

  switch (siteKey) {
    case 'zhihu':
      return `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(query)}`;
    default:
      return baseUrl.trim() || 'about:blank';
  }
}

export function resolveSiteSeedBindingRole(
  siteKey: string,
  queryText: string,
): 'seed' | 'search' {
  const hasQuery = queryText.trim().length > 0;

  switch (siteKey) {
    case 'zhihu':
      return hasQuery ? 'search' : 'seed';
    default:
      return 'seed';
  }
}

export function collectDeepSearchFollowUpUrls(params: {
  siteKey: string | null;
  bindingRole: DeepSearchRunPageBinding['role'];
  extraction: DeepSearchPageExtractionResult;
  seenUrls: Set<string>;
  maxFollowUps?: number;
}): string[] {
  if (!params.siteKey || (params.bindingRole !== 'seed' && params.bindingRole !== 'search')) {
    return [];
  }

  // maxFollowUps defaults to 3, but can be overridden by site minFetchCount
  const limit = Math.max(1, Math.min(params.maxFollowUps ?? 3, 20));

  switch (params.siteKey) {
    case 'zhihu': {
      const pageType = typeof params.extraction.structuredData?.pageType === 'string'
        ? params.extraction.structuredData.pageType
        : '';
      if (pageType !== 'list_page') {
        return [];
      }

      const results = Array.isArray(params.extraction.structuredData?.results)
        ? params.extraction.structuredData.results
        : [];
      const followUpUrls: string[] = [];

      for (const entry of results) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          continue;
        }

        const candidate = normalizeHttpUrl((entry as { url?: unknown }).url);
        if (!candidate || params.seenUrls.has(candidate)) {
          continue;
        }
        if (!isZhihuDetailUrl(candidate)) {
          continue;
        }

        params.seenUrls.add(candidate);
        followUpUrls.push(candidate);
        if (followUpUrls.length >= limit) {
          break;
        }
      }

      return followUpUrls;
    }
    default:
      return [];
  }
}
