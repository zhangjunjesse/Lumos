import { getSetting } from '@/lib/db';
import {
  buildProxyEnvFromSettings,
  createHttpsProxyAgentForUrl,
  getProxyForUrl,
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
