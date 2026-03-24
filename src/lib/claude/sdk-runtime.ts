import os from 'os'
import path from 'path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { ApiProvider } from '@/types'
import { getActiveProvider, getProvider } from '@/lib/db/providers'
import { getDefaultProviderId, getSession, getSetting } from '@/lib/db/sessions'
import { findClaudeBinary, findGitBash, getExpandedPath } from '@/lib/platform'
import { findBundledClaudeSdkCliPath } from './sdk-paths'
import { resolveScriptFromCmd, sanitizeEnv } from './utils'

export interface ClaudeSdkRuntimeBootstrap {
  activeProvider?: ApiProvider
  env: Record<string, string>
  settingSources: Options['settingSources']
  pathToClaudeCodeExecutable?: string
}

export interface ClaudeSdkRuntimeBootstrapOptions {
  provider?: ApiProvider
  sessionId?: string
}

function findBundledCliPath(): string | undefined {
  return findBundledClaudeSdkCliPath()
}

function resolveRuntimeProvider(options?: ClaudeSdkRuntimeBootstrapOptions): ApiProvider | undefined {
  if (options?.provider) {
    return options.provider
  }

  const sessionId = options?.sessionId?.trim() || ''
  if (sessionId) {
    const session = getSession(sessionId)
    const sessionProviderId = session?.provider_id?.trim() || ''
    if (sessionProviderId) {
      const sessionProvider = getProvider(sessionProviderId)
      if (sessionProvider) {
        return sessionProvider
      }
    }
  }

  const defaultProviderId = getDefaultProviderId()?.trim() || ''
  if (defaultProviderId) {
    const defaultProvider = getProvider(defaultProviderId)
    if (defaultProvider) {
      return defaultProvider
    }
  }

  return getActiveProvider()
}

function injectProviderEnv(
  sdkEnv: Record<string, string>,
  options?: ClaudeSdkRuntimeBootstrapOptions,
): ApiProvider | undefined {
  const activeProvider = resolveRuntimeProvider(options)

  if (activeProvider?.api_key) {
    sdkEnv.ANTHROPIC_AUTH_TOKEN = activeProvider.api_key
    sdkEnv.ANTHROPIC_API_KEY = activeProvider.api_key

    if (activeProvider.base_url) {
      sdkEnv.ANTHROPIC_BASE_URL = activeProvider.base_url
    }

    try {
      const extraEnv = JSON.parse(activeProvider.extra_env || '{}')
      for (const [key, value] of Object.entries(extraEnv)) {
        if (typeof value !== 'string') {
          continue
        }
        if (value === '') {
          delete sdkEnv[key]
        } else {
          sdkEnv[key] = value
        }
      }
    } catch {
      // Ignore malformed provider extra_env.
    }

    return activeProvider
  }

  const appToken = getSetting('anthropic_auth_token')
  const appBaseUrl = getSetting('anthropic_base_url')
  if (appToken) {
    sdkEnv.ANTHROPIC_AUTH_TOKEN = appToken
  }
  if (appBaseUrl) {
    sdkEnv.ANTHROPIC_BASE_URL = appBaseUrl
  }

  return activeProvider
}

function resolveClaudeCliPath(): string | undefined {
  const bundledCli = findBundledCliPath()
  if (bundledCli) {
    return bundledCli
  }

  const claudePath = findClaudeBinary()
  if (!claudePath) {
    return undefined
  }

  const extension = path.extname(claudePath).toLowerCase()
  if (extension === '.cmd' || extension === '.bat') {
    return resolveScriptFromCmd(claudePath)
  }

  return claudePath
}

export function buildClaudeSdkRuntimeBootstrap(options?: ClaudeSdkRuntimeBootstrapOptions): ClaudeSdkRuntimeBootstrap {
  const sdkEnv: Record<string, string> = { ...process.env as Record<string, string> }

  if (!sdkEnv.HOME) {
    sdkEnv.HOME = os.homedir()
  }
  if (!sdkEnv.USERPROFILE) {
    sdkEnv.USERPROFILE = os.homedir()
  }
  sdkEnv.PATH = getExpandedPath()
  sdkEnv.ELECTRON_RUN_AS_NODE = '1'

  for (const key of Object.keys(sdkEnv)) {
    if (key.startsWith('CLAUDE_') || key.startsWith('ANTHROPIC_')) {
      delete sdkEnv[key]
    }
  }

  if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    const gitBashPath = findGitBash()
    if (gitBashPath) {
      sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath
    }
  }

  const claudeConfigDir = process.env.LUMOS_CLAUDE_CONFIG_DIR || process.env.CODEPILOT_CLAUDE_CONFIG_DIR
  if (claudeConfigDir) {
    sdkEnv.CLAUDE_CONFIG_DIR = claudeConfigDir
  }

  const activeProvider = injectProviderEnv(sdkEnv, options)

  return {
    activeProvider,
    env: sanitizeEnv(sdkEnv),
    settingSources: getSetting('claude_project_settings_enabled') === 'true' ? ['project'] : [],
    pathToClaudeCodeExecutable: resolveClaudeCliPath(),
  }
}
