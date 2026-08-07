/**
 * 授权服务器发现。
 *
 * 标准路径是三跳:探 MCP 地址拿 401 → 顺着 WWW-Authenticate 找资源元数据 →
 * 从中读出授权服务器再拉它的元数据。
 *
 * 现实里各家实现对元数据摆放位置的理解不一致(RFC 8414 要求把 issuer 的路径
 * 插到 `.well-known` 之后,但不少服务器直接放在根上或 issuer 路径下),所以
 * 每一跳都按候选顺序试,取第一个能解析出来的。多试几个 URL 的代价远小于
 * "标准上对、实际连不上"。
 */

import type {
  AuthServerMetadata,
  DiscoveredOAuthConfig,
  ProtectedResourceMetadata,
} from './types';

const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/**
 * 从 401 响应头里取资源元数据地址。
 * 形如:`Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"`
 */
export function parseResourceMetadataUrl(wwwAuthenticate: string | null): string | undefined {
  if (!wwwAuthenticate) return undefined;
  const m = /resource_metadata\s*=\s*"([^"]+)"/i.exec(wwwAuthenticate);
  return m?.[1];
}

/** 生成 `.well-known` 候选地址:先 RFC 8414 的路径插入式,再退回根与 issuer 路径下。 */
function wellKnownCandidates(base: string, suffix: string): string[] {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return [];
  }
  const path = url.pathname.replace(/\/$/, '');
  const origin = url.origin;
  const candidates = [
    // RFC 8414:issuer 的路径要插在 .well-known 之后
    path ? `${origin}/.well-known/${suffix}${path}` : `${origin}/.well-known/${suffix}`,
    // 实践中常见:直接挂在 issuer 路径下
    `${origin}${path}/.well-known/${suffix}`,
    // 兜底:根
    `${origin}/.well-known/${suffix}`,
  ];
  return [...new Set(candidates)];
}

/**
 * 探一次 MCP 地址,判断它要不要授权。
 *
 * 三态而不是布尔:网络不通时"探不出来"和"确定不需要"是两回事 —— 前者不该
 * 让用户看到"这台服务器不需要授权"这种笃定的错误结论。
 */
export async function probeAuthRequirement(
  mcpUrl: string,
): Promise<{ requirement: 'required' | 'not-required' | 'unknown'; resourceMetadataUrl?: string }> {
  try {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      // 一个最小的 initialize:够让服务器判定要不要鉴权,又不产生副作用
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'lumos', version: '1' },
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status !== 401 && res.status !== 403) return { requirement: 'not-required' };
    return {
      requirement: 'required',
      resourceMetadataUrl: parseResourceMetadataUrl(res.headers.get('www-authenticate')),
    };
  } catch {
    // 网络不通 / 超时:探不出来。不能当成"不需要授权",否则用户会收到一句
    // 笃定但错误的结论,反而不去排查真正的网络问题。
    return { requirement: 'unknown' };
  }
}

async function discoverResourceMetadata(
  mcpUrl: string,
  hintedUrl?: string,
): Promise<ProtectedResourceMetadata | undefined> {
  const candidates = [
    ...(hintedUrl ? [hintedUrl] : []),
    ...wellKnownCandidates(mcpUrl, 'oauth-protected-resource'),
  ];
  for (const url of candidates) {
    const meta = await fetchJson<ProtectedResourceMetadata>(url);
    if (meta?.authorization_servers?.length) return meta;
  }
  return undefined;
}

async function discoverAuthServerMetadata(issuer: string): Promise<AuthServerMetadata | undefined> {
  const candidates = [
    ...wellKnownCandidates(issuer, 'oauth-authorization-server'),
    ...wellKnownCandidates(issuer, 'openid-configuration'),
  ];
  for (const url of candidates) {
    const meta = await fetchJson<AuthServerMetadata>(url);
    if (meta?.authorization_endpoint && meta.token_endpoint) return meta;
  }
  return undefined;
}

/**
 * 完整发现:MCP 地址 → 可用于发起授权的配置。
 * @throws 发现链任一跳失败时抛出可读原因(会原样显示给用户)
 */
export async function discoverOAuthConfig(
  mcpUrl: string,
  hintedResourceMetadataUrl?: string,
): Promise<DiscoveredOAuthConfig> {
  const resourceMeta = await discoverResourceMetadata(mcpUrl, hintedResourceMetadataUrl);
  if (!resourceMeta) {
    throw new Error(
      '没找到这个服务器的 OAuth 资源元数据(/.well-known/oauth-protected-resource)。' +
        '它可能不支持标准 OAuth,请确认地址是否正确,或改用固定 Token(在请求头里填 Authorization)。',
    );
  }
  const issuer = resourceMeta.authorization_servers?.[0];
  if (!issuer) throw new Error('服务器的资源元数据里没有声明授权服务器(authorization_servers)。');

  const metadata = await discoverAuthServerMetadata(issuer);
  if (!metadata) {
    throw new Error(`拉不到授权服务器 ${issuer} 的元数据,无法发起授权。`);
  }
  return {
    resource: resourceMeta.resource || mcpUrl,
    metadata,
    scopes: resourceMeta.scopes_supported || metadata.scopes_supported || [],
  };
}
