/**
 * 令牌新鲜度管理。
 *
 * 注入是同步的(在 mcpServerRecordToConfig 里拼 header),而续期是网络请求。
 * 所以把两件事分开:调用方在启动会话前 await 一次续期,之后同步注入读到的
 * 就是新令牌。
 *
 * 提前量取 5 分钟:一次对话可能持续很久,踩着过期线注入等于开局就废。
 */

import {
  deleteMcpOAuthToken,
  getAllMcpOAuthTokens,
  getMcpOAuthToken,
  saveMcpOAuthToken,
} from '@/lib/db/mcp-oauth';
import { refreshAccessToken } from './client';
import type { McpAuthStatus, McpOAuthToken } from './types';

const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** 同一台服务器的并发续期合流,避免多个会话同时开跑时打出一串刷新请求。 */
const inFlight = new Map<string, Promise<void>>();

function needsRefresh(token: McpOAuthToken): boolean {
  if (!token.expiresAt) return false; // 没给过期时间的当作长期有效
  return Date.now() + REFRESH_SKEW_MS >= token.expiresAt;
}

async function refreshOne(token: McpOAuthToken): Promise<void> {
  if (!token.refreshToken) {
    // 拿不到续期凭证又已过期 —— 只能让用户重新授权,先删掉避免拿废令牌去连
    deleteMcpOAuthToken(token.serverId);
    return;
  }
  try {
    const next = await refreshAccessToken({
      tokenEndpoint: token.tokenEndpoint,
      clientId: token.clientId,
      clientSecret: token.clientSecret,
      refreshToken: token.refreshToken,
      resource: token.resource,
    });
    saveMcpOAuthToken({
      ...token,
      accessToken: next.access_token,
      // 有的服务器轮换 refresh_token,没返回就沿用旧的
      refreshToken: next.refresh_token || token.refreshToken,
      expiresAt: next.expires_in ? Date.now() + next.expires_in * 1000 : undefined,
      scope: next.scope || token.scope,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // invalid_grant = 续期凭证已被吊销/用过,重试没意义,清掉让 UI 提示重新授权。
    // 其它错误(网络抖动、服务器 5xx)保留令牌,下次再试。
    if (/invalid_grant/i.test(message)) {
      deleteMcpOAuthToken(token.serverId);
    }
    console.warn(`[mcp-oauth] 刷新令牌失败(server=${token.serverId}):${message}`);
  }
}

/**
 * 把所有临近过期的令牌续上。会话启动前调用一次。
 * 单台失败不影响其它台 —— 一个知识库连不上不该拖垮整场对话。
 */
export async function ensureFreshMcpOAuthTokens(): Promise<void> {
  let tokens: Map<string, McpOAuthToken>;
  try {
    tokens = getAllMcpOAuthTokens();
  } catch {
    return; // 表还没建(老库首次启动)时静默跳过
  }
  const jobs: Promise<void>[] = [];
  for (const token of tokens.values()) {
    if (!needsRefresh(token)) continue;
    const existing = inFlight.get(token.serverId);
    if (existing) {
      jobs.push(existing);
      continue;
    }
    const job = refreshOne(token).finally(() => inFlight.delete(token.serverId));
    inFlight.set(token.serverId, job);
    jobs.push(job);
  }
  await Promise.allSettled(jobs);
}

/**
 * 给 UI 看的授权状态。
 *
 * 这里只看本地有没有令牌,不去探测服务器 —— 设置页每次渲染都发一轮网络探测
 * 太重。"到底需不需要授权"留到用户点授权时再判定。
 */
export function getMcpAuthStatus(serverId: string, isRemote: boolean): McpAuthStatus {
  if (!isRemote) return { state: 'not-required' };
  let token: McpOAuthToken | undefined;
  try {
    token = getMcpOAuthToken(serverId);
  } catch {
    return { state: 'needs-auth' };
  }
  if (!token) return { state: 'needs-auth' };
  // 已过期且没有续期凭证 → 得让用户重新授权;有 refresh_token 的仍算已授权,
  // 下次会话启动前会自动续上。
  if (token.expiresAt && Date.now() >= token.expiresAt && !token.refreshToken) {
    return { state: 'expired' };
  }
  return { state: 'authorized', expiresAt: token.expiresAt, scope: token.scope };
}
