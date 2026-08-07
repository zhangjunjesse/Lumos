// 令牌续期与状态判定。核心是两条:临近过期要提前刷;续期凭证作废(invalid_grant)
// 要把本地令牌清掉,否则 UI 一直显示"已授权"而实际每次调用都 401。

const mockGetAll = jest.fn();
const mockGetOne = jest.fn();
const mockSave = jest.fn();
const mockDelete = jest.fn();
const mockRefresh = jest.fn();

jest.mock('@/lib/db/mcp-oauth', () => ({
  getAllMcpOAuthTokens: () => mockGetAll(),
  getMcpOAuthToken: (id: string) => mockGetOne(id),
  saveMcpOAuthToken: (t: unknown) => mockSave(t),
  deleteMcpOAuthToken: (id: string) => mockDelete(id),
}));

jest.mock('../client', () => ({
  refreshAccessToken: (args: unknown) => mockRefresh(args),
}));

import { ensureFreshMcpOAuthTokens, getMcpAuthStatus } from '../token-manager';
import type { McpOAuthToken } from '../types';

const HOUR = 3600_000;

function token(overrides: Partial<McpOAuthToken> = {}): McpOAuthToken {
  return {
    serverId: 'srv1',
    issuer: 'https://datadefender.cn/xgrag',
    resource: 'https://datadefender.cn/xgrag/mcp',
    tokenEndpoint: 'https://datadefender.cn/xgrag/oauth/token',
    clientId: 'cid',
    accessToken: 'old-access',
    refreshToken: 'r1',
    expiresAt: Date.now() + HOUR,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAll.mockReturnValue(new Map());
});

describe('ensureFreshMcpOAuthTokens', () => {
  it('还早的不动 —— 每次对话都刷一遍纯属浪费', async () => {
    mockGetAll.mockReturnValue(new Map([['srv1', token()]]));
    await ensureFreshMcpOAuthTokens();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('5 分钟内就要过期的提前刷,新令牌落库', async () => {
    mockGetAll.mockReturnValue(new Map([['srv1', token({ expiresAt: Date.now() + 60_000 })]]));
    mockRefresh.mockResolvedValue({ access_token: 'new-access', expires_in: 3600 });
    await ensureFreshMcpOAuthTokens();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'new-access' }));
  });

  it('服务器没轮换 refresh_token 时沿用旧的,别把续期能力弄丢', async () => {
    mockGetAll.mockReturnValue(new Map([['srv1', token({ expiresAt: Date.now() - 1 })]]));
    mockRefresh.mockResolvedValue({ access_token: 'a2', expires_in: 3600 });
    await ensureFreshMcpOAuthTokens();
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'r1' }));
  });

  it('没有过期时间的当长期有效,不刷', async () => {
    mockGetAll.mockReturnValue(new Map([['srv1', token({ expiresAt: undefined })]]));
    await ensureFreshMcpOAuthTokens();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('invalid_grant = 续期凭证废了,清掉本地令牌让用户重新授权', async () => {
    mockGetAll.mockReturnValue(new Map([['srv1', token({ expiresAt: Date.now() - 1 })]]));
    mockRefresh.mockRejectedValue(new Error('刷新访问令牌失败:invalid_grant'));
    await ensureFreshMcpOAuthTokens();
    expect(mockDelete).toHaveBeenCalledWith('srv1');
  });

  it('网络抖动/5xx 不删令牌 —— 下次再试即可,删了得让用户白跑一趟授权', async () => {
    mockGetAll.mockReturnValue(new Map([['srv1', token({ expiresAt: Date.now() - 1 })]]));
    mockRefresh.mockRejectedValue(new Error('fetch failed'));
    await ensureFreshMcpOAuthTokens();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('已过期又没有续期凭证 → 直接清掉,别拿废令牌去连', async () => {
    mockGetAll.mockReturnValue(
      new Map([['srv1', token({ expiresAt: Date.now() - 1, refreshToken: undefined })]]),
    );
    await ensureFreshMcpOAuthTokens();
    expect(mockDelete).toHaveBeenCalledWith('srv1');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('一台失败不拖累另一台 —— 一个知识库连不上不该毁掉整场对话', async () => {
    mockGetAll.mockReturnValue(
      new Map([
        ['srv1', token({ serverId: 'srv1', expiresAt: Date.now() - 1 })],
        ['srv2', token({ serverId: 'srv2', expiresAt: Date.now() - 1 })],
      ]),
    );
    mockRefresh
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ access_token: 'ok', expires_in: 3600 });
    await expect(ensureFreshMcpOAuthTokens()).resolves.toBeUndefined();
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'ok' }));
  });

  it('表还没建(老库首次启动)时静默跳过,不能炸掉对话启动', async () => {
    mockGetAll.mockImplementation(() => {
      throw new Error('no such table: mcp_oauth_tokens');
    });
    await expect(ensureFreshMcpOAuthTokens()).resolves.toBeUndefined();
  });
});

describe('getMcpAuthStatus', () => {
  it('stdio 服务器无所谓授权', () => {
    expect(getMcpAuthStatus('srv1', false)).toEqual({ state: 'not-required' });
  });

  it('没令牌 = 待授权', () => {
    mockGetOne.mockReturnValue(undefined);
    expect(getMcpAuthStatus('srv1', true)).toEqual({ state: 'needs-auth' });
  });

  it('有令牌 = 已授权', () => {
    mockGetOne.mockReturnValue(token());
    expect(getMcpAuthStatus('srv1', true).state).toBe('authorized');
  });

  it('过期但有续期凭证 → 仍算已授权(下次会话启动前会自动续上)', () => {
    mockGetOne.mockReturnValue(token({ expiresAt: Date.now() - 1 }));
    expect(getMcpAuthStatus('srv1', true).state).toBe('authorized');
  });

  it('过期且无续期凭证 → 明确告诉用户要重新授权', () => {
    mockGetOne.mockReturnValue(token({ expiresAt: Date.now() - 1, refreshToken: undefined }));
    expect(getMcpAuthStatus('srv1', true).state).toBe('expired');
  });
});
