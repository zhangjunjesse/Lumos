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
export function buildCleanChromeUserAgent(): string {
  const chromeVersion = process.versions.chrome || '130.0.0.0';
  const platformToken = (() => {
    switch (process.platform) {
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
