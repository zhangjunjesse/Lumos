import os from 'os'
import path from 'path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { ApiProvider } from '@/types'
import { getDefaultProvider, getProvider } from '@/lib/db/providers'
import { getSession } from '@/lib/db/sessions'
import { findClaudeBinary, findGitBash, getClaudeConfigDir, getExpandedPath } from '@/lib/platform'
import { findBundledClaudeSdkCliPath } from './sdk-paths'
import { resolveScriptFromCmd, sanitizeEnv } from './utils'
import {
  clearClaudeAndAnthropicEnv,
  injectClaudeProviderEnv,
} from './provider-env'

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

      throw new Error('原服务商已删除，请重新选择配置开启新会话')
    }
  }

  // Single truth source: settings.default_provider_id (via getDefaultProvider)
  return getDefaultProvider()
}

function injectProviderEnv(
  sdkEnv: Record<string, string>,
  options?: ClaudeSdkRuntimeBootstrapOptions,
): ApiProvider | undefined {
  const activeProvider = resolveRuntimeProvider(options)
  injectClaudeProviderEnv(sdkEnv, activeProvider)
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

  clearClaudeAndAnthropicEnv(sdkEnv)

  if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    const gitBashPath = findGitBash()
    if (gitBashPath) {
      sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath
    }
  }

  sdkEnv.CLAUDE_CONFIG_DIR = getClaudeConfigDir()

  const activeProvider = injectProviderEnv(sdkEnv, options)

  return {
    activeProvider,
    env: sanitizeEnv(sdkEnv),
    settingSources: ['project'],
    pathToClaudeCodeExecutable: resolveClaudeCliPath(),
  }
}
