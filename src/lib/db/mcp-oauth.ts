/**
 * 远程 MCP 的 OAuth 令牌存储。
 *
 * 一台服务器一条记录,键是 mcp_servers.id —— 服务器删了令牌就该跟着没,所以
 * 建表时带 ON DELETE CASCADE(SQLite 需要 PRAGMA foreign_keys=ON 才生效,
 * deleteMcpServer 里另有显式清理兜底)。
 *
 * 令牌只存在 `~/.lumos/lumos.db`,不落 `~/.claude`、不进日志。
 */

import type { McpOAuthToken } from '@/lib/mcp-oauth/types';
import { getDb } from './connection';

interface McpOAuthTokenRow {
  server_id: string;
  issuer: string;
  resource: string;
  token_endpoint: string;
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
  scope: string;
}

function rowToToken(row: McpOAuthTokenRow): McpOAuthToken {
  return {
    serverId: row.server_id,
    issuer: row.issuer,
    resource: row.resource,
    tokenEndpoint: row.token_endpoint,
    clientId: row.client_id,
    clientSecret: row.client_secret || undefined,
    accessToken: row.access_token,
    refreshToken: row.refresh_token || undefined,
    expiresAt: row.expires_at ?? undefined,
    scope: row.scope || undefined,
  };
}

export function getMcpOAuthToken(serverId: string): McpOAuthToken | undefined {
  const row = getDb()
    .prepare('SELECT * FROM mcp_oauth_tokens WHERE server_id = ?')
    .get(serverId) as McpOAuthTokenRow | undefined;
  return row ? rowToToken(row) : undefined;
}

/** 一次性取全部,给"批量注入 header"用,避免每台服务器一次查询。 */
export function getAllMcpOAuthTokens(): Map<string, McpOAuthToken> {
  const rows = getDb().prepare('SELECT * FROM mcp_oauth_tokens').all() as McpOAuthTokenRow[];
  return new Map(rows.map((r) => [r.server_id, rowToToken(r)]));
}

export function saveMcpOAuthToken(token: McpOAuthToken): void {
  getDb()
    .prepare(
      `INSERT INTO mcp_oauth_tokens
         (server_id, issuer, resource, token_endpoint, client_id, client_secret,
          access_token, refresh_token, expires_at, scope, updated_at)
       VALUES (@serverId, @issuer, @resource, @tokenEndpoint, @clientId, @clientSecret,
               @accessToken, @refreshToken, @expiresAt, @scope, datetime('now'))
       ON CONFLICT(server_id) DO UPDATE SET
         issuer = excluded.issuer,
         resource = excluded.resource,
         token_endpoint = excluded.token_endpoint,
         client_id = excluded.client_id,
         client_secret = excluded.client_secret,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         scope = excluded.scope,
         updated_at = datetime('now')`,
    )
    .run({
      serverId: token.serverId,
      issuer: token.issuer,
      resource: token.resource,
      tokenEndpoint: token.tokenEndpoint,
      clientId: token.clientId,
      clientSecret: token.clientSecret ?? '',
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? '',
      expiresAt: token.expiresAt ?? null,
      scope: token.scope ?? '',
    });
}

/** 撤销授权(用户点"取消授权",或刷新失败到不可恢复时)。 */
export function deleteMcpOAuthToken(serverId: string): boolean {
  return getDb().prepare('DELETE FROM mcp_oauth_tokens WHERE server_id = ?').run(serverId)
    .changes > 0;
}
