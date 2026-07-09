import type { ApiProvider } from '@/types'

jest.mock('@/lib/db/connection', () => ({
  getDb: jest.fn(() => ({})),
}))

jest.mock('@/lib/provider-resolver', () => ({
  resolveProviderForCapability: jest.fn(),
}))

jest.mock('@/lib/db/sessions', () => ({
  getSetting: jest.fn(() => ''),
}))

jest.mock('@/lib/claude/provider-env', () => ({
  getProviderEffectiveDefaultModel: jest.fn(() => ''),
}))

jest.mock('@/lib/cloud/provisioner', () => ({
  getRemoteVideoProviderId: jest.fn(() => null),
}))

import { getSetting } from '@/lib/db/sessions'
import { resolveProviderForCapability } from '@/lib/provider-resolver'
import { getProviderEffectiveDefaultModel } from '@/lib/claude/provider-env'
import { getRemoteVideoProviderId } from '@/lib/cloud/provisioner'
import { resolveVideoBillingTarget } from '../video-gen-billing'

const mockResolveProvider = resolveProviderForCapability as jest.MockedFunction<typeof resolveProviderForCapability>
const mockGetSetting = getSetting as jest.MockedFunction<typeof getSetting>
const mockEffectiveDefault = getProviderEffectiveDefaultModel as jest.MockedFunction<typeof getProviderEffectiveDefaultModel>
const mockRemoteId = getRemoteVideoProviderId as jest.MockedFunction<typeof getRemoteVideoProviderId>

function provider(overrides: Partial<ApiProvider> = {}): ApiProvider {
  return {
    id: 'video-provider',
    name: 'Lumos 视频',
    provider_type: 'toapis-video',
    api_protocol: 'openai-compatible',
    capabilities: '["video-gen"]',
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: 'https://toapis.com',
    api_key: 'toapis-key',
    is_active: 0,
    sort_order: 0,
    extra_env: '{}',
    model_catalog: JSON.stringify([
      { value: 'wan2.6-flash', label: 'Wan 2.6 Flash' },
      { value: 'wan2.6', label: 'Wan 2.6' },
    ]),
    model_catalog_source: 'manual',
    model_catalog_updated_at: null,
    notes: '',
    is_builtin: 0,
    user_modified: 0,
    default_model: '',
    created_at: '2026-07-09 00:00:00',
    updated_at: '2026-07-09 00:00:00',
    ...overrides,
  }
}

describe('resolveVideoBillingTarget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockResolveProvider.mockReturnValue(provider())
    mockGetSetting.mockReturnValue('')
    mockEffectiveDefault.mockReturnValue('')
    mockRemoteId.mockReturnValue(null)
  })

  test('errors when no provider is configured', () => {
    mockResolveProvider.mockReturnValue(undefined)
    const target = resolveVideoBillingTarget()
    expect(target).toEqual({ error: expect.stringContaining('provider_override:video') })
  })

  test('uses the agent-requested model when it is in the catalog', () => {
    const target = resolveVideoBillingTarget('wan2.6')
    expect(target).toMatchObject({ model: 'wan2.6' })
  })

  test('rejects an agent-requested model outside the catalog, listing valid ones', () => {
    const target = resolveVideoBillingTarget('sora-9000')
    expect(target).toEqual({ error: expect.stringContaining('wan2.6-flash, wan2.6') })
  })

  test('passes the agent-requested model through when the catalog is empty (BYO provider)', () => {
    mockResolveProvider.mockReturnValue(provider({ model_catalog: '[]' }))
    const target = resolveVideoBillingTarget('wan2.6')
    expect(target).toMatchObject({ model: 'wan2.6' })
  })

  test('falls back model_override:video → effective default → catalog[0], catalog-validated', () => {
    mockGetSetting.mockReturnValue('wan2.6')
    expect(resolveVideoBillingTarget()).toMatchObject({ model: 'wan2.6' })

    // stale override not in catalog → next candidate
    mockGetSetting.mockReturnValue('gone-model')
    mockEffectiveDefault.mockReturnValue('wan2.6')
    expect(resolveVideoBillingTarget()).toMatchObject({ model: 'wan2.6' })

    // nothing valid anywhere → catalog[0]
    mockEffectiveDefault.mockReturnValue('also-gone')
    expect(resolveVideoBillingTarget()).toMatchObject({ model: 'wan2.6-flash' })
  })

  test('reads defaultDuration from provider LUMOS_VIDEO_DEFAULTS, else the model profile default', () => {
    // catalog[0] = wan2.6-flash → 档案默认 5 秒
    expect(resolveVideoBillingTarget()).toMatchObject({ defaultDuration: 5 })
    // gemini_omni_flash 档案默认 6 秒
    expect(resolveVideoBillingTarget('gemini_omni_flash')).toBeInstanceOf(Object)

    mockResolveProvider.mockReturnValue(provider({
      model_catalog: JSON.stringify([{ value: 'gemini_omni_flash', label: 'Gemini Omni Flash' }]),
    }))
    expect(resolveVideoBillingTarget()).toMatchObject({ model: 'gemini_omni_flash', defaultDuration: 6 })

    mockResolveProvider.mockReturnValue(provider({
      extra_env: JSON.stringify({ LUMOS_VIDEO_DEFAULTS: JSON.stringify({ duration: 10 }) }),
    }))
    expect(resolveVideoBillingTarget()).toMatchObject({ defaultDuration: 10 })
  })

  test('exposes the cloud remote provider id for central billing', () => {
    mockRemoteId.mockReturnValue('remote-123')
    expect(resolveVideoBillingTarget()).toMatchObject({ remoteProviderId: 'remote-123' })
  })
})
