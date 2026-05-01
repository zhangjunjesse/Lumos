import type { BrowserProfileSummary, BrowserProviderConfig, BrowserProviderTestResponse } from '@/types';
import { fetchAdsPowerProfiles } from './adspower-api';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeExternalCdpHttpBase(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
    return `${parsed.protocol === 'wss:' ? 'https:' : 'http:'}//${parsed.host}`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`不支持的 CDP 地址协议: ${parsed.protocol}`);
  }
  const path = parsed.pathname.replace(/\/+$/, '');
  const basePath = path && path !== '/' && !path.startsWith('/json') ? path : '';
  return `${parsed.origin}${basePath}`.replace(/\/+$/, '');
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${text ? ` - ${text.slice(0, 240)}` : ''}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`返回不是有效 JSON${text ? `: ${text.slice(0, 240)}` : ''}`);
  }
}

async function testExternalCdp(config: BrowserProviderConfig): Promise<Omit<BrowserProviderTestResponse, 'config'>> {
  const endpoint = normalizeText(config.cdp_endpoint);
  if (!endpoint) {
    throw new Error('请填写 DevTools HTTP 或 WebSocket 地址');
  }

  const baseUrl = normalizeExternalCdpHttpBase(endpoint);
  const targets = await fetchJson<Array<{ id?: string; type?: string; title?: string; url?: string }>>(`${baseUrl}/json/list`);
  const profiles = targets
    .filter((target) => target.id && (!target.type || target.type === 'page'))
    .slice(0, 20)
    .map((target) => ({
      id: target.id || '',
      name: target.title || target.url || target.id || 'Untitled',
      status: target.url || '',
    }));

  return {
    ok: true,
    status: 'success',
    message: `连接成功，发现 ${profiles.length} 个页面`,
    profile_count: profiles.length,
    profiles,
  };
}

async function testAdsPower(config: BrowserProviderConfig): Promise<Omit<BrowserProviderTestResponse, 'config'>> {
  const profiles = await fetchAdsPowerProfiles({
    apiBaseUrl: config.api_base_url,
    apiKey: config.api_key,
    profileId: config.profile_id,
    pageSize: 100,
    maxProfiles: config.profile_id.trim() ? 100 : 500,
  });

  const selectedFound = config.profile_id.trim()
    ? profiles.some((profile) => profile.id === config.profile_id.trim())
    : true;
  if (config.profile_id.trim() && !selectedFound) {
    throw new Error(`连接成功，但没有在返回列表中找到 profile: ${config.profile_id.trim()}`);
  }

  return {
    ok: true,
    status: 'success',
    message: config.profile_id.trim()
      ? `连接成功，profile ${config.profile_id.trim()} 可用`
      : `连接成功，发现 ${profiles.length} 个 profile`,
    profile_count: profiles.length,
    profiles,
  };
}

export async function testBrowserProviderConfig(
  config: BrowserProviderConfig,
): Promise<Omit<BrowserProviderTestResponse, 'config'>> {
  try {
    if (config.provider_type === 'external-cdp') {
      return await testExternalCdp(config);
    }
    if (config.provider_type === 'adspower') {
      return await testAdsPower(config);
    }
    throw new Error(`不支持的浏览器接入类型: ${config.provider_type}`);
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      profile_count: 0,
      profiles: [] as BrowserProfileSummary[],
    };
  }
}
