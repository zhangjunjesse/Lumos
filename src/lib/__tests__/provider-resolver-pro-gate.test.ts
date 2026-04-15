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

  test('chat locked → ignores preferredProviderId, forces Lumos Cloud', () => {
    mIsPro.mockReturnValue(true);
    setFlags({ chat: false, media: true });
    stubCloudLookup(true);

    const result = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: 'agent-chat',
      preferredProviderId: 'user-id',
    });

    expect(result).toBe(cloudProvider);
    expect(mGetProvider).not.toHaveBeenCalledWith('user-id');
  });

  test('chat locked + no Lumos Cloud in DB → throws', () => {
    mIsPro.mockReturnValue(true);
    setFlags({ chat: false, media: true });
    stubCloudLookup(false);

    expect(() =>
      resolveProviderForCapability({ moduleKey: 'chat', capability: 'agent-chat' }),
    ).toThrow(ProviderResolutionError);
  });

  test('media locked + image-gen → strips preferredProviderId, falls through to provider_override:image', () => {
    mIsPro.mockReturnValue(true);
    setFlags({ chat: true, media: false });
    // Admin-managed override points at the custom provider.
    mGetSetting.mockImplementation(key => (key === 'provider_override:image' ? customProvider.id : ''));
    mGetProvider.mockImplementation(id => (id === customProvider.id ? customProvider : undefined));
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'image',
      capability: 'image-gen',
      preferredProviderId: 'some-user-pick', // must be ignored
    });

    expect(result).toBe(customProvider);
    expect(mGetProvider).not.toHaveBeenCalledWith('some-user-pick');
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
