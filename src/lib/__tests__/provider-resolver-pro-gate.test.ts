/**
 * Pro-edition lockdown tests for provider-resolver.
 * Covers per-capability gating via canUseCustomProvider(cap).
 */

jest.mock('@/lib/edition', () => ({ isPro: jest.fn() }));
jest.mock('@/lib/edition-runtime', () => ({ canUseCustomProvider: jest.fn() }));
jest.mock('@/lib/db/connection', () => ({ getDb: jest.fn() }));
jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: jest.fn(),
  getProvider: jest.fn(),
}));
jest.mock('@/lib/db/sessions', () => ({ getSetting: jest.fn() }));
jest.mock('@/lib/provider-config', () => ({ providerSupportsCapability: jest.fn() }));

import { isPro } from '@/lib/edition';
import { canUseCustomProvider } from '@/lib/edition-runtime';
import { getDb } from '@/lib/db/connection';
import { getDefaultProvider, getProvider } from '@/lib/db/providers';
import { getSetting } from '@/lib/db/sessions';
import { providerSupportsCapability } from '@/lib/provider-config';
import { ProviderResolutionError, resolveProviderForCapability } from '@/lib/provider-resolver';
import type { CustomProviderCapability } from '@/lib/auth/custom-provider-capabilities';
import type { ApiProvider } from '@/types';

const mIsPro = isPro as jest.MockedFunction<typeof isPro>;
const mCanUse = canUseCustomProvider as jest.MockedFunction<typeof canUseCustomProvider>;
const mGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mGetDefault = getDefaultProvider as jest.MockedFunction<typeof getDefaultProvider>;
const mGetProvider = getProvider as jest.MockedFunction<typeof getProvider>;
const mGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;
const mSupports = providerSupportsCapability as jest.MockedFunction<typeof providerSupportsCapability>;

const cloudProvider: ApiProvider = {
  id: 'cloud-id',
  name: 'Lumos Cloud',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const customProvider: ApiProvider = {
  id: 'user-id',
  name: 'User Custom',
  provider_origin: 'custom',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const systemProviderA: ApiProvider = {
  id: 'system-a',
  name: 'LumosProToAPI',
  provider_origin: 'system',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function stubCloudLookup(found: boolean): void {
  const row = found ? { id: cloudProvider.id } : undefined;
  mGetDb.mockReturnValue({
    prepare: () => ({ get: () => row }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  mGetProvider.mockImplementation(id => (id === cloudProvider.id ? cloudProvider : undefined));
  mSupports.mockReturnValue(true);
}

function setFlags(flags: Partial<Record<CustomProviderCapability, boolean>>): void {
  mCanUse.mockImplementation((cap: CustomProviderCapability) => flags[cap] === true);
}

describe('resolveProviderForCapability — pro-gate (per-capability)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mGetSetting.mockReturnValue('');
    mGetDefault.mockReturnValue(undefined);
  });

  test('chat locked + custom preferred → falls back to Lumos Cloud', () => {
    mIsPro.mockReturnValue(true);
    setFlags({ chat: false, media: true });
    // Custom-origin preferred must not be honored in locked mode.
    mGetDb.mockReturnValue({
      prepare: () => ({ get: () => ({ id: cloudProvider.id }) }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    mGetProvider.mockImplementation(id => {
      if (id === cloudProvider.id) return cloudProvider;
      if (id === customProvider.id) return customProvider;
      return undefined;
    });
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: 'agent-chat',
      preferredProviderId: customProvider.id,
    });

    expect(result).toBe(cloudProvider);
  });

  test('chat locked + system-origin preferred → honors the pick', () => {
    // Admin curates multiple system-origin chat providers (e.g. LumosProToAPI,
    // LumosProToFox); user should be able to switch between them in the UI
    // even under chat-locked mode. Only custom-origin providers are gated.
    mIsPro.mockReturnValue(true);
    setFlags({ chat: false, media: true });
    mGetProvider.mockImplementation(id =>
      id === systemProviderA.id ? systemProviderA : undefined,
    );
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: 'agent-chat',
      preferredProviderId: systemProviderA.id,
    });

    expect(result).toBe(systemProviderA);
  });

  test('chat locked + no Lumos Cloud in DB → throws', () => {
    mIsPro.mockReturnValue(true);
    setFlags({ chat: false, media: true });
    stubCloudLookup(false);

    expect(() =>
      resolveProviderForCapability({ moduleKey: 'chat', capability: 'agent-chat' }),
    ).toThrow(ProviderResolutionError);
  });

  test('media locked + system-origin preferred → honors the pick (#64:锁定≠无视托管服务商选择)', () => {
    // pro 登录态下,云端下发的 MidjourneyJ(system origin)被显式指定时必须被尊重。
    // 旧行为把 preferred 一律剥掉 → 静默换成 provider_override:image 的默认服务商。
    mIsPro.mockReturnValue(true);
    setFlags({ chat: true, media: false });
    mGetSetting.mockImplementation(key => (key === 'provider_override:image' ? customProvider.id : ''));
    mGetProvider.mockImplementation(id => {
      if (id === systemProviderA.id) return systemProviderA;
      if (id === customProvider.id) return customProvider;
      return undefined;
    });
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'image',
      capability: 'image-gen',
      preferredProviderId: systemProviderA.id,
    });

    expect(result).toBe(systemProviderA);
  });

  test('media locked + custom/未知 preferred → 拦回 provider_override:image(只锁自建)', () => {
    mIsPro.mockReturnValue(true);
    setFlags({ chat: true, media: false });
    // Admin-managed override points at the custom provider.
    mGetSetting.mockImplementation(key => (key === 'provider_override:image' ? customProvider.id : ''));
    mGetProvider.mockImplementation(id => (id === customProvider.id ? customProvider : undefined));
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'image',
      capability: 'image-gen',
      preferredProviderId: 'some-user-pick', // 非 system origin,锁定下不被采用
    });

    expect(result).toBe(customProvider);
  });

  test('media locked + video-gen 非托管 preferred → 拦回 provider_override:video(只锁自建)', () => {
    mIsPro.mockReturnValue(true);
    setFlags({ chat: true, media: false });
    mGetSetting.mockImplementation(key => (key === 'provider_override:video' ? customProvider.id : ''));
    mGetProvider.mockImplementation(id => (id === customProvider.id ? customProvider : undefined));
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'video',
      capability: 'video-gen',
      preferredProviderId: 'some-user-pick',
    });

    expect(result).toBe(customProvider);
  });

  test('chat unlocked → honors preferredProviderId', () => {
    mIsPro.mockReturnValue(true);
    setFlags({ chat: true, media: true });
    mGetProvider.mockImplementation(id => (id === customProvider.id ? customProvider : undefined));
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: 'agent-chat',
      preferredProviderId: customProvider.id,
    });

    expect(result).toBe(customProvider);
  });

  test('open edition (not pro) → gate never applies regardless of flags', () => {
    mIsPro.mockReturnValue(false);
    setFlags({ chat: false, media: false });
    mGetProvider.mockImplementation(id => (id === customProvider.id ? customProvider : undefined));
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: 'agent-chat',
      preferredProviderId: customProvider.id,
    });

    expect(result).toBe(customProvider);
  });
});
