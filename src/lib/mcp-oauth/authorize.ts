/**
 * 授权流程编排:发起 → (用户在浏览器里登录授权) → 回调落库。
 *
 * 回调地址直接用 Lumos 自己的 Next.js 服务(127.0.0.1:<端口>/api/mcp/oauth/callback),
 * 不额外起临时 HTTP 服务 —— 少一个要管生命周期的东西,也避开端口占用和防火墙弹窗。
 *
 * 等待回调期间的一次性上下文(PKCE verifier、发现结果、注册信息)放在内存里:
 * 它只在这几分钟内有意义,落库反而要额外考虑清理和泄露面。进程重启则授权作废,
 * 用户重新点一次即可。
 */

import { getMcpServer } from '@/lib/db/mcp-servers';
import { saveMcpOAuthToken } from '@/lib/db/mcp-oauth';
import { discoverOAuthConfig, probeAuthRequirement } from './discovery';
import { buildAuthorizationUrl, exchangeCodeForToken, registerClient } from './client';
import { createPkcePair, createState } from './pkce';
import type { PendingAuthorization } from './types';

/** 授权会话有效期。用户在浏览器里登录慢一点也够用,过期的会被清掉。 */
const PENDING_TTL_MS = 10 * 60 * 1000;

const pending = new Map<string, PendingAuthorization>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [state, p] of pending) {
    if (now - p.createdAt > PENDING_TTL_MS) pending.delete(state);
  }
}

/** Lumos 内嵌服务的回调地址。端口随打包环境变(开发 3000 / 打包 43127)。 */
export function resolveRedirectUri(): string {
  const port = process.env.PORT?.trim() || process.env.LUMOS_SERVER_PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}/api/mcp/oauth/callback`;
}

/**
 * 发起授权:返回要在浏览器里打开的地址。
 *
 * 每次都重新做一次动态注册 —— 注册时必须声明 redirect_uri,而端口在开发/打包
 * 环境下不同,复用旧的 client_id 可能撞上"redirect_uri 不匹配"。注册很便宜,
 * 换来的是端口怎么变都能授权成功。
 */
export async function beginAuthorization(serverId: string): Promise<{ authorizationUrl: string }> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error('找不到这个 MCP 服务器。');
  if (!server.url) throw new Error('只有远程 MCP(HTTP / SSE)才需要 OAuth 授权。');

  const probe = await probeAuthRequirement(server.url);
  const discovered = await discoverOAuthConfig(server.url, probe.resourceMetadataUrl);

  const redirectUri = resolveRedirectUri();
  const registration = await registerClient(discovered.metadata, redirectUri, discovered.scopes);

  const pkce = createPkcePair();
  const state = createState();
  sweepExpired();
  pending.set(state, {
    state,
    serverId,
    serverName: server.name,
    codeVerifier: pkce.codeVerifier,
    redirectUri,
    discovered,
    registration,
    createdAt: Date.now(),
  });

  return {
    authorizationUrl: buildAuthorizationUrl({ discovered, registration, redirectUri, pkce, state }),
  };
}

/**
 * 处理浏览器回调:校验 state、拿授权码换令牌、落库。
 * @returns 授权成功的服务器名,用于回调页面文案
 */
export async function completeAuthorization(state: string, code: string): Promise<string> {
  sweepExpired();
  const p = pending.get(state);
  // state 对不上 = 伪造的回调,或者授权拖太久已过期
  if (!p) throw new Error('授权会话已失效,请回到 Lumos 重新点一次授权。');
  pending.delete(state);

  const token = await exchangeCodeForToken({
    discovered: p.discovered,
    registration: p.registration,
    redirectUri: p.redirectUri,
    codeVerifier: p.codeVerifier,
    code,
  });

  saveMcpOAuthToken({
    serverId: p.serverId,
    issuer: p.discovered.metadata.issuer,
    resource: p.discovered.resource,
    tokenEndpoint: p.discovered.metadata.token_endpoint,
    clientId: p.registration.client_id,
    clientSecret: p.registration.client_secret,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
    scope: token.scope,
  });

  return p.serverName;
}
