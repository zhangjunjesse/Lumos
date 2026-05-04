export interface ChromeIdentityOptions {
  chromeVersion?: string;
  platform?: NodeJS.Platform;
  locale?: string;
}

export type BrowserRequestHeaders = Record<string, string>;

/**
 * Build a clean Chrome User-Agent string that hides Electron / app identifiers.
 *
 * Anti-bot vendors (Akamai on etsy.com, Cloudflare bot fight, etc.) blacklist
 * UAs containing "Electron" or app slugs and return 403 / challenge pages even
 * when the underlying TLS/HTTP stack is identical to real Chrome. The default
 * Electron UA looks like:
 *
 *   Mozilla/5.0 ... lumos/0.25.23 Chrome/130.0.0.0 Electron/33.0.0 Safari/537.36
 *
 * which is matched on sight. Stripping the `lumos/` and `Electron/` tokens
 * makes the UA indistinguishable from a stock Chrome of the same major
 * version.
 */
export function buildCleanChromeUserAgent(options: ChromeIdentityOptions = {}): string {
  const chromeVersion = options.chromeVersion || process.versions.chrome || '130.0.0.0';
  const platform = options.platform || process.platform;
  const platformToken = (() => {
    switch (platform) {
      case 'darwin':
        return 'Macintosh; Intel Mac OS X 10_15_7';
      case 'win32':
        return 'Windows NT 10.0; Win64; x64';
      default:
        return 'X11; Linux x86_64';
    }
  })();
  return `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function getChromeMajorVersion(chromeVersion?: string): string {
  const major = String(chromeVersion || process.versions.chrome || '130.0.0.0').split('.')[0];
  return /^\d+$/.test(major) ? major : '130';
}

function getClientHintsPlatform(platform?: NodeJS.Platform): string {
  switch (platform || process.platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    default:
      return 'Linux';
  }
}

export function buildChromeClientHints(options: ChromeIdentityOptions = {}): BrowserRequestHeaders {
  const majorVersion = getChromeMajorVersion(options.chromeVersion);
  return {
    'sec-ch-ua': `"Google Chrome";v="${majorVersion}", "Chromium";v="${majorVersion}", "Not_A Brand";v="99"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${getClientHintsPlatform(options.platform)}"`,
  };
}

export function buildAcceptLanguage(locale?: string): string {
  const normalizedLocale = (locale || 'en-US').trim().replace(/_/g, '-') || 'en-US';
  const primaryLanguage = normalizedLocale.split('-')[0]?.toLowerCase() || 'en';

  if (primaryLanguage === 'en') {
    return normalizedLocale.toLowerCase() === 'en' ? 'en-US,en;q=0.9' : `${normalizedLocale},en;q=0.9`;
  }

  if (normalizedLocale.toLowerCase() === primaryLanguage) {
    return `${normalizedLocale},en;q=0.8`;
  }

  return `${normalizedLocale},${primaryLanguage};q=0.9,en;q=0.8`;
}

function setHeaderCaseInsensitive(headers: BrowserRequestHeaders, name: string, value: string): void {
  for (const existingName of Object.keys(headers)) {
    if (existingName.toLowerCase() === name.toLowerCase()) {
      if (existingName !== name) {
        delete headers[existingName];
      }
      break;
    }
  }
  headers[name] = value;
}

export function normalizeChromeLikeRequestHeaders(
  headers: BrowserRequestHeaders,
  options: ChromeIdentityOptions = {},
): BrowserRequestHeaders {
  const normalized = { ...headers };
  const identityOptions = {
    chromeVersion: options.chromeVersion,
    platform: options.platform,
  };

  setHeaderCaseInsensitive(normalized, 'User-Agent', buildCleanChromeUserAgent(identityOptions));
  setHeaderCaseInsensitive(normalized, 'Accept-Language', buildAcceptLanguage(options.locale));

  for (const [name, value] of Object.entries(buildChromeClientHints(identityOptions))) {
    setHeaderCaseInsensitive(normalized, name, value);
  }

  return normalized;
}
