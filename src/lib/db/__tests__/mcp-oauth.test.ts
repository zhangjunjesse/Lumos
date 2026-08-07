// OAuth 令牌的落库与注入。用真实 sqlite 跑,顺带验证建表迁移和级联清理。
//
// 注入点在 mcpServerRecordToConfig —— 所有运行路径(chat / workflow / bridge)的必经之地,
// 所以这里测通了就等于三条路都带上了令牌。

import fs from 'fs';
import os from 'os';
import path from 'path';

type McpServersModule = typeof import('../mcp-servers');
type McpOAuthModule = typeof import('../mcp-oauth');

describe('远程 MCP 的 OAuth 令牌', () => {
  let tmpDir = '';
  let servers: McpServersModule;
  let oauth: McpOAuthModule;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-mcp-oauth-test-'));
    delete process.env.LUMOS_DATA_DIR;
    process.env.LUMOS_BUILD_PHASE = '1';
    process.env.LUMOS_BUILD_DATA_DIR = tmpDir;
    process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
    jest.resetModules();
    /* eslint-disable @typescript-eslint/no-require-imports -- jest.resetModules() 后必须 CJS 重载才能吃到临时目录 */
    servers = require('../mcp-servers') as McpServersModule;
    oauth = require('../mcp-oauth') as McpOAuthModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- 同上
    const { closeDb } = require('../connection') as typeof import('../connection');
    closeDb({ silent: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_GUI_DATA_DIR;
    delete process.env.LUMOS_BUILD_PHASE;
    delete process.env.LUMOS_BUILD_DATA_DIR;
    jest.resetModules();
  });

  function createRemoteServer(headers: Record<string, string> = {}) {
    return servers.createMcpServer({
      name: 'xgrag',
      command: '',
      type: 'http',
      url: 'https://datadefender.cn/xgrag/mcp',
      headers,
      scope: 'user',
      is_enabled: true,
    });
  }

  function saveToken(serverId: string, accessToken = 'tok-abc') {
    oauth.saveMcpOAuthToken({
      serverId,
      issuer: 'https://datadefender.cn/xgrag',
      resource: 'https://datadefender.cn/xgrag/mcp',
      tokenEndpoint: 'https://datadefender.cn/xgrag/oauth/token',
      clientId: 'cid',
      accessToken,
      refreshToken: 'r1',
      expiresAt: Date.now() + 3600_000,
      scope: 'kb.read kb.write',
    });
  }

  it('存了令牌后,运行配置里自动带上 Bearer', () => {
    const server = createRemoteServer();
    saveToken(server.id);
    const config = servers.getEnabledMcpServersAsConfig();
    expect(config.xgrag.headers?.Authorization).toBe('Bearer tok-abc');
  });

  it('没授权的远程服务器不会凭空多出 Authorization', () => {
    createRemoteServer();
    expect(servers.getEnabledMcpServersAsConfig().xgrag.headers?.Authorization).toBeUndefined();
  });

  it('用户手填的 Authorization 优先 —— 那是明确的人工意图,不该被自动令牌盖掉', () => {
    const server = createRemoteServer({ Authorization: 'Bearer 我自己的' });
    saveToken(server.id);
    expect(servers.getEnabledMcpServersAsConfig().xgrag.headers?.Authorization).toBe(
      'Bearer 我自己的',
    );
  });

  it('大小写不同的手填头也算数(authorization),不能重复塞一个', () => {
    const server = createRemoteServer({ authorization: 'Bearer 小写的' });
    saveToken(server.id);
    const headers = servers.getEnabledMcpServersAsConfig().xgrag.headers || {};
    expect(headers.authorization).toBe('Bearer 小写的');
    expect(headers.Authorization).toBeUndefined();
  });

  it('保留原有的其它请求头', () => {
    const server = createRemoteServer({ 'X-Team': 'lumos' });
    saveToken(server.id);
    const headers = servers.getEnabledMcpServersAsConfig().xgrag.headers || {};
    expect(headers['X-Team']).toBe('lumos');
    expect(headers.Authorization).toBe('Bearer tok-abc');
  });

  it('stdio 服务器不受影响 —— 这是本次改动的底线', () => {
    servers.createMcpServer({
      name: 'douyin',
      command: 'node',
      args: ['x.mjs'],
      scope: 'user',
      is_enabled: true,
    });
    const config = servers.getEnabledMcpServersAsConfig();
    expect(config.douyin.headers).toBeUndefined();
  });

  it('重复保存同一台服务器 = 覆盖更新,不是插两条', () => {
    const server = createRemoteServer();
    saveToken(server.id, 'tok-1');
    saveToken(server.id, 'tok-2');
    expect(oauth.getMcpOAuthToken(server.id)?.accessToken).toBe('tok-2');
    expect(oauth.getAllMcpOAuthTokens().size).toBe(1);
  });

  it('删掉服务器,令牌跟着没 —— 不留下一条对不上任何服务器的凭证', () => {
    const server = createRemoteServer();
    saveToken(server.id);
    servers.deleteMcpServer(server.id);
    expect(oauth.getMcpOAuthToken(server.id)).toBeUndefined();
  });

  it('撤销授权后运行配置里不再带令牌', () => {
    const server = createRemoteServer();
    saveToken(server.id);
    oauth.deleteMcpOAuthToken(server.id);
    expect(servers.getEnabledMcpServersAsConfig().xgrag.headers?.Authorization).toBeUndefined();
  });

  it('往返读写保住全部字段(续期要用 tokenEndpoint / clientId / resource)', () => {
    const server = createRemoteServer();
    saveToken(server.id);
    const token = oauth.getMcpOAuthToken(server.id);
    expect(token).toMatchObject({
      serverId: server.id,
      issuer: 'https://datadefender.cn/xgrag',
      resource: 'https://datadefender.cn/xgrag/mcp',
      tokenEndpoint: 'https://datadefender.cn/xgrag/oauth/token',
      clientId: 'cid',
      refreshToken: 'r1',
      scope: 'kb.read kb.write',
    });
    // public client 没有密钥,读回来该是 undefined 而不是空串
    expect(token?.clientSecret).toBeUndefined();
  });
});
