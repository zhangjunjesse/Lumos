/**
 * Pro-edition lockdown tests for provider-resolver.
 * Covers the branch: isPro() && !canUseCustomProviders() → force Lumos Cloud.
 */

jest.mock('@/lib/edition', () => ({ isPro: jest.fn() }));
jest.mock('@/lib/edition-runtime', () => ({ canUseCustomProviders: jest.fn() }));
jest.mock('@/lib/db/connection', () => ({ getDb: jest.fn() }));
jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: jest.fn(),
  getProvider: jest.fn(),
}));
jest.mock('@/lib/db/sessions', () => ({ getSetting: jest.fn() }));
jest.mock('@/lib/provider-config', () => ({ providerSupportsCapability: jest.fn() }));

import { isPro } from '@/lib/edition';
import { canUseCustomProviders } from '@/lib/edition-runtime';
import { getDb } from '@/lib/db/connection';
import { getDefaultProvider, getProvider } from '@/lib/db/providers';
import { getSetting } from '@/lib/db/sessions';
import { providerSupportsCapability } from '@/lib/provider-config';
import { ProviderResolutionError, resolveProviderForCapability } from '@/lib/provider-resolver';
import type { ApiProvider } from '@/types';

const mIsPro = isPro as jest.MockedFunction<typeof isPro>;
const mAllow = canUseCustomProviders as jest.MockedFunction<typeof canUseCustomProviders>;
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

describe('resolveProviderForCapability — pro-gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mGetSetting.mockReturnValue('');
    mGetDefault.mockReturnValue(undefined);
  });

  test('pro + !allow + agent-chat → ignores preferredProviderId, forces Lumos Cloud', () => {
    mIsPro.mockReturnValue(true);
    mAllow.mockReturnValue(false);
    stubCloudLookup(true);

    const result = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: 'agent-chat',
      preferredProviderId: 'user-id', // user's custom provider — must be ignored
    });

    expect(result).toBe(cloudProvider);
    expect(mGetProvider).not.toHaveBeenCalledWith('user-id');
  });

  test('pro + !allow + no Lumos Cloud in DB → throws', () => {
    mIsPro.mockReturnValue(true);
    mAllow.mockReturnValue(false);
    stubCloudLookup(false);

    expect(() =>
      resolveProviderForCapability({
        moduleKey: 'chat',
        capability: 'agent-chat',
      }),
    ).toThrow(ProviderResolutionError);
  });

  test('pro + !allow + image-gen → bypasses gate (image uses provider_override:image path)', () => {
    mIsPro.mockReturnValue(true);
    mAllow.mockReturnValue(false);
    // Pretend user configured provider_override:image pointing at the custom provider.
    mGetSetting.mockImplementation(key => (key === 'provider_override:image' ? customProvider.id : ''));
    mGetProvider.mockImplementation(id => (id === customProvider.id ? customProvider : undefined));
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'image',
      capability: 'image-gen',
    });

    expect(result).toBe(customProvider);
  });

  test('pro + allow → normal resolution honors preferredProviderId', () => {
    mIsPro.mockReturnValue(true);
    mAllow.mockReturnValue(true);
    mGetProvider.mockImplementation(id => (id === customProvider.id ? customProvider : undefined));
    mSupports.mockReturnValue(true);

    const result = resolveProviderForCapability({
      moduleKey: 'chat',
      capability: 'agent-chat',
      preferredProviderId: customProvider.id,
    });

    expect(result).toBe(customProvider);
  });

  test('open edition (not pro) → gate never applies', () => {
    mIsPro.mockReturnValue(false);
    mAllow.mockReturnValue(false); // even if allow=false, open edition ignores the gate
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
