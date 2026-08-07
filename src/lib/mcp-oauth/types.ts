/**
 * 远程 MCP 的 OAuth 2.1 接入(MCP Authorization spec / RFC 9728 / 8414 / 7591 / 7636)。
 *
 * 背景:Lumos 早就支持远程 MCP(type=http|sse)和固定 headers,但"需要登录授权"的
 * 服务器(如信鸽 xgrag 知识库)填了地址也连不上 —— 它返回 401,要求走 OAuth。
 * SDK 只能把这类服务器标成 `needs-auth`,自身不提供触发授权的入口,CLI 的授权
 * 又只在 TUI 里交互完成、令牌存储格式未公开。
 *
 * 所以这套是 Lumos 自建的 OAuth 客户端:自己发现、注册、授权、存令牌,再通过
 * SDK 已支持的 `headers` 通道注入 Bearer。好处是不赌 CLI 的内部实现。
 *
 * 隔离原则:令牌只落在 Lumos 自己的数据空间(`~/.lumos` 的 lumos.db),
 * 不写 `~/.claude`,不进 git,不进日志。
 */

/** 受保护资源元数据(RFC 9728)。401 的 WWW-Authenticate 指向它。 */
export interface ProtectedResourceMetadata {
  resource?: string;
  /** 谁能签发这个资源的令牌。取第一个作为 issuer。 */
  authorization_servers?: string[];
  scopes_supported?: string[];
}

/** 授权服务器元数据(RFC 8414)。 */
export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  /** 有它才能动态注册(RFC 7591),否则得让用户自己填 client_id。 */
  registration_endpoint?: string;
  scopes_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

/** 一次授权所需的全部服务端信息,发现阶段的产物。 */
export interface DiscoveredOAuthConfig {
  /** MCP 资源标识,换令牌时要作为 `resource` 参数回传(RFC 8707)。 */
  resource: string;
  metadata: AuthServerMetadata;
  /** 资源声明支持的 scope;没声明时留空,授权请求就不带 scope。 */
  scopes: string[];
}

/** 已注册的客户端(动态注册产物,或用户手填)。 */
export interface OAuthClientRegistration {
  client_id: string;
  /** public client(token_endpoint_auth_method=none)时为空。 */
  client_secret?: string;
}

/** 令牌端点返回体。 */
export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/** 落库的一条授权记录。 */
export interface McpOAuthToken {
  serverId: string;
  issuer: string;
  resource: string;
  clientId: string;
  clientSecret?: string;
  accessToken: string;
  refreshToken?: string;
  /** epoch ms;没有过期信息时为 undefined(当作长期有效)。 */
  expiresAt?: number;
  scope?: string;
  tokenEndpoint: string;
}

/** 授权流程进行中的一次会话(等浏览器回调期间的暂存)。 */
export interface PendingAuthorization {
  state: string;
  serverId: string;
  serverName: string;
  codeVerifier: string;
  redirectUri: string;
  discovered: DiscoveredOAuthConfig;
  registration: OAuthClientRegistration;
  createdAt: number;
}

/** UI 展示用的授权状态。 */
export type McpAuthStatus =
  | { state: 'not-required' }
  | { state: 'authorized'; expiresAt?: number; scope?: string }
  | { state: 'expired' }
  | { state: 'needs-auth' };
