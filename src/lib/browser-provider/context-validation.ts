import { listBrowserProviderConfigs } from '@/lib/db/browser-providers';
import { normalizeBrowserContextId, EMBEDDED_BROWSER_CONTEXT_ID } from './labels';
import { LOCAL_CHROME_CONTEXT_ID, detectLocalChromePath, readLocalChromeSettings } from './local-chrome';

export function validateBrowserContextId(value?: string | null): string {
  const contextId = normalizeBrowserContextId(value);
  if (contextId === EMBEDDED_BROWSER_CONTEXT_ID) return contextId;

  // 本地 Chrome 不进 DB(选项走 runtime 文件),单独校验:启用 且 系统检测到 Chrome 才放行。
  if (contextId === LOCAL_CHROME_CONTEXT_ID) {
    const settings = readLocalChromeSettings();
    if (!settings.enabled) {
      throw new Error('本地 Chrome 已停用，请先在设置 > 浏览器里启用');
    }
    if (!detectLocalChromePath(settings.chromePath)) {
      throw new Error('未检测到本地 Google Chrome，请先安装 Chrome 后再选择');
    }
    return contextId;
  }

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
