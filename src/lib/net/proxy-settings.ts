import { getSetting } from '@/lib/db';
import {
  buildProxyEnvFromSettings,
  createHttpsProxyAgentForUrl,
  getProxyForUrl,
  normalizeProxyMode,
  type NetworkProxySettings,
  type ProxyEnv,
} from './proxy';

export const NETWORK_PROXY_KEYS = {
  mode: 'network.proxy.mode',
  httpProxy: 'network.proxy.http',
  httpsProxy: 'network.proxy.https',
  noProxy: 'network.proxy.no_proxy',
} as const;

export function readNetworkProxySettings(): NetworkProxySettings {
  return {
    mode: getSetting(NETWORK_PROXY_KEYS.mode) || 'system',
    httpProxy: getSetting(NETWORK_PROXY_KEYS.httpProxy) || '',
    httpsProxy: getSetting(NETWORK_PROXY_KEYS.httpsProxy) || '',
    noProxy: getSetting(NETWORK_PROXY_KEYS.noProxy) || '',
  };
}

export function getConfiguredProxyEnv(env: ProxyEnv = process.env): ProxyEnv {
  return buildProxyEnvFromSettings(readNetworkProxySettings(), env);
}

export function getConfiguredProxyForUrl(input: string | URL): string | null {
  return getProxyForUrl(input, getConfiguredProxyEnv());
}

export function createConfiguredHttpsProxyAgentForUrl(input: string | URL) {
  return createHttpsProxyAgentForUrl(input, getConfiguredProxyEnv());
}

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'] as const;
const LOCAL_NO_PROXY = '127.0.0.1,localhost,::1';

/**
 * 把用户配置的代理就地应用到一个子进程环境对象。供本地 Claude(local_auth) 子进程用——
 * 它走官方 api.anthropic.com（国内常被墙），需经「设置→通用→外网连接」配的代理出网。
 *
 * - mode=off：清掉继承自 OS 的代理键（本地 Claude 直连）。
 * - mode=system：用 OS 环境里的代理（已随 process.env 继承，这里只补 NO_PROXY 本地豁免）。
 * - mode=custom：用设置里填的 HTTP_PROXY/HTTPS_PROXY。
 * 始终把 127.0.0.1/localhost 并入 NO_PROXY，避免子进程回调 Lumos 内部接口（MCP）被代理吞掉。
 */
export function applyConfiguredProxyToEnv(target: Record<string, string>): void {
  if (normalizeProxyMode(readNetworkProxySettings().mode) === 'off') {
    for (const key of PROXY_ENV_KEYS) delete target[key];
    return;
  }
  const proxyEnv = getConfiguredProxyEnv();
  const http = (proxyEnv.HTTP_PROXY || proxyEnv.HTTPS_PROXY || '').trim();
  const https = (proxyEnv.HTTPS_PROXY || proxyEnv.HTTP_PROXY || '').trim();
  if (!http && !https) return; // system 模式但 OS 未配代理 → 不动，保持直连
  if (http) target.HTTP_PROXY = http;
  if (https) target.HTTPS_PROXY = https;
  const noProxy = (proxyEnv.NO_PROXY || '').trim();
  target.NO_PROXY = !noProxy
    ? LOCAL_NO_PROXY
    : noProxy.includes('127.0.0.1')
      ? noProxy
      : `${LOCAL_NO_PROXY},${noProxy}`;
}
