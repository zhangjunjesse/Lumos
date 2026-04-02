export interface DeepSearchCookieImportEntry {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  expirationDate?: number;
}

interface ParsedCookiePair {
  name: string;
  value: string;
}

const COOKIE_ATTRIBUTE_NAMES = new Set([
  'path',
  'expires',
  'max-age',
  'domain',
  'samesite',
  'priority',
  'partitioned',
]);

function normalizeCookieHeader(raw: string): string {
  const trimmed = raw.trim();
  if (/^cookie\s*:/i.test(trimmed)) {
    return trimmed.replace(/^cookie\s*:/i, '').trim();
  }
  return trimmed;
}

export function parseDeepSearchCookieHeader(raw: string): ParsedCookiePair[] {
  const normalized = normalizeCookieHeader(raw);
  if (!normalized) {
    return [];
  }

  const deduped = new Map<string, string>();
  const parts = normalized
    .split(/[;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!name || !value) {
      continue;
    }

    if (COOKIE_ATTRIBUTE_NAMES.has(name.toLowerCase())) {
      continue;
    }

    deduped.set(name, value);
  }

  return Array.from(deduped.entries()).map(([name, value]) => ({ name, value }));
}

function toUnixSeconds(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return Math.floor(parsed.getTime() / 1000);
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/^\.+/, '').toLowerCase();
}

function resolvePrimaryCookieDomain(baseUrl: string, preferredDomains: string[]): string | undefined {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    for (const preferredDomain of preferredDomains) {
      const normalizedPreferred = normalizeDomain(preferredDomain);
      if (!normalizedPreferred) {
        continue;
      }
      if (hostname === normalizedPreferred || hostname.endsWith(`.${normalizedPreferred}`)) {
        return preferredDomain.startsWith('.') ? preferredDomain : `.${normalizedPreferred}`;
      }
    }
    return hostname;
  } catch {
    return undefined;
  }
}

export function buildDeepSearchCookieImportEntries(params: {
  baseUrl: string;
  preferredDomains: string[];
  cookieHeader: string;
  cookieExpiresAt?: string | null;
}): DeepSearchCookieImportEntry[] {
  const cookies = parseDeepSearchCookieHeader(params.cookieHeader);
  if (cookies.length === 0) {
    return [];
  }

  const secureByUrl = (() => {
    try {
      return new URL(params.baseUrl).protocol === 'https:';
    } catch {
      return true;
    }
  })();
  const primaryDomain = resolvePrimaryCookieDomain(params.baseUrl, params.preferredDomains);
  const expirationDate = toUnixSeconds(params.cookieExpiresAt);

  return cookies.map((cookie) => {
    const secure = secureByUrl || cookie.name.startsWith('__Secure-') || cookie.name.startsWith('__Host-');
    const entry: DeepSearchCookieImportEntry = {
      url: params.baseUrl,
      name: cookie.name,
      value: cookie.value,
      path: '/',
      secure,
      ...(expirationDate ? { expirationDate } : {}),
    };

    if (!cookie.name.startsWith('__Host-') && primaryDomain) {
      entry.domain = primaryDomain;
    }

    return entry;
  });
}
