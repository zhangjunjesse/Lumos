// 团队出图 HTTP 回调护栏回归:token 生命周期、配额先扣后生成、真实路径记录。
// 这是复杂团队 Stream closed 根治后的唯一护栏点——行为必须钉死。

jest.mock('@/lib/tools/image-gen-tool', () => ({
  runImageGen: jest.fn(),
}));
// teamId 现解析路径的依赖:store 查团队、hint 校验绑定(避免真实 DB)
jest.mock('../store', () => ({ getTeam: jest.fn() }));
jest.mock('@/lib/image/image-provider-hint', () => ({
  sanitizeImageProviderId: (id: string | undefined | null) => (id?.trim() || undefined),
}));

import { runImageGen } from '@/lib/tools/image-gen-tool';
import { getTeam } from '../store';
import { createTeamImageGuard, getTeamImageGuard, releaseTeamImageGuard } from '../image-guard';
import { handleTeamImageCall } from '../image-service';

const mockGen = runImageGen as jest.Mock;
const mockGetTeam = getTeam as jest.Mock;

/** runImageGen 第 4 参现在是绑定 thunk(#65):取出并求值,断言其解析结果 */
function lastBoundProviderId(): string | undefined {
  const binding = mockGen.mock.calls[mockGen.mock.calls.length - 1][3];
  return typeof binding === 'function' ? binding() : binding;
}

function okResult(paths: string[]) {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, images: paths.map((p) => ({ path: p })) }) }] };
}

beforeEach(() => mockGen.mockReset());

describe('team-image-service', () => {
  it('无效 token 直接拒绝,不触发生成', async () => {
    const r = await handleTeamImageCall('no-such-token', { prompt: 'x' });
    expect(r.isError).toBe(true);
    expect(mockGen).not.toHaveBeenCalled();
  });

  it('配额先扣后生成(按 count 计),超额拒绝并回调 quota_denied', async () => {
    const denied: Array<[number, number]> = [];
    const token = createTeamImageGuard({ billingUserId: 'u1', cap: 3, onQuotaDenied: (u, c) => denied.push([u, c]) });
    mockGen.mockResolvedValue(okResult(['/a.png']));

    await handleTeamImageCall(token, { prompt: 'x', count: 2 });
    await handleTeamImageCall(token, { prompt: 'y' });
    const over = await handleTeamImageCall(token, { prompt: 'z' }); // 3+1 > 3

    expect(over.isError).toBe(true);
    expect(mockGen).toHaveBeenCalledTimes(2);
    expect(denied).toEqual([[3, 3]]);
    expect(getTeamImageGuard(token)?.used).toBe(3);
    releaseTeamImageGuard(token);
  });

  it('成功结果里的真实路径进 producedPaths;错误文本不进', async () => {
    const token = createTeamImageGuard({ billingUserId: 'u1', cap: 10 });
    mockGen
      .mockResolvedValueOnce(okResult(['/a.png', '/b.png']))
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '生成失败:服务商 500' }], isError: true });

    await handleTeamImageCall(token, { prompt: 'x', count: 2 });
    await handleTeamImageCall(token, { prompt: 'y' });

    const guard = getTeamImageGuard(token);
    expect([...(guard?.producedPaths ?? [])].sort()).toEqual(['/a.png', '/b.png']);
    // 计费 userId 用 guard 里的云账户 id;没配团队图片服务商时绑定解析为 undefined(走全局默认)
    expect(mockGen).toHaveBeenCalledWith(expect.anything(), undefined, 'u1', expect.any(Function));
    expect(lastBoundProviderId()).toBeUndefined();
    releaseTeamImageGuard(token);
  });

  it('团队级图片服务商:guard 带 imageProviderId(无 teamId 的旧快照)→ 绑定解析为该值(T3.2)', async () => {
    const token = createTeamImageGuard({ billingUserId: 'u1', cap: 10, imageProviderId: 'p-mj' });
    mockGen.mockResolvedValue(okResult(['/a.png']));
    await handleTeamImageCall(token, { prompt: 'x' });
    expect(lastBoundProviderId()).toBe('p-mj');
    releaseTeamImageGuard(token);
  });

  it('guard 带 teamId → 每次出图现解析团队默认,轮次中途切换即时生效(#65)', async () => {
    const token = createTeamImageGuard({ billingUserId: 'u1', cap: 10, imageProviderId: 'p-snapshot', teamId: 't1' });
    mockGen.mockResolvedValue(okResult(['/a.png']));

    mockGetTeam.mockReturnValue({ id: 't1', defaultImageProviderId: 'p-old' });
    await handleTeamImageCall(token, { prompt: 'x' });
    expect(lastBoundProviderId()).toBe('p-old');

    mockGetTeam.mockReturnValue({ id: 't1', defaultImageProviderId: 'p-new' }); // 用户在界面切换了团队服务商
    await handleTeamImageCall(token, { prompt: 'y' });
    expect(lastBoundProviderId()).toBe('p-new');

    mockGetTeam.mockReturnValue(undefined); // 团队记录被删的极端情况:退回创建时快照
    await handleTeamImageCall(token, { prompt: 'z' });
    expect(lastBoundProviderId()).toBe('p-snapshot');
    releaseTeamImageGuard(token);
  });

  it('release 后 token 失效(会话结束不能再花钱)', async () => {
    const token = createTeamImageGuard({ billingUserId: 'u1', cap: 10 });
    releaseTeamImageGuard(token);
    const r = await handleTeamImageCall(token, { prompt: 'x' });
    expect(r.isError).toBe(true);
    expect(mockGen).not.toHaveBeenCalled();
  });
});
