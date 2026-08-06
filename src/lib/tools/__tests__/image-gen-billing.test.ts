// T0.1 回归:resolveBillingTarget 必须把 providerId 作为 preferredProviderId 透传到解析层,
// 否则"扣费的服务商"和"出图的服务商"会错位。指定/不指定两条路各测一遍。

jest.mock('@/lib/db/connection', () => ({ getDb: jest.fn(() => ({})) }));
jest.mock('@/lib/db/sessions', () => ({ getSetting: jest.fn(() => '') }));
jest.mock('@/lib/cloud/provisioner', () => ({ getRemoteImageProviderId: jest.fn(() => 'remote-1') }));
jest.mock('@/lib/claude/provider-env', () => ({ getProviderEffectiveDefaultModel: jest.fn(() => 'mj-fast') }));
jest.mock('../media-quota-client', () => ({ postQuotaConsume: jest.fn(), postQuotaRefund: jest.fn() }));

const resolveMock = jest.fn();
jest.mock('@/lib/provider-resolver', () => ({
  resolveProviderForCapability: (...args: unknown[]) => resolveMock(...args),
}));

import { resolveBillingTarget } from '../image-gen-billing';

const fakeProvider = {
  id: 'p-mj', name: 'Midjourney', provider_type: 'midjourney',
  model_catalog: JSON.stringify([{ value: 'mj-fast' }]),
};

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockReturnValue(fakeProvider);
});

describe('resolveBillingTarget providerId 透传 (T0.1)', () => {
  it('传了 providerId → 作为 preferredProviderId 传进解析层', () => {
    const target = resolveBillingTarget('p-douyin');
    expect('error' in target).toBe(false);
    expect(resolveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleKey: 'image', capability: 'image-gen', allowDefault: false,
        preferredProviderId: 'p-douyin',
      }),
    );
  });

  it('没传 providerId → preferredProviderId 为 undefined(走全局默认,旧行为)', () => {
    resolveBillingTarget();
    expect(resolveMock).toHaveBeenCalledWith(
      expect.objectContaining({ preferredProviderId: undefined }),
    );
  });

  it('解析层抛错时,错误信息按"指定/全局"区分来源', () => {
    resolveMock.mockImplementation(() => { throw new Error('该服务商不支持 image-gen'); });
    const withId = resolveBillingTarget('p-x') as { error: string };
    const noId = resolveBillingTarget() as { error: string };
    expect(withId.error).toContain('指定服务商 p-x');
    expect(noId.error).toContain('provider_override:image');
  });
});
