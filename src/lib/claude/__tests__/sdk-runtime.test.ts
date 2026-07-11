import fs from 'fs'
import path from 'path'
import { buildClaudeSdkInvocationContext, buildClaudeSdkRuntimeBootstrap } from '../sdk-runtime'

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

// 与 sdk-paths.ts 一致:SDK 0.3.x 的运行时是平台包里的原生二进制,不再是 cli.js。
function expectedBundledSdkBinaryPath(): string {
  return path.join(
    process.cwd(),
    'node_modules',
    '@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  )
}

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
      return target === expectedBundledSdkBinaryPath()
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
    expect(runtime.pathToClaudeCodeExecutable).toBe(expectedBundledSdkBinaryPath())
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
    expect(runtime.settingSources).toEqual(['project'])
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

  test('explicit provider overrides a stale session binding and injects upstream channel headers', () => {
    mockGetSession.mockReturnValue({
      id: 'session-fox',
      provider_id: 'provider-uc',
    })
    mockGetProvider.mockImplementation((id: string) => {
      if (id !== 'provider-uc') {
        return undefined
      }
      return {
        id: 'provider-uc',
        name: 'UC Provider',
        provider_type: 'anthropic',
        api_protocol: 'openai-compatible',
        capabilities: '["agent-chat"]',
        provider_origin: 'system',
        auth_mode: 'api_key',
        base_url: 'http://api.miki.zj.cn',
        api_key: 'sk-uc',
        is_active: 0,
        sort_order: 0,
        extra_env: JSON.stringify({
          LUMOS_UPSTREAM_CHANNEL_ID: '4',
        }),
        model_catalog: '[]',
        model_catalog_source: 'default',
        model_catalog_updated_at: null,
        notes: '',
        is_builtin: 1,
        user_modified: 0,
        created_at: '2026-04-24 00:00:00',
        updated_at: '2026-04-24 00:00:00',
      }
    })

    const runtime = buildClaudeSdkRuntimeBootstrap({
      sessionId: 'session-fox',
      provider: {
        id: 'provider-fox',
        name: 'Fox Provider',
        provider_type: 'anthropic',
        api_protocol: 'openai-compatible',
        capabilities: '["agent-chat"]',
        provider_origin: 'system',
        auth_mode: 'api_key',
        base_url: 'http://api.miki.zj.cn',
        api_key: 'sk-fox',
        is_active: 0,
        sort_order: 0,
        extra_env: JSON.stringify({
          LUMOS_UPSTREAM_CHANNEL_ID: '3',
        }),
        model_catalog: '[]',
        model_catalog_source: 'default',
        model_catalog_updated_at: null,
        notes: '',
        is_builtin: 1,
        user_modified: 0,
        created_at: '2026-04-24 00:00:00',
        updated_at: '2026-04-24 00:00:00',
      },
    })

    expect(runtime.activeProvider?.id).toBe('provider-fox')
    expect(runtime.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-fox-3')
    expect(runtime.env.ANTHROPIC_BASE_URL).toBe('http://api.miki.zj.cn')
    expect(runtime.env.ANTHROPIC_CUSTOM_HEADERS).toBe('Specific-Channel-Id: 3')
  })

  test('adds Lumos request metadata to Claude SDK custom headers', () => {
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-fox',
      name: 'Fox Provider',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'system',
      auth_mode: 'api_key',
      base_url: 'http://api.miki.zj.cn',
      api_key: 'sk-fox',
      is_active: 0,
      sort_order: 0,
      extra_env: JSON.stringify({
        LUMOS_UPSTREAM_CHANNEL_ID: '3',
      }),
      model_catalog: '[]',
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 1,
      user_modified: 0,
      created_at: '2026-04-24 00:00:00',
      updated_at: '2026-04-24 00:00:00',
    })

    const runtime = buildClaudeSdkInvocationContext({
      requestedModel: 'claude-sonnet-4-6',
      requestMetadata: {
        module: 'workflow',
        operation: 'stage-worker',
        sessionId: 'session-001',
        runId: 'run-001',
        stageId: 'stage-001',
      },
    })

    expect(runtime.env.ANTHROPIC_CUSTOM_HEADERS).toContain('Specific-Channel-Id: 3')
    expect(runtime.env.ANTHROPIC_CUSTOM_HEADERS).toContain('X-Lumos-Module: workflow')
    expect(runtime.env.ANTHROPIC_CUSTOM_HEADERS).toContain('X-Lumos-Operation: stage-worker')
    expect(runtime.env.ANTHROPIC_CUSTOM_HEADERS).toContain('X-Lumos-Session-Id: session-001')
    expect(runtime.env.ANTHROPIC_CUSTOM_HEADERS).toContain('X-Lumos-Run-Id: run-001')
    expect(runtime.env.ANTHROPIC_CUSTOM_HEADERS).toContain('X-Lumos-Stage-Id: stage-001')
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

  test('builds invocation context with the provider-resolved model id', () => {
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-lumos-cloud',
      name: 'Lumos Cloud',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'system',
      auth_mode: 'api_key',
      base_url: 'http://api.miki.zj.cn',
      api_key: 'sk-test',
      is_active: 1,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: JSON.stringify([
        { value: 'doubao-seed-2-0-lite-260215', label: 'doubao-seed-2-0-lite-260215' },
      ]),
      model_catalog_source: 'default',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 1,
      user_modified: 0,
      created_at: '2026-04-10 00:00:00',
      updated_at: '2026-04-10 00:00:00',
    })

    const runtime = buildClaudeSdkInvocationContext({
      requestedModel: 'doubao-seed-2.0-lite',
    })

    expect(runtime.activeProvider?.id).toBe('provider-lumos-cloud')
    expect(runtime.requestedModel).toBe('doubao-seed-2.0-lite')
    expect(runtime.resolvedModel).toBe('doubao-seed-2-0-lite-260215')
  })

  test('pins Claude SDK auxiliary Haiku calls to the resolved model for non-Claude cloud catalogs', () => {
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-deepseek-cloud',
      name: 'LumosProToDeepSeek',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'system',
      auth_mode: 'api_key',
      base_url: 'http://api.miki.zj.cn',
      api_key: 'sk-test',
      is_active: 1,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: JSON.stringify([
        { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
        { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
      ]),
      model_catalog_source: 'manual',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 1,
      user_modified: 0,
      created_at: '2026-04-28 00:00:00',
      updated_at: '2026-04-28 00:00:00',
    })

    const runtime = buildClaudeSdkInvocationContext({
      requestedModel: 'deepseek-v4-flash',
    })

    expect(runtime.resolvedModel).toBe('deepseek-v4-flash')
    expect(runtime.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('deepseek-v4-flash')
    expect(runtime.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('deepseek-v4-flash')
    expect(runtime.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('deepseek-v4-flash')
    expect(runtime.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('deepseek-v4-flash')
    expect(runtime.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('deepseek-v4-flash')
  })

  test('pins auxiliary models when a mixed catalog resolves to a non-Claude model', () => {
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-mixed-cloud',
      name: 'Mixed Gateway',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'system',
      auth_mode: 'api_key',
      base_url: 'http://api.miki.zj.cn',
      api_key: 'sk-test',
      is_active: 1,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: JSON.stringify([
        { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' },
        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
      ]),
      model_catalog_source: 'detected',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 1,
      user_modified: 0,
      created_at: '2026-04-28 00:00:00',
      updated_at: '2026-04-28 00:00:00',
    })

    const runtime = buildClaudeSdkInvocationContext({
      requestedModel: 'deepseek-v4-flash',
    })

    expect(runtime.resolvedModel).toBe('deepseek-v4-flash')
    expect(runtime.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('deepseek-v4-flash')
    expect(runtime.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('deepseek-v4-flash')
    expect(runtime.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('deepseek-v4-flash')
    expect(runtime.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('deepseek-v4-flash')
    expect(runtime.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('deepseek-v4-flash')
  })

  test('keeps Claude SDK auxiliary model defaults when the provider catalog has Haiku', () => {
    mockGetDefaultProvider.mockReturnValue({
      id: 'provider-claude-proxy',
      name: 'Claude Proxy',
      provider_type: 'anthropic',
      api_protocol: 'anthropic-messages',
      capabilities: '["agent-chat"]',
      provider_origin: 'system',
      auth_mode: 'api_key',
      base_url: 'http://api.miki.zj.cn',
      api_key: 'sk-test',
      is_active: 1,
      sort_order: 0,
      extra_env: '{}',
      model_catalog: JSON.stringify([
        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
      ]),
      model_catalog_source: 'manual',
      model_catalog_updated_at: null,
      notes: '',
      is_builtin: 1,
      user_modified: 0,
      created_at: '2026-04-28 00:00:00',
      updated_at: '2026-04-28 00:00:00',
    })

    const runtime = buildClaudeSdkInvocationContext({
      requestedModel: 'claude-sonnet-4-6',
    })

    expect(runtime.resolvedModel).toBe('claude-sonnet-4-6')
    expect(runtime.env.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined()
    expect(runtime.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined()
    expect(runtime.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined()
    expect(runtime.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined()
    expect(runtime.env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined()
  })
})
