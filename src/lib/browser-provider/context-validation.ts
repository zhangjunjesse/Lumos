import { listBrowserProviderConfigs } from '@/lib/db/browser-providers';
import { normalizeBrowserContextId, EMBEDDED_BROWSER_CONTEXT_ID } from './labels';

export function validateBrowserContextId(value?: string | null): string {
  const contextId = normalizeBrowserContextId(value);
  if (contextId === EMBEDDED_BROWSER_CONTEXT_ID) return contextId;

  const config = listBrowserProviderConfigs().find((item) => item.context_id === contextId);
  if (!config) {
    throw new Error('浏览器不存在或未配置，请先在设置 > 浏览器里检查配置');
  }
  if (config.enabled !== 1) {
    throw new Error(`浏览器「${config.display_name}」已停用，请先在设置 > 浏览器里启用`);
  }
  if (config.provider_type === 'adspower' && !config.profile_id.trim()) {
    throw new Error(`浏览器「${config.display_name}」缺少 AdsPower Profile ID`);
  }
  if (config.provider_type === 'external-cdp' && !config.cdp_endpoint.trim()) {
    throw new Error(`浏览器「${config.display_name}」缺少 CDP 地址`);
  }
  return contextId;
}
