import fs from 'fs'
import path from 'path'
import { buildClaudeSdkRuntimeBootstrap } from '../sdk-runtime'

const mockGetActiveProvider = jest.fn()
const mockGetSetting = jest.fn()
const mockFindClaudeBinary = jest.fn()
const mockFindGitBash = jest.fn()
const mockGetExpandedPath = jest.fn()
const existsSyncSpy = jest.spyOn(fs, 'existsSync')

jest.mock('@/lib/db/providers', () => ({
  getActiveProvider: () => mockGetActiveProvider(),
}))

jest.mock('@/lib/db/sessions', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}))

jest.mock('@/lib/platform', () => ({
  findClaudeBinary: () => mockFindClaudeBinary(),
  findGitBash: () => mockFindGitBash(),
  getExpandedPath: () => mockGetExpandedPath(),
}))

describe('buildClaudeSdkRuntimeBootstrap', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      LUMOS_CLAUDE_CONFIG_DIR: '/tmp/lumos-claude',
      ANTHROPIC_API_KEY: 'stale-key',
      CLAUDE_CONFIG_DIR: '/tmp/stale-config',
    }

    mockGetActiveProvider.mockReset()
    mockGetSetting.mockReset()
    mockFindClaudeBinary.mockReset()
    mockFindGitBash.mockReset()
    mockGetExpandedPath.mockReset()

    mockGetExpandedPath.mockReturnValue('/tmp/expanded-path')
    mockFindGitBash.mockReturnValue(null)
    existsSyncSpy.mockImplementation((value: fs.PathLike) => {
      const target = String(value)
      return target === path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js')
    })
  })

  afterEach(() => {
    process.env = originalEnv
    existsSyncSpy.mockReset()
  })

  afterAll(() => {
    existsSyncSpy.mockRestore()
  })

  test('injects active provider env and bundled cli path', () => {
    mockGetActiveProvider.mockReturnValue({
      id: 'provider-1',
      name: 'Test Provider',
      provider_type: 'anthropic',
      base_url: 'https://example.com/claude',
      api_key: 'provider-secret',
      is_active: 1,
      sort_order: 0,
      extra_env: JSON.stringify({
        ANTHROPIC_API_KEY: '',
        CUSTOM_FLAG: 'enabled',
      }),
      model_catalog: '[]',
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 0,
      user_modified: 0,
      created_at: '2026-03-15 00:00:00',
      updated_at: '2026-03-15 00:00:00',
    })
    mockGetSetting.mockImplementation((key: string) => (
      key === 'claude_project_settings_enabled' ? 'true' : ''
    ))

    const runtime = buildClaudeSdkRuntimeBootstrap()

    expect(runtime.activeProvider?.id).toBe('provider-1')
    expect(runtime.env.PATH).toBe('/tmp/expanded-path')
    expect(runtime.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(runtime.env.CLAUDE_CONFIG_DIR).toBe('/tmp/lumos-claude')
    expect(runtime.env.ANTHROPIC_AUTH_TOKEN).toBe('provider-secret')
    expect(runtime.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(runtime.env.ANTHROPIC_BASE_URL).toBe('https://example.com/claude')
    expect(runtime.env.CUSTOM_FLAG).toBe('enabled')
    expect(runtime.settingSources).toEqual(['project'])
    expect(runtime.pathToClaudeCodeExecutable).toBe(
      path.join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
    )
  })

  test('falls back to app settings and system claude binary when no active provider exists', () => {
    mockGetActiveProvider.mockReturnValue(undefined)
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'anthropic_auth_token') return 'legacy-token'
      if (key === 'anthropic_base_url') return 'https://legacy.example.com'
      if (key === 'claude_project_settings_enabled') return 'false'
      return ''
    })
    mockFindClaudeBinary.mockReturnValue('/usr/local/bin/claude')
    existsSyncSpy.mockReturnValue(false)

    const runtime = buildClaudeSdkRuntimeBootstrap()

    expect(runtime.activeProvider).toBeUndefined()
    expect(runtime.env.ANTHROPIC_AUTH_TOKEN).toBe('legacy-token')
    expect(runtime.env.ANTHROPIC_BASE_URL).toBe('https://legacy.example.com')
    expect(runtime.settingSources).toEqual([])
    expect(runtime.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude')
  })
})
