// 团队出图 HTTP 回调护栏回归:token 生命周期、配额先扣后生成、真实路径记录。
// 这是复杂团队 Stream closed 根治后的唯一护栏点——行为必须钉死。

jest.mock('@/lib/tools/image-gen-tool', () => ({
  runImageGen: jest.fn(),
}));

import { runImageGen } from '@/lib/tools/image-gen-tool';
import { createTeamImageGuard, getTeamImageGuard, releaseTeamImageGuard } from '../image-guard';
import { handleTeamImageCall } from '../image-service';

const mockGen = runImageGen as jest.Mock;

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
    // 计费 userId 用的是 guard 里的云账户 id
    expect(mockGen).toHaveBeenCalledWith(expect.anything(), undefined, 'u1');
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
