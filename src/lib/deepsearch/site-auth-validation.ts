export interface DeepSearchSitePageValidationConfig {
  validationUrl?: string;
  loginUrlPatterns?: RegExp[];
  loggedOutTextHints?: string[];
}

export interface DeepSearchSitePageValidationSnapshot {
  url: string;
  title: string;
  text: string;
}

export interface DeepSearchSitePageValidationResult {
  blocked: boolean;
  reason: string;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function validateDeepSearchSiteSessionFromPage(
  snapshot: DeepSearchSitePageValidationSnapshot,
  config?: DeepSearchSitePageValidationConfig,
): DeepSearchSitePageValidationResult {
  const url = snapshot.url.trim();
  const title = snapshot.title.trim();
  const haystack = normalizeText(`${snapshot.title}\n${snapshot.text}`);

  for (const pattern of config?.loginUrlPatterns ?? []) {
    if (pattern.test(url)) {
      return {
        blocked: true,
        reason: `Validation page redirected to a login URL: ${url}`,
      };
    }
  }

  for (const hint of config?.loggedOutTextHints ?? []) {
    const needle = normalizeText(hint);
    if (needle && haystack.includes(needle)) {
      return {
        blocked: true,
        reason: `Validation page still shows a login prompt: ${hint}`,
      };
    }
  }

  if (!url && !title && !haystack) {
    return {
      blocked: true,
      reason: 'Validation page did not return usable content.',
    };
  }

  return {
    blocked: false,
    reason: '',
  };
}
