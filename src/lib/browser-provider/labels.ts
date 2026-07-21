import type { BrowserProviderConfigView } from '@/types';

export const EMBEDDED_BROWSER_CONTEXT_ID = 'embedded:default';
export const LOCAL_CHROME_BROWSER_CONTEXT_ID = 'local-chrome:default';

export function normalizeBrowserContextId(value?: string | null): string {
  return value?.trim() || EMBEDDED_BROWSER_CONTEXT_ID;
}

export function browserProviderPrefix(providerType: BrowserProviderConfigView['provider_type']): string {
  if (providerType === 'adspower') return 'AdsPower';
  if (providerType === 'external-cdp') return 'CDP';
  return '浏览器';
}

export function browserConfigLabel(config: BrowserProviderConfigView): string {
  return `${browserProviderPrefix(config.provider_type)} · ${config.display_name}`;
}

export function browserContextFallbackLabel(contextId?: string | null): string {
  const normalized = normalizeBrowserContextId(contextId);
  if (normalized === EMBEDDED_BROWSER_CONTEXT_ID) return '内置浏览器';
  if (normalized === LOCAL_CHROME_BROWSER_CONTEXT_ID) return '本地 Chrome';
  if (normalized.startsWith('adspower:')) return `AdsPower · ${normalized.slice('adspower:'.length)}`;
  if (normalized.startsWith('external-cdp:')) return `CDP · ${normalized.slice('external-cdp:'.length)}`;
  return normalized;
}

export function buildBrowserContextLabelMap(configs: BrowserProviderConfigView[]): Record<string, string> {
  const labels: Record<string, string> = {
    [EMBEDDED_BROWSER_CONTEXT_ID]: '内置浏览器',
    [LOCAL_CHROME_BROWSER_CONTEXT_ID]: '本地 Chrome',
  };
  for (const config of configs) {
    labels[config.context_id] = browserConfigLabel(config);
  }
  return labels;
}

export function resolveBrowserContextLabel(
  contextId?: string | null,
  labels?: Record<string, string>,
): string {
  const normalized = normalizeBrowserContextId(contextId);
  return labels?.[normalized] || browserContextFallbackLabel(normalized);
}
