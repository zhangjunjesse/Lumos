import fs from 'fs'
import path from 'path'
import { buildClaudeSdkRuntimeBootstrap } from '../sdk-runtime'

const mockGetDefaultProvider = jest.fn()
const mockGetProvider = jest.fn()
const mockGetSetting = jest.fn()
const mockGetSession = jest.fn()
const mockFindClaudeBinary = jest.fn()
const mockFindGitBash = jest.fn()
const mockGetClaudeConfigDir = jest.fn()
const mockGetExpandedPath = jest.fn()
const existsSyncSpy = jest.spyOn(fs, 'existsSync')

jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: () => mockGetDefaultProvider(),
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}))

jest.mock('@/lib/db/sessions', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
}))

jest.mock('@/lib/platform', () => ({
  findClaudeBinary: () => mockFindClaudeBinary(),
  findGitBash: () => mockFindGitBash(),
  getClaudeConfigDir: () => mockGetClaudeConfigDir(),
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

    mockGetDefaultProvider.mockReset()
    mockGetProvider.mockReset()
    mockGetSetting.mockReset()
    mockGetSession.mockReset()
    mockFindClaudeBinary.mockReset()
    mockFindGitBash.mockReset()
    mockGetClaudeConfigDir.mockReset()
    mockGetExpandedPath.mockReset()

    mockGetClaudeConfigDir.mockReturnValue('/tmp/lumos-claude')
    mockGetExpandedPath.mockReturnValue('/tmp/expanded-path')
    mockFindGitBash.mockReturnValue(null)
    mockGetSession.mockReturnValue(undefined)
    mockGetProvider.mockReturnValue(undefined)
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
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-1',
      name: 'Test Provider',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
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

  test('uses system claude binary but does not silently restore shell auth env when no provider exists', () => {
    mockGetDefaultProvider.mockReturnValue(undefined)
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'claude_project_settings_enabled') return 'false'
      return ''
    })
    mockFindClaudeBinary.mockReturnValue('/usr/local/bin/claude')
    existsSyncSpy.mockReturnValue(false)

    const runtime = buildClaudeSdkRuntimeBootstrap()

    expect(runtime.activeProvider).toBeUndefined()
    expect(runtime.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(runtime.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(runtime.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(runtime.settingSources).toEqual([])
    expect(runtime.pathToClaudeCodeExecutable).toBe('/usr/local/bin/claude')
  })

  test('local_auth provider keeps sandbox auth isolated and does not inject stale key env', () => {
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-local-auth',
      name: 'Claude Local Auth',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'custom',
      auth_mode: 'local_auth',
      base_url: 'https://should-not-be-used.example.com',
      api_key: '',
      is_active: 1,
      sort_order: 0,
      extra_env: JSON.stringify({
        CUSTOM_FLAG: 'local-auth',
        ANTHROPIC_API_KEY: 'should-be-ignored',
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

    const runtime = buildClaudeSdkRuntimeBootstrap()

    expect(runtime.activeProvider?.id).toBe('provider-local-auth')
    expect(runtime.env.CLAUDE_CONFIG_DIR).toBe('/tmp/lumos-claude')
    expect(runtime.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(runtime.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(runtime.env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(runtime.env.CUSTOM_FLAG).toBe('local-auth')
  })

  test('prefers the session provider before the default or active provider when sessionId is provided', () => {
    mockGetSession.mockReturnValue({
      id: 'session-001',
      provider_id: 'provider-session-001',
    })
    mockGetProvider.mockImplementation((id: string) => {
      if (id !== 'provider-session-001') {
        return undefined
      }
      return {
        id: 'provider-session-001',
        name: 'Session Provider',
        provider_type: 'anthropic',
        api_protocol: 'anthropic-messages',
        capabilities: '["agent-chat"]',
        provider_origin: 'custom',
        auth_mode: 'api_key',
        base_url: 'https://session-provider.example.com/claude',
        api_key: 'session-provider-secret',
        is_active: 0,
        sort_order: 0,
        extra_env: '{}',
        model_catalog: '[]',
        model_catalog_source: 'default',
        model_catalog_updated_at: null,
        notes: '',
        is_builtin: 0,
        user_modified: 0,
        created_at: '2026-03-15 00:00:00',
        updated_at: '2026-03-15 00:00:00',
      }
    })
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-active',
      name: 'Default Provider',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
      api_key: 'active-secret',
      base_url: 'https://active-provider.example.com/claude',
      is_active: 1,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: '[]',
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 0,
      user_modified: 0,
      created_at: '2026-03-15 00:00:00',
      updated_at: '2026-03-15 00:00:00',
    })

    const runtime = buildClaudeSdkRuntimeBootstrap({
      sessionId: 'session-001',
    })

    expect(runtime.activeProvider?.id).toBe('provider-session-001')
    expect(runtime.env.ANTHROPIC_AUTH_TOKEN).toBe('session-provider-secret')
    expect(runtime.env.ANTHROPIC_BASE_URL).toBe('https://session-provider.example.com/claude')
  })

  test('throws when a session is still bound to a deleted provider', () => {
    mockGetSession.mockReturnValue({
      id: 'session-002',
      provider_id: 'provider-deleted',
    })
    mockGetProvider.mockReturnValue(undefined)
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-default',
      name: 'Default Provider',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'custom',
      auth_mode: 'api_key',
      api_key: 'default-secret',
      base_url: 'https://default-provider.example.com/claude',
      is_active: 1,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: '[]',
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 0,
      user_modified: 0,
      created_at: '2026-03-15 00:00:00',
      updated_at: '2026-03-15 00:00:00',
    })

    expect(() => buildClaudeSdkRuntimeBootstrap({
      sessionId: 'session-002',
    })).toThrow('原服务商已删除，请重新选择配置开启新会话')
  })
})
