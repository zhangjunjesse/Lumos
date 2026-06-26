import os from 'os'
import path from 'path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { ApiProvider } from '@/types'
import { getDefaultProvider, getProvider } from '@/lib/db/providers'
import { getSession } from '@/lib/db/sessions'
import { parseProviderModelCatalog, resolveProviderModelForRequest } from '@/lib/model-metadata'
import fs from 'fs'
import { findClaudeBinary, findGitBash, getClaudeConfigDir, getExpandedPath } from '@/lib/platform'
import { findBundledClaudeSdkCliPath } from './sdk-paths'
import { resolveScriptFromCmd, sanitizeEnv } from './utils'
import {
  clearClaudeAndAnthropicEnv,
  injectClaudeProviderEnv,
  isClaudeLocalAuthProvider,
} from './provider-env'
import { applyConfiguredProxyToEnv } from '@/lib/net/proxy-settings'
import { getVenvDir, getVenvPythonPath } from '@/lib/python-venv'
import {
  buildLumosLlmRequestHeaders,
  mergeHeaderLines,
  type LumosLlmRequestMetadata,
} from '@/lib/llm-request-metadata'

export interface ClaudeSdkRuntimeBootstrap {
  activeProvider?: ApiProvider
  env: Record<string, string>
  settingSources: Options['settingSources']
  pathToClaudeCodeExecutable?: string
}

export interface ClaudeSdkInvocationContext extends ClaudeSdkRuntimeBootstrap {
  requestedModel?: string
  resolvedModel?: string
}

export interface ClaudeSdkRuntimeBootstrapOptions {
  provider?: ApiProvider
  sessionId?: string
}

export interface ClaudeSdkInvocationContextOptions extends ClaudeSdkRuntimeBootstrapOptions {
  requestedModel?: string
  requestMetadata?: LumosLlmRequestMetadata
}

function findBundledCliPath(): string | undefined {
  return findBundledClaudeSdkCliPath()
}

/**
 * Force every `python` / `python3` / `pip` invocation inside the SDK child
 * process (Bash tool, code interpreter, etc.) to use Lumos's bundled venv.
 *
 * Strategy: prepend the venv bin dir to PATH and set VIRTUAL_ENV so Python
 * resolves site-packages from there. Clear PYTHONHOME/PYTHONPATH to avoid
 * leaking the host interpreter's environment into the venv.
 */
function injectBundledPythonEnv(sdkEnv: Record<string, string>): void {
  try {
    const venvPython = getVenvPythonPath()
    if (!fs.existsSync(venvPython)) return

    const venvDir = getVenvDir()
    const venvBin = path.dirname(venvPython)
    const sep = process.platform === 'win32' ? ';' : ':'
    sdkEnv.PATH = `${venvBin}${sep}${sdkEnv.PATH || ''}`
    sdkEnv.VIRTUAL_ENV = venvDir
    delete sdkEnv.PYTHONHOME
    delete sdkEnv.PYTHONPATH
  } catch {
    // venv unavailable — fall back to system PATH silently
  }
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
  // 本地 Claude(local_auth) 走官方 api.anthropic.com（国内常被墙）→ 按「设置→通用→外网连接」
  // 配的代理出网。只对 local_auth 注入：其他类型服务商多为国内中转/自带 base_url，塞代理反而坏。
  if (isClaudeLocalAuthProvider(activeProvider)) {
    applyConfiguredProxyToEnv(sdkEnv)
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

function isActualClaudeModel(value?: string | null): boolean {
  const normalized = value?.trim().toLowerCase() || ''
  return normalized.startsWith('claude-')
}

function isActualClaudeHaikuModel(value?: string | null): boolean {
  const normalized = value?.trim().toLowerCase() || ''
  return isActualClaudeModel(normalized) && normalized.includes('haiku')
}

function shouldPinSdkAuxiliaryModels(
  provider: ApiProvider | undefined,
  resolvedModel: string | undefined,
): provider is ApiProvider {
  if (!provider || !resolvedModel) return false
  if (provider.auth_mode === 'local_auth') return false

  if (!isActualClaudeModel(resolvedModel)) {
    return true
  }

  const configuredModels = parseProviderModelCatalog(provider.model_catalog)
  if (configuredModels.length === 0) return false

  return !configuredModels.some((model) => isActualClaudeHaikuModel(model.value))
}

function pinSdkAuxiliaryModelsToResolvedModel(
  env: Record<string, string>,
  provider: ApiProvider | undefined,
  resolvedModel: string | undefined,
): void {
  const auxiliaryModel = resolvedModel?.trim()
  if (!auxiliaryModel || !shouldPinSdkAuxiliaryModels(provider, auxiliaryModel)) return

  // Claude Code may use separate helper/default/subagent models outside the
  // main `options.model`. Non-Claude gateway providers often cannot bill those
  // Claude-native model ids correctly, so pin every SDK-side auxiliary selector
  // to the same model Lumos resolved for the run.
  env.ANTHROPIC_SMALL_FAST_MODEL = auxiliaryModel
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = auxiliaryModel
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = auxiliaryModel
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = auxiliaryModel
  env.CLAUDE_CODE_SUBAGENT_MODEL = auxiliaryModel
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

  injectBundledPythonEnv(sdkEnv)

  clearClaudeAndAnthropicEnv(sdkEnv)

  if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    const gitBashPath = findGitBash()
    if (gitBashPath) {
      sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath
    }
  }

  // 关掉 Claude Code 在 system prompt 里拼的 "version.entrypoint" attribution
  // 字符串。这段每次跑都带 SDK 版本号和入口名,会让 system prompt prefix 浮动,
  // 把 Anthropic prompt cache 命中率打穿(经第三方网关/new-api 中转时尤为明显)。
  // 关掉后 prefix 稳定,缓存正常命中。`=0` 触发 SDK 内 Jz() 的关闭判定。
  sdkEnv.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'

  sdkEnv.CLAUDE_CONFIG_DIR = getClaudeConfigDir()

  const activeProvider = injectProviderEnv(sdkEnv, options)

  return {
    activeProvider,
    env: sanitizeEnv(sdkEnv),
    settingSources: ['project'],
    pathToClaudeCodeExecutable: resolveClaudeCliPath(),
  }
}

export function buildClaudeSdkInvocationContext(
  options?: ClaudeSdkInvocationContextOptions,
): ClaudeSdkInvocationContext {
  const runtime = buildClaudeSdkRuntimeBootstrap(options)
  const requestedModel = options?.requestedModel?.trim() || undefined
  const resolvedModel = resolveProviderModelForRequest(runtime.activeProvider, requestedModel)
  const lumosHeaders = buildLumosLlmRequestHeaders(options?.requestMetadata)
  const mergedHeaders = mergeHeaderLines(runtime.env.ANTHROPIC_CUSTOM_HEADERS, lumosHeaders)
  if (mergedHeaders) {
    runtime.env.ANTHROPIC_CUSTOM_HEADERS = mergedHeaders
  }
  pinSdkAuxiliaryModelsToResolvedModel(runtime.env, runtime.activeProvider, resolvedModel)

  return {
    ...runtime,
    ...(requestedModel ? { requestedModel } : {}),
    ...(resolvedModel ? { resolvedModel } : {}),
  }
}
