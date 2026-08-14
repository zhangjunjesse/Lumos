// issue #64 回归:generate_image 的 image_provider 逃生舱。
//  - 显式指定的服务商匹配不到 → 硬报错 + 可用清单,绝不静默回落默认服务商冒充成功
//  - 匹配到 → 用它出图,成功回执带 requested_provider(与实际 provider 并列,可对账)

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ tool: jest.fn() }));

const generateImagesMock = jest.fn();
jest.mock('@/lib/image', () => ({ generateImages: (...a: unknown[]) => generateImagesMock(...a) }));

const resolveExplicitMock = jest.fn();
jest.mock('@/lib/image/image-provider-hint', () => ({
  resolveExplicitImageProvider: (...a: unknown[]) => resolveExplicitMock(...a),
}));

const resolveBillingMock = jest.fn();
jest.mock('../image-gen-billing', () => ({
  resolveBillingTarget: (...a: unknown[]) => resolveBillingMock(...a),
  consumeRemoteQuota: jest.fn(),
  refundRemoteQuota: jest.fn(),
}));

import { runImageGen } from '../image-gen-tool';

function parsePayload(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = result.content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text);
}

beforeEach(() => {
  jest.clearAllMocks();
  resolveBillingMock.mockReturnValue({
    provider: { id: 'p-mj', name: 'MidjourneyJ' },
    model: 'mj-fast',
    remoteProviderId: null,
    billingUnit: 'task',
  });
  generateImagesMock.mockResolvedValue({
    mediaGenerationId: 'mg-1',
    model: 'mj-fast',
    providerName: 'MidjourneyJ',
    images: [{ localPath: '/tmp/a.png', mimeType: 'image/png' }],
    elapsedMs: 1000,
    billingUnit: 'task',
  });
});

describe('generate_image 显式指定服务商 (#64)', () => {
  it('匹配不到 → 硬报错,带 requested/available,且不触发出图与计费', async () => {
    resolveExplicitMock.mockReturnValue({
      kind: 'not_found',
      requested: 'Midjourney',
      available: [{ name: 'MidjourneyJ', type: 'midjourney' }],
      didYouMean: 'MidjourneyJ',
    });

    const payload = parsePayload(await runImageGen({ prompt: 'a cat' , image_provider: 'Midjourney' }, undefined, undefined));

    expect(payload.success).toBe(false);
    expect(payload.error_source).toBe('image_provider_not_found');
    expect(payload.requested_provider).toBe('Midjourney');
    expect(payload.available_providers).toEqual([{ name: 'MidjourneyJ', type: 'midjourney' }]);
    expect(String(payload.error)).toContain('MidjourneyJ');
    expect(generateImagesMock).not.toHaveBeenCalled();
    expect(resolveBillingMock).not.toHaveBeenCalled();
  });

  it('匹配到 → 用它出图,回执带 requested_provider + 实际 provider + source=explicit', async () => {
    resolveExplicitMock.mockReturnValue({ kind: 'ok', providerId: 'p-mj', providerName: 'MidjourneyJ' });

    const payload = parsePayload(await runImageGen({ prompt: 'a cat', image_provider: 'MidjourneyJ' }, undefined, undefined));

    expect(payload.success).toBe(true);
    expect(payload.provider).toBe('MidjourneyJ');
    expect(payload.requested_provider).toBe('MidjourneyJ');
    expect(payload.provider_source).toBe('explicit');
    expect(resolveBillingMock).toHaveBeenCalledWith('p-mj');
  });

  it('未指定 → 走就近链绑定,回执 source=caller_binding 且不带 requested_provider', async () => {
    resolveExplicitMock.mockReturnValue({ kind: 'none' });

    const payload = parsePayload(await runImageGen({ prompt: 'a cat' }, undefined, undefined, 'p-session'));

    expect(payload.success).toBe(true);
    expect(payload.requested_provider).toBeUndefined();
    expect(payload.provider_source).toBe('caller_binding');
    expect(resolveBillingMock).toHaveBeenCalledWith('p-session');
  });

  it('绑定是函数时每次调用现解析 → 中途切换服务商即时生效 (#65)', async () => {
    resolveExplicitMock.mockReturnValue({ kind: 'none' });
    let current = 'p-before';
    const binding = () => current;

    await runImageGen({ prompt: 'a cat' }, undefined, undefined, binding);
    expect(resolveBillingMock).toHaveBeenLastCalledWith('p-before');

    current = 'p-after'; // 模拟用户在界面切换了服务商
    await runImageGen({ prompt: 'a cat' }, undefined, undefined, binding);
    expect(resolveBillingMock).toHaveBeenLastCalledWith('p-after');
  });

  it('无任何绑定 → 回执 source=global_default', async () => {
    resolveExplicitMock.mockReturnValue({ kind: 'none' });

    const payload = parsePayload(await runImageGen({ prompt: 'a cat' }, undefined, undefined));

    expect(payload.success).toBe(true);
    expect(payload.provider_source).toBe('global_default');
    expect(resolveBillingMock).toHaveBeenCalledWith(undefined);
  });
});
