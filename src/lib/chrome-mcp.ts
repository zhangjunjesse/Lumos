export function normalizeHttpUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

export function extractChromeMcpUrl(toolName: string, toolInput: unknown): string | null {
  const normalizedName = toolName.toLowerCase();
  const isChromeMcpTool =
    normalizedName.includes('chrome-devtools') ||
    normalizedName.includes('chrome_devtools') ||
    normalizedName === 'new_page' ||
    normalizedName === 'navigate_page';
  if (!isChromeMcpTool) return null;
  if (!toolInput || typeof toolInput !== 'object') return null;

  const input = toolInput as Record<string, unknown>;
  const directUrl = typeof input.url === 'string' ? normalizeHttpUrl(input.url) : null;
  if (!directUrl) return null;

  // navigate_page can also be reload/back/forward; only open panel URL on type=url.
  if (normalizedName.endsWith('navigate_page')) {
    const navType = typeof input.type === 'string' ? input.type.toLowerCase() : '';
    if (navType && navType !== 'url') return null;
  }

  return directUrl;
}

export function openBrowserUrlInPanel(url: string): void {
  window.dispatchEvent(
    new CustomEvent('lumos:browser-open-url', {
      detail: { url, source: 'chrome-mcp' },
    }),
  );
}
