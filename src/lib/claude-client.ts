import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  Options,
  NotificationHookInput,
  PostToolUseHookInput,
  UserPromptSubmitHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeStreamOptions, SSEEvent, TokenUsage, MCPServerConfig, PermissionRequestEvent, FileAttachment, ApiProvider } from '@/types';
import { toSdkMcpConfig } from '@/lib/mcp-resolver';
import { isImageFile } from '@/types';
import { registerPendingPermission } from './permission-registry';
import { registerConversation, unregisterConversation } from './conversation-registry';
import { getSetting, updateSdkSessionId, createPermissionRequest, setSetting } from './db';
import { getExpandedPath } from './platform';
import { execFileSync } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { searchWithMeta, buildContext } from '@/lib/knowledge/searcher';
import { sanitizeEnv } from './claude/utils';
import { buildMindRuntimePack } from '@/lib/mind/runtime-pack';
import { buildMemoryV2PackForPrompt } from '@/lib/memory-v2/runtime';
import { getClaudeProviderRoutingSnapshot, isClaudeLocalAuthProvider } from './claude/provider-env';
import { ensureClaudeLocalAuthReady } from './claude/local-auth';
import { buildClaudeSdkInvocationContext } from './claude/sdk-runtime';
import { buildRuntimeResourceCandidates, resolveRuntimeResourcePath } from './runtime-resources';
import {
  buildAudioTranscriptionInstruction,
  isAudioFileLike,
  type AudioTranscriptionReference,
} from '@/lib/chat/audio-attachments';
import { startLlmRequestLog } from '@/lib/llm-request-log';
import {
  assertLlmProviderCircuitClosed,
  recordLlmProviderFailure,
} from '@/lib/llm-circuit-breaker';
import { classifyTerminalLlmError } from '@/lib/llm-error-classifier';
import { recordMemoryV2McpToolCallEvent } from '@/lib/memory-v2/capability-events';
import { buildPromptWithHistory } from './claude/history-normalizer';
import { appendKnowledgeReference } from './chat/knowledge-reference';
import { extractHistoryImages } from './claude/history-images';
import { toVisionMediaType, type VisionMediaType } from './claude/vision-media';
import { recordRuntimeEvent } from './claude/runtime-events';

/**
 * Find the system `node` binary. Required in packaged Electron apps where
 * process.execPath points to the Electron binary (which lacks web globals
 * like ReadableStream that the CLI needs).
 */
let _cachedNodePath: string | null | undefined;

/** Check if a node binary is version >= 18 (required for ReadableStream etc.) */
function isNodeVersionOk(nodePath: string): boolean {
  try {
    const ver = execFileSync(nodePath, ['--version'], {
      timeout: 3000, encoding: 'utf-8', stdio: 'pipe',
    }).toString().trim();
    const major = parseInt(ver.replace(/^v/, ''), 10);
    return major >= 18;
  } catch {
    return false;
  }
}

/**
 * Find bundled Node.js runtime in packaged app.
 * Returns path to node executable or undefined if not found.
 */
function findBundledNode(): string | undefined {
  const platform = process.platform;
  const arch = process.arch;
  const ext = platform === 'win32' ? '.exe' : '';
  const exeName = `node${ext}`;

  const relativeNodePath = path.join('node-runtime', platform, arch, exeName);
  const nodePath = resolveRuntimeResourcePath(relativeNodePath);

  console.log('[claude-client] Looking for bundled Node.js:', {
    platform,
    arch,
    candidates: buildRuntimeResourceCandidates(relativeNodePath),
    nodePath,
    exists: Boolean(nodePath && fs.existsSync(nodePath)),
  });

  if (nodePath && fs.existsSync(nodePath)) {
    console.log('[claude-client] Found bundled Node.js at:', nodePath);
    return nodePath;
  }

  console.log('[claude-client] Bundled Node.js not found');
  return undefined;
}

function findSystemNode(): string | undefined {
  if (_cachedNodePath !== undefined) return _cachedNodePath || undefined;

  console.log('[claude-client] Searching for Node.js runtime...');

  // 1. Try bundled Node.js first (packaged app)
  const bundled = findBundledNode();
  if (bundled) {
    const versionOk = isNodeVersionOk(bundled);
    console.log('[claude-client] Bundled Node.js version check:', { path: bundled, versionOk });
    if (versionOk) {
      console.log('[claude-client] ✓ Using bundled Node.js:', bundled);
      _cachedNodePath = bundled;
      return bundled;
    }
  }

  console.log('[claude-client] Falling back to system Node.js...');

  // 2. Fall back to system Node.js
  const candidates: string[] = [];
  const home = os.homedir();

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    candidates.push(path.join(programFiles, 'nodejs', 'node.exe'));
  } else {
    const nvmDir = process.env.NVM_DIR || path.join(home, '.nvm');
    // nvm current symlink
    candidates.push(path.join(nvmDir, 'current', 'bin', 'node'));
    // Scan nvm versions directory for installed nodes (newest first)
    try {
      const versionsDir = path.join(nvmDir, 'versions', 'node');
      if (fs.existsSync(versionsDir)) {
        const versions = fs.readdirSync(versionsDir)
          .filter(v => v.startsWith('v'))
          .sort((a, b) => {
            const pa = a.replace('v', '').split('.').map(Number);
            const pb = b.replace('v', '').split('.').map(Number);
            for (let i = 0; i < 3; i++) {
              if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
            }
            return 0;
          });
        for (const v of versions) {
          candidates.push(path.join(versionsDir, v, 'bin', 'node'));
        }
      }
    } catch { /* skip */ }
    // nvm versioned paths from PATH
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      if (dir.includes('.nvm/versions/node')) {
        candidates.push(path.join(dir, 'node'));
      }
    }
    // Common system locations (checked AFTER nvm)
    candidates.push(
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node',
      path.join(home, '.local', 'bin', 'node'),
    );
  }

  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && isNodeVersionOk(p)) {
        _cachedNodePath = p;
        console.log(`[findSystemNode] Found node >= 18: ${p}`);
        return p;
      }
    } catch { /* skip */ }
  }

  // Last resort: `which node`
  try {
    const cmd = process.platform === 'win32' ? 'where' : '/usr/bin/which';
    const result = execFileSync(cmd, ['node'], {
      timeout: 3000, encoding: 'utf-8', stdio: 'pipe',
      env: { ...process.env, PATH: getExpandedPath() },
    });
    const found = result.toString().trim().split(/\r?\n/)[0]?.trim();
    if (found && fs.existsSync(found)) {
      _cachedNodePath = found;
      return found;
    }
  } catch { /* not found */ }

  _cachedNodePath = null;
  return undefined;
}

// toSdkMcpConfig is now imported from @/lib/mcp-resolver (single source of truth)

/**
 * Format an SSE line from an event object
 */
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function emitStatus(
  controller: ReadableStreamDefaultController<string>,
  message: string,
  extra: Record<string, unknown> = {},
) {
  controller.enqueue(formatSSE({
    type: 'status',
    data: JSON.stringify({
      notification: true,
      message,
      ...extra,
    }),
  }));
}

function writeProviderRoutingDebug(params: {
  sessionId?: string;
  requestedModel?: string;
  resolvedModel?: string;
  activeProvider?: ApiProvider;
  env: Record<string, string>;
}): void {
  const debugEnabled = process.env.NODE_ENV !== 'production'
    || process.env.LUMOS_PROVIDER_ROUTING_DEBUG === 'true';
  if (!debugEnabled) {
    return;
  }

  const routing = getClaudeProviderRoutingSnapshot(params.activeProvider);
  const runtimeHeaders = params.env.ANTHROPIC_CUSTOM_HEADERS?.trim() || '';
  if (!routing?.upstreamChannelId && !runtimeHeaders) {
    return;
  }

  try {
    const dataDir = process.env.LUMOS_DATA_DIR
      || process.env.CLAUDE_GUI_DATA_DIR
      || path.join(os.homedir(), '.lumos');
    const logDir = path.join(dataDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const payload = {
      timestamp: new Date().toISOString(),
      sessionId: params.sessionId,
      requestedModel: params.requestedModel,
      resolvedModel: params.resolvedModel,
      ...routing,
      runtimeAnthropicCustomHeaders: runtimeHeaders || undefined,
    };
    fs.appendFileSync(
      path.join(logDir, 'provider-routing-debug.jsonl'),
      `${JSON.stringify(payload)}\n`,
      'utf-8',
    );
  } catch (error) {
    console.warn('[claude-client] Failed to write provider routing debug log:', error);
  }
}

// MCP signature components stay stable across process restarts on purpose:
// any per-process salt (we used to mix in `Date.now()`) would force a fresh
// SDK session after every HMR/restart, which then falls back to history-
// stitching, where tool_result blocks get dropped. The composition of
// mcpServers + on-disk dependency readiness already captures every state
// that should invalidate resume.
const DEFAULT_CHAT_DISALLOWED_TOOLS = [
  'Task',
  // Goofish write/privacy-sensitive MCP tools must go through product-owned
  // confirmation flows instead of direct chat tool calls.
  'mcp__goofish__message_send',
  'mcp__goofish__item_publish',
  'mcp__goofish__item_delete',
  'mcp__goofish__media_upload',
  'mcp__goofish__auth_login',
  'mcp__goofish__auth_reset_guard',
  'mcp__goofish__location_default',
  'mcp__goofish__search_items',
];
const STABLE_CLAUDE_CODE_ENV: Record<string, string> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
  // 关掉 Tool Search Tool（deferred 工具发现）。SDK 只对 Claude Opus/Sonnet 4+ 自动开它，
  // 且依赖 Anthropic 的 tool_reference beta；部分账号/端点不支持该 beta → 模型把工具调用打成
  // "select:..." 正文文字、不真执行、对话中断（issue #30；GPT 不走 TST 故无此问题）。
  // 强制 standard 模式：Claude 与 GPT 一样直接发 tool_use，工具正常执行。
  ENABLE_TOOL_SEARCH: 'false',
};
const MODEL_FIRST_RESPONSE_TIMEOUT_MS = 180_000;
const MODEL_FIRST_RESPONSE_TIMEOUT_ERROR = 'LUMOS_MODEL_FIRST_RESPONSE_TIMEOUT';

function mergeDisallowedTools(tools?: string[]): string[] {
  return Array.from(new Set([...DEFAULT_CHAT_DISALLOWED_TOOLS, ...(tools || [])]));
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function getSessionMcpSignatureKey(sessionId: string): string {
  return `session_mcp_signature:${sessionId}`;
}

function computeMcpSignature(mcpServers?: Record<string, MCPServerConfig>): string {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return '';
  // Include dependency readiness for MCPs that have a package.json.
  // When node_modules is created/deleted the signature changes, forcing MCP reload.
  const depsReady: string[] = [];
  for (const config of Object.values(mcpServers)) {
    const script = config.args?.[0];
    if (typeof script === 'string' && script.startsWith('/')) {
      try {
        const dir = path.dirname(script);
        if (fs.existsSync(path.join(dir, 'package.json'))) {
          depsReady.push(fs.existsSync(path.join(dir, 'node_modules')) ? '1' : '0');
        }
      } catch { /* ignore */ }
    }
  }
  const payload = stableSerialize(mcpServers)
    + (depsReady.length > 0 ? `|deps:${depsReady.join(',')}` : '');
  return createHash('sha256').update(payload).digest('hex');
}

function buildMcpSignatureConfig(
  mcpServers?: Record<string, MCPServerConfig>,
  inProcessMcpServers?: ClaudeStreamOptions['inProcessMcpServers'],
  inProcessVariantKeys?: ClaudeStreamOptions['inProcessVariantKeys'],
): Record<string, MCPServerConfig> | undefined {
  const signatureConfig: Record<string, MCPServerConfig> = { ...(mcpServers || {}) };
  for (const name of Object.keys(inProcessMcpServers || {})) {
    // R5：默认只认名字会漏掉工具集/配置变体（如 knowledge tagIds），
    // resume 时把旧变体带进新一轮。变体指纹并入签名 → 变则起新会话，
    // 不变则照常 resume（零额外开销，无变体的 server 行为不变）。
    const variantKey = inProcessVariantKeys?.[name];
    signatureConfig[name] = {
      command: '__lumos_in_process_mcp__',
      args: variantKey ? [name, variantKey] : [name],
    };
  }
  return Object.keys(signatureConfig).length > 0 ? signatureConfig : undefined;
}

/**
 * Extract text content from an SDK assistant message
 */
function extractTextFromMessage(msg: SDKAssistantMessage): string {
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * Extract token usage from an SDK result message
 */
function extractTokenUsage(msg: SDKResultMessage): TokenUsage | null {
  if (!msg.usage) return null;
  return {
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_read_input_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: msg.usage.cache_creation_input_tokens ?? 0,
    cost_usd: 'total_cost_usd' in msg ? msg.total_cost_usd : undefined,
  };
}

interface PendingToolUseForMemory {
  name: string;
  startedAt: number;
}

function summarizeToolResultForMemory(content: string, isError: boolean): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized) return isError ? 'Tool returned an error without text.' : 'Tool returned an empty result.';
  const redacted = normalized
    .replace(/(password|passwd|pwd|token|api[_\s-]?key|secret|cookie|authorization|密钥|密码|令牌|登录态)\s*[:：=]\s*([^\s，,；;]+)/ig, '$1: [已隐藏]')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[已隐藏敏感值]')
    .replace(/\b(Bearer\s+[A-Za-z0-9._-]{12,})\b/ig, '[已隐藏敏感值]');
  return redacted.length <= 420 ? redacted : `${redacted.slice(0, 417)}...`;
}

/**
 * Stream Claude responses using the Agent SDK.
 * Returns a ReadableStream of SSE-formatted strings.
 */
/**
 * Get file paths for non-image attachments. If the file already has a
 * persisted filePath (written by the uploads route), reuse it. Otherwise
 * fall back to writing the file to .lumos-uploads/.
 */
function getUploadedFilePaths(files: FileAttachment[], workDir: string): string[] {
  const paths: string[] = [];
  let uploadDir: string | undefined;
  for (const file of files) {
    if (file.filePath) {
      paths.push(file.filePath);
    } else {
      // Fallback: write file to disk (should not happen in normal flow)
      if (!uploadDir) {
        uploadDir = path.join(workDir, '.lumos-uploads');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
      }
      const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.join(uploadDir, `${Date.now()}-${safeName}`);
      const buffer = Buffer.from(file.data, 'base64');
      fs.writeFileSync(filePath, buffer);
      paths.push(filePath);
    }
  }
  return paths;
}

export function streamClaude(options: ClaudeStreamOptions): ReadableStream<string> {
  const {
    prompt,
    rawPrompt,
    sessionId,
    sdkSessionId,
    forceFreshSession,
    model,
    systemPrompt,
    workingDirectory,
    mcpServers,
    inProcessMcpServers,
    inProcessVariantKeys,
    abortController,
    permissionMode,
    files,
    toolTimeoutSeconds = 0,
    sdkBuiltinTools,
    disallowedTools,
    conversationHistory,
    onRuntimeStatusChange,
    teamSession,
  } = options;

  return new ReadableStream<string>({
    async start(controller) {
      const perfStart = Date.now();
      console.log('[perf] streamClaude start');
      emitStatus(controller, 'Preparing Claude runtime...', { phase: 'preparing' });

      const runtimeContext = buildClaudeSdkInvocationContext({
        provider: options.provider,
        sessionId,
        requestedModel: model,
        requestMetadata: {
          module: 'chat',
          operation: 'stream',
          sessionId,
          requestId: sdkSessionId,
        },
      });
      const activeProvider: ApiProvider | undefined = runtimeContext.activeProvider;
      console.log('[claude-client] activeProvider:', activeProvider ? `${activeProvider.name} (${activeProvider.base_url})` : 'undefined');
      const requestMetadata = {
        module: 'chat',
        operation: 'stream',
        sessionId,
        requestId: sdkSessionId,
      };
      const requestLog = startLlmRequestLog({
        provider: activeProvider,
        model: runtimeContext.resolvedModel || model,
        requestMetadata,
        prompt,
        transport: 'claude-agent-sdk',
      });
      let requestLogFinished = false;
      const finishRequestLog = (params: { status: 'succeeded' | 'failed' | 'blocked'; error?: unknown }) => {
        if (requestLogFinished) return;
        requestLogFinished = true;
        requestLog.finish(params);
      };

      // Hoist execPath override vars so they're accessible in the finally block
      const originalExecPath = process.execPath;
      let systemNode: string | undefined;
      let tokenUsage: TokenUsage | null = null;
      let firstMessageReceived = false;
      let modelActivityReceived = false;
      let visibleContentEmitted = false;
      let resultHadError = false;
      let modelFirstResponseTimedOut = false;
      let modelFirstResponseTimer: ReturnType<typeof setTimeout> | undefined;
      const pendingToolUsesForMemory = new Map<string, PendingToolUseForMemory>();

      const clearModelFirstResponseTimer = () => {
        if (modelFirstResponseTimer) {
          clearTimeout(modelFirstResponseTimer);
          modelFirstResponseTimer = undefined;
        }
      };

      const markModelActivity = () => {
        if (modelActivityReceived) return;
        modelActivityReceived = true;
        clearModelFirstResponseTimer();
      };

      const startModelFirstResponseTimer = () => {
        clearModelFirstResponseTimer();
        modelActivityReceived = false;
        modelFirstResponseTimedOut = false;
        modelFirstResponseTimer = setTimeout(() => {
          if (modelActivityReceived) return;
          modelFirstResponseTimedOut = true;
          recordRuntimeEvent({
            sessionId,
            sdkSessionId,
            event: 'model_first_response_timeout',
            detail: {
              timeoutMs: MODEL_FIRST_RESPONSE_TIMEOUT_MS,
              providerId: activeProvider?.id,
              providerName: activeProvider?.name,
              requestedModel: model || '',
              resolvedModel: runtimeContext.resolvedModel || '',
            },
          });
          abortController?.abort();
        }, MODEL_FIRST_RESPONSE_TIMEOUT_MS);
      };

      try {
        const sdkEnv: Record<string, string> = {
          ...runtimeContext.env,
          ...STABLE_CLAUDE_CODE_ENV,
        };
        writeProviderRoutingDebug({
          sessionId,
          requestedModel: model,
          resolvedModel: runtimeContext.resolvedModel,
          activeProvider,
          env: sdkEnv,
        });
        if (process.env.NODE_ENV !== 'production' || process.env.LUMOS_PROVIDER_ROUTING_DEBUG === 'true') {
          console.log('[claude-client] providerRouting:', {
            sessionId,
            providerId: activeProvider?.id,
            providerName: activeProvider?.name,
            apiProtocol: activeProvider?.api_protocol,
            upstreamChannelHeader: sdkEnv.ANTHROPIC_CUSTOM_HEADERS || '',
          });
        }

        if (isClaudeLocalAuthProvider(activeProvider)) {
          await ensureClaudeLocalAuthReady(activeProvider);
        } else if (!sdkEnv.ANTHROPIC_API_KEY && !sdkEnv.ANTHROPIC_AUTH_TOKEN) {
          console.warn('[claude-client] No API key found: no provider configured and no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN in environment');
        }
        assertLlmProviderCircuitClosed(activeProvider?.id, activeProvider?.name);

        const skipPermissions = getSetting('dangerously_skip_permissions') === 'true';

        const queryOptions: Options = {
          cwd: workingDirectory || os.homedir(),
          abortController,
          includePartialMessages: true,
          permissionMode: skipPermissions
            ? 'bypassPermissions'
            : ((permissionMode as Options['permissionMode']) || 'acceptEdits'),
          env: sanitizeEnv(sdkEnv),
          settingSources: runtimeContext.settingSources,
        };

        const effectiveDisallowedTools = mergeDisallowedTools(disallowedTools);
        if (effectiveDisallowedTools.length > 0) {
          queryOptions.disallowedTools = effectiveDisallowedTools;
        }
        if (sdkBuiltinTools !== undefined) {
          queryOptions.tools = sdkBuiltinTools;
        }

        if (skipPermissions) {
          queryOptions.allowDangerouslySkipPermissions = true;
        }

        if (runtimeContext.pathToClaudeCodeExecutable) {
          queryOptions.pathToClaudeCodeExecutable = runtimeContext.pathToClaudeCodeExecutable;
          console.log('[claude-client] Using Claude CLI:', runtimeContext.pathToClaudeCodeExecutable);
        } else {
          console.warn('[claude-client] WARNING: No Claude CLI found (bundled or system)');
        }

        if (runtimeContext.resolvedModel) {
          queryOptions.model = runtimeContext.resolvedModel;
        }

        // Knowledge base context injection (only if enabled)
        let kbContext = '';
        const kbEnabled = options.knowledgeOptions?.enabled === true
          && getSetting('kb_context_enabled') !== 'false';
        if (kbEnabled) {
          emitStatus(controller, 'Searching knowledge context...', { phase: 'knowledge' });
          try {
            console.time('[perf] KB search');
            const overrides = options.knowledgeOptions?.overrides;
            const kbTopK = overrides?.topK !== undefined
              ? Math.max(1, Math.min(Math.floor(overrides.topK), 10))
              : Math.max(1, Math.min(Number(getSetting('kb_context_top_k') || '4') || 4, 10));
            const kbMode: 'reference' | 'enhanced' = overrides?.retrievalMode
              ? overrides.retrievalMode
              : ((getSetting('kb_retrieval_mode') || '').trim().toLowerCase() === 'enhanced'
                ? 'enhanced'
                : 'reference');
            const rewriteDisabled = overrides?.rewriteEnabled !== undefined
              ? !overrides.rewriteEnabled
              : getSetting('kb_query_rewrite_enabled') === 'false';
            const kbRun = await searchWithMeta(prompt, {
              topK: kbTopK,
              retrievalMode: kbMode,
              disableRewrite: rewriteDisabled,
              tagIds: options.knowledgeOptions?.tagIds,
              candidatePool: overrides?.candidatePool,
            });
            kbContext = buildContext(kbRun.results, {
              retrievalMode: kbRun.meta.retrievalMode,
              queryVariants: kbRun.meta.queryVariants,
            });
            console.timeEnd('[perf] KB search');
          } catch (err) {
            console.warn('[claude-client] KB search failed:', err);
          }
        }

        // KB 检索结果不再拼进 system append —— 改拼进用户消息（见 buildFinalPrompt
        // 的 appendKnowledgeReference）。system 只留会话级稳定内容（persona +
        // 能力规则 + Ask 权威钳），前缀缓存稳定、注入面收窄、Ask 钳保持垫底。
        if (systemPrompt) {
          queryOptions.systemPrompt = {
            type: 'preset',
            preset: 'claude_code',
            append: systemPrompt,
          };
        }

        // Check if we should resume session (needed for MCP config decision)
        let shouldResume = !!sdkSessionId;
        if (shouldResume && forceFreshSession) {
          console.log('[claude-client] Force fresh SDK session requested');
          recordRuntimeEvent({ sessionId, sdkSessionId, event: 'resume_dropped_force_fresh' });
          shouldResume = false;
          if (sessionId) {
            try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
          }
        }
        if (shouldResume && workingDirectory && !fs.existsSync(workingDirectory)) {
          console.warn(`[claude-client] Working directory "${workingDirectory}" does not exist, skipping resume`);
          recordRuntimeEvent({
            sessionId, sdkSessionId,
            event: 'resume_dropped_cwd_missing',
            detail: { workingDirectory },
          });
          shouldResume = false;
          if (sessionId) {
            try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
          }
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              notification: true,
              title: 'Session fallback',
              message: 'Original working directory no longer exists. Starting fresh conversation.',
            }),
          }));
        }

        // === ISOLATION: MCP servers ===
        // Only pass explicitly provided config (e.g. from Lumos UI).
        // User-level ~/.claude.json and ~/.claude/settings.json are still
        // isolated. Project-level MCP may load only when project settings
        // loading is explicitly enabled.
        const hasMcpServers = !!mcpServers && Object.keys(mcpServers).length > 0;
        const mcpSignatureConfig = buildMcpSignatureConfig(mcpServers, inProcessMcpServers, inProcessVariantKeys);
        const currentMcpSignature = computeMcpSignature(mcpSignatureConfig);
        const storedMcpSignature = sessionId ? (getSetting(getSessionMcpSignatureKey(sessionId)) || '') : '';
        const mcpSignatureChanged = !!sessionId
          && storedMcpSignature !== ''
          && currentMcpSignature !== storedMcpSignature;
        recordRuntimeEvent({
          sessionId,
          sdkSessionId,
          event: 'stream_context_prepared',
          detail: {
            providerId: activeProvider?.id,
            providerName: activeProvider?.name,
            apiProtocol: activeProvider?.api_protocol,
            requestedModel: model || '',
            resolvedModel: runtimeContext.resolvedModel || '',
            workingDirectory: queryOptions.cwd,
            conversationHistoryTurns: conversationHistory?.length ?? 0,
            conversationHistoryChars: conversationHistory
              ? conversationHistory.reduce((sum, item) => sum + item.content.length, 0)
              : 0,
            mcpServerNames: Object.keys(mcpServers || {}).sort(),
            inProcessMcpServerNames: Object.keys(inProcessMcpServers || {}).sort(),
            inProcessVariantKeys: Object.keys(inProcessVariantKeys || {}).sort(),
            currentMcpSignature: currentMcpSignature.slice(0, 12),
            storedMcpSignature: storedMcpSignature ? storedMcpSignature.slice(0, 12) : '',
            mcpSignatureChanged,
            shouldResumeBeforeMcpCheck: shouldResume,
          },
        });

        // If the MCP set changed since last resume (e.g. user just enabled a new
        // built-in MCP like wechat-export), the resumed CLI session will not
        // pick up the new tool process. Drop resume for this one query so the
        // SDK starts a fresh session with the full new tool set; the new
        // sdkSessionId is captured downstream and subsequent messages resume
        // normally. One-time hit per MCP set change — does not violate the
        // "no full reconnect on every message" rule.
        if (shouldResume && mcpSignatureChanged) {
          console.log('[claude-client] MCP signature changed on resume — starting fresh CLI session', {
            stored: storedMcpSignature.slice(0, 12),
            current: currentMcpSignature.slice(0, 12),
          });
          recordRuntimeEvent({
            sessionId, sdkSessionId,
            event: 'resume_dropped_mcp_changed',
            detail: {
              storedSignature: storedMcpSignature.slice(0, 12),
              currentSignature: currentMcpSignature.slice(0, 12),
            },
          });
          shouldResume = false;
          if (sessionId) {
            try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
          }
          controller.enqueue(formatSSE({
            type: 'status',
            data: JSON.stringify({
              notification: true,
              title: '工具集已更新',
              message: '检测到新的工具,已重新加载会话以让 AI 使用新工具。',
            }),
          }));
        }

        if (hasMcpServers) {
          const serverNames = Object.keys(mcpServers!);
          const forceReloadOnResume = shouldResume
            && getSetting('mcp_reload_on_resume') === 'true';

          emitStatus(
            controller,
            !shouldResume
              ? 'Loading tool connections...'
              : forceReloadOnResume
                ? 'Refreshing tool connections...'
                : 'Reusing tool connections...',
            { phase: 'tools' },
          );

          // Always pass MCP config so the SDK can reconnect dead processes.
          // The SDK itself handles reuse when the connection is still alive.
          queryOptions.mcpServers = toSdkMcpConfig(mcpServers!);
          if (!shouldResume || forceReloadOnResume) {
            console.log('[claude-client] Loading MCP servers:', {
              names: serverNames,
              reason: shouldResume ? 'resume-reload' : 'initial',
            });
          } else {
            console.log('[claude-client] Resuming session, MCP config passed for reconnect safety');
          }
        } else if (shouldResume) {
          console.log('[claude-client] Resuming session without MCP servers');
        }

        // Merge in-process MCP servers (e.g. lumos-image)
        if (inProcessMcpServers && Object.keys(inProcessMcpServers).length > 0) {
          queryOptions.mcpServers = {
            ...(queryOptions.mcpServers || {}),
            ...inProcessMcpServers,
          };
          console.log('[claude-client] Injected in-process MCP servers:', Object.keys(inProcessMcpServers));
        }

        if (sessionId) {
          try {
            setSetting(getSessionMcpSignatureKey(sessionId), currentMcpSignature);
          } catch (error) {
            console.warn('[claude-client] Failed to persist MCP signature:', error);
          }
        }

        // === ISOLATION: Skills ===
        // Load enabled skills from database via plugin system.
        // User-level ~/.claude/skills remains isolated.
        // Skills are synced at app startup and when skills are modified in settings.
        // We just reference the pre-synced plugin directory here (no I/O).
        console.time('[perf] Skills loading');
        const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
        const pluginDir = path.join(dataDir, 'skills-plugin');

        if (fs.existsSync(pluginDir)) {
          queryOptions.plugins = [
            { type: 'local', path: pluginDir }
          ];
          console.log('[claude-client] Loaded skills plugin:', pluginDir);
        } else {
          console.warn('[claude-client] Skills plugin directory not found:', pluginDir);
        }
        console.timeEnd('[perf] Skills loading');

        if (shouldResume) {
          console.log('[claude-client] Attempting to resume session:', sdkSessionId);
        }

        // Permission handler: sends SSE event and waits for user response
        queryOptions.canUseTool = async (toolName, input, opts) => {
          if (disallowedTools?.includes(toolName)) {
            return {
              behavior: 'deny' as const,
              message: `${toolName} is disabled for this request. Use the selected Lumos browser tools when browser control is requested.`,
            };
          }

          // Auto-approve built-in in-process MCP server tools (read-only or fully owned by Lumos).
            if (
              toolName.startsWith('mcp__feishu__')
              || toolName.startsWith('mcp__lumos-image__')
              || toolName.startsWith('mcp__lumos-butler__')
              || toolName.startsWith('mcp__lumos-issue-reporter__')
              || toolName.startsWith('mcp__lumos-knowledge__')
              || toolName.startsWith('mcp__lumos-wechat-assistant__')
              || toolName.startsWith('mcp__wechat-export__')
              // 交易：只读的 preview_order 自动批准；place_order 刻意不批——必须弹确认框（真钱）。
              || toolName === 'mcp__lumos-trade__preview_order'
            || toolName.startsWith('mcp__chrome-devtools__')
            || toolName.startsWith('mcp__chrome_devtools__')
          ) {
            return { behavior: 'allow' as const, updatedInput: input };
          }
          const permissionRequestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const permEvent: PermissionRequestEvent = {
            permissionRequestId,
            toolName,
            toolInput: input,
            suggestions: opts.suggestions as PermissionRequestEvent['suggestions'],
            decisionReason: opts.decisionReason,
            blockedPath: opts.blockedPath,
            toolUseId: opts.toolUseID,
            description: undefined,
          };

          // Persist permission request to DB for audit/recovery
          const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace('T', ' ').split('.')[0];
          try {
            createPermissionRequest({
              id: permissionRequestId,
              sessionId,
              sdkSessionId: sdkSessionId || '',
              toolName,
              toolInput: JSON.stringify(input),
              decisionReason: opts.decisionReason || '',
              expiresAt,
            });
          } catch (e) {
            console.warn('[claude-client] Failed to persist permission request to DB:', e);
          }

          // Send permission_request SSE event to the client
          controller.enqueue(formatSSE({
            type: 'permission_request',
            data: JSON.stringify(permEvent),
          }));

          // Notify runtime status change
          onRuntimeStatusChange?.('waiting_permission');

          // Wait for user response (resolved by POST /api/chat/permission)
          // Store original input so registry can inject updatedInput on allow
          const result = await registerPendingPermission(permissionRequestId, input, opts.signal);

          // Restore runtime status after permission resolved
          onRuntimeStatusChange?.('running');

          return result;
        };

        // Hooks: capture notifications and tool completion events
        queryOptions.hooks = {
          UserPromptSubmit: [{
            hooks: [async (input) => {
              try {
                const userInput = input as UserPromptSubmitHookInput;
                const runtimePack = buildMindRuntimePack({
                  sessionId,
                  projectPath: workingDirectory || queryOptions.cwd,
                  prompt: rawPrompt || userInput.prompt || prompt,
                  includeLegacyMemory: false,
                });
                const actionMemoryPack = await buildMemoryV2PackForPrompt({
                  sessionId,
                  projectPath: workingDirectory || queryOptions.cwd,
                  prompt: rawPrompt || userInput.prompt || prompt,
                });

                const additionalContext = [
                  runtimePack.additionalContext,
                  actionMemoryPack.text,
                ].filter(Boolean).join('\n\n');

                if (!additionalContext) return {};
                return {
                  hookSpecificOutput: {
                    hookEventName: 'UserPromptSubmit',
                    additionalContext,
                  },
                };
              } catch (error) {
                console.warn('[memory] UserPromptSubmit hook failed:', error);
                return {};
              }
            }],
          }],
          Notification: [{
            hooks: [async (input) => {
              const notif = input as NotificationHookInput;
              controller.enqueue(formatSSE({
                type: 'status',
                data: JSON.stringify({
                  notification: true,
                  title: notif.title,
                  message: notif.message,
                }),
              }));
              return {};
            }],
          }],
          PostToolUse: [{
            hooks: [async (input) => {
              const toolEvent = input as PostToolUseHookInput;
              controller.enqueue(formatSSE({
                type: 'tool_result',
                data: JSON.stringify({
                  tool_use_id: toolEvent.tool_use_id,
                  content: typeof toolEvent.tool_response === 'string'
                    ? toolEvent.tool_response
                    : JSON.stringify(toolEvent.tool_response),
                  is_error: false,
                }),
              }));
              return {};
            }],
          }],
        };

        // 团队会话模式:队长(主会话)+成员(agents 子代理)。压轴覆盖,保证前面的通用装配
        // 不会把控制协议回调(canUseTool/hooks)带进团队会话——它们在复杂多子代理会话里
        // 必断(实测 "Tool permission request failed: Stream closed",etsy 团队血泪教训)。
        // 权限闸门 = 各成员声明式 tools 清单;tool_result 帧由 user 消息路径照常发出。
        if (teamSession) {
          queryOptions.agents = teamSession.agents;
          queryOptions.tools = teamSession.tools;
          queryOptions.permissionMode = 'bypassPermissions';
          queryOptions.allowDangerouslySkipPermissions = true;
          delete queryOptions.canUseTool;
          delete queryOptions.hooks;
          // 聊天默认禁用 Task(单 agent 会话不许开子代理);团队会话的派单恰恰靠它——
          // 不放行队长调不了 Task,会一本正经地"扮演"成员产出(实测),必须剔除。
          queryOptions.disallowedTools = (queryOptions.disallowedTools || []).filter((t) => t !== 'Task');
          if (queryOptions.disallowedTools.length === 0) delete queryOptions.disallowedTools;
          if (teamSession.sdkMcpServers) {
            queryOptions.mcpServers = { ...(queryOptions.mcpServers || {}), ...teamSession.sdkMcpServers };
          }
        }

        // Capture real-time stderr output from Claude Code process
        queryOptions.stderr = (data: string) => {
          // Diagnostic: log raw stderr data length to server console
          console.log(`[stderr] received ${data.length} bytes, first 200 chars:`, data.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, '?'));
          // Strip ANSI escape codes, OSC sequences, and control characters
          // but preserve tabs (\x09) and carriage returns (\x0D)
          const cleaned = data
            .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')   // CSI sequences (colors, cursor)
            .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC sequences
            .replace(/\x1B\([A-Z]/g, '')               // Character set selection
            .replace(/\x1B[=>]/g, '')                   // Keypad mode
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Control chars (keep \t \n \r)
            .replace(/\r\n/g, '\n')                    // Normalize CRLF
            .replace(/\r/g, '\n')                      // Convert remaining CR to LF
            .replace(/\n{3,}/g, '\n\n')                // Collapse multiple blank lines
            .trim();
          if (cleaned) {
            controller.enqueue(formatSSE({
              type: 'tool_output',
              data: cleaned,
            }));
          }
        };

        // Build the prompt with file attachments and optional conversation history.
        // When resuming, the SDK has full context so we send the raw prompt.
        // When NOT resuming (fresh or fallback), prepend DB history for context —
        // including images the model already read via image-reader, re-attached as
        // real multimodal blocks (text fallback alone drops them to a truncated
        // base64 smear the model reads as "[Unsupported Image]").
        function buildFinalPrompt(useHistory: boolean): string | AsyncIterable<SDKUserMessage> {
          const historyPrompt = useHistory
            ? buildPromptWithHistory(prompt, conversationHistory)
            : prompt;
          // KB 检索结果作为参考资料拼进用户消息，不进 system（见上方 systemPrompt 注释）。
          const basePrompt = kbContext
            ? appendKnowledgeReference(historyPrompt, kbContext, randomBytes(8).toString('hex'))
            : historyPrompt;
          const historyImages = useHistory ? extractHistoryImages(conversationHistory) : [];

          if ((!files || files.length === 0) && historyImages.length === 0) return basePrompt;

          const attachments = files ?? [];
          const imageFiles = attachments.filter(f => isImageFile(f.type));
          const audioFiles = attachments.filter(f => !isImageFile(f.type) && isAudioFileLike({ name: f.name, type: f.type }));
          const nonImageFiles = attachments.filter(f => !isImageFile(f.type) && !isAudioFileLike({ name: f.name, type: f.type }));

          let textPrompt = basePrompt;
          if (audioFiles.length > 0) {
            const workDir = workingDirectory || os.homedir();
            const savedPaths = getUploadedFilePaths(audioFiles, workDir);
            const audioRefs: AudioTranscriptionReference[] = savedPaths.map((p, i) => ({
              filePath: p,
              name: audioFiles[i].name,
              type: audioFiles[i].type,
              size: audioFiles[i].size,
            }));
            textPrompt = `${buildAudioTranscriptionInstruction(audioRefs)}\n\nUser message:\n\n${textPrompt}`;
          }
          if (nonImageFiles.length > 0) {
            const workDir = workingDirectory || os.homedir();
            const savedPaths = getUploadedFilePaths(nonImageFiles, workDir);
            const fileReferences = savedPaths
              .map((p, i) => `[User attached file: ${p} (${nonImageFiles[i].name})]`)
              .join('\n');
            textPrompt = `${fileReferences}\n\nPlease read the attached file(s) above using your Read tool, then respond to the user's message:\n\n${textPrompt}`;
          }

          // No image on either side → plain text (audio/file refs already folded in).
          if (imageFiles.length === 0 && historyImages.length === 0) {
            return textPrompt;
          }

          let leadingText = textPrompt;
          if (imageFiles.length > 0) {
            // Append image disk paths so Claude knows where the files are on disk
            // (enables skills to reference them by path).
            const workDir = workingDirectory || os.homedir();
            const imagePaths = getUploadedFilePaths(imageFiles, workDir);
            const imageReferences = imagePaths
              .map((p, i) => `[User attached image: ${p} (${imageFiles[i].name})]`)
              .join('\n');
            leadingText = `${imageReferences}\n\n${textPrompt}`;
          }

          const contentBlocks: Array<
            | { type: 'image'; source: { type: 'base64'; media_type: VisionMediaType; data: string } }
            | { type: 'text'; text: string }
          > = [];

          // Replayed history images first, with a note so the model treats them as
          // prior read_image results rather than the user's new upload.
          if (historyImages.length > 0) {
            contentBlocks.push({
              type: 'text',
              text: `[以下 ${historyImages.length} 张图片来自本次对话中已执行的 read_image，按时间顺序附上，供你继续查看与分析]`,
            });
            for (const img of historyImages) contentBlocks.push(img);
          }

          for (const img of imageFiles) {
            contentBlocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: toVisionMediaType(img.type),
                data: img.data,
              },
            });
          }

          contentBlocks.push({ type: 'text', text: leadingText });

          const userMessage: SDKUserMessage = {
            type: 'user',
            message: {
              role: 'user',
              content: contentBlocks,
            },
            parent_tool_use_id: null,
            session_id: sdkSessionId || '',
          };

          return (async function* () {
            yield userMessage;
          })();
        }

        const finalPrompt = buildFinalPrompt(!shouldResume);

        // Sandbox: override process.execPath AND PATH so the SDK forks the
        // CLI with a proper Node.js >= 18 instead of the Electron binary.
        // The SDK uses child_process.spawn('node', ...) which resolves from
        // PATH, so we must prepend the correct node directory to PATH.
        // We also override process.execPath for any fork() calls.
        console.log('[claude-client] ========== Initializing Claude SDK ==========');
        console.log('[claude-client] Platform:', process.platform);
        console.log('[claude-client] Architecture:', process.arch);
        console.log('[claude-client] Resources path:', process.resourcesPath);
        console.log('[claude-client] Current working directory:', process.cwd());
        console.log('[claude-client] Original execPath:', process.execPath);

        systemNode = findSystemNode();
        if (systemNode) {
          process.execPath = systemNode;
          const nodeDir = path.dirname(systemNode);
          sdkEnv.PATH = `${nodeDir}${path.delimiter}${sdkEnv.PATH || ''}`;
          queryOptions.env = sanitizeEnv(sdkEnv);
          console.log('[claude-client] ✓ Sandbox: execPath →', systemNode);
          console.log('[claude-client] ✓ PATH prepended:', nodeDir);
        } else {
          console.error('[claude-client] ✗ Failed to find Node.js runtime!');
        }
        console.log('[claude-client] ==========================================');

        console.log(`[perf] Pre-SDK setup took ${Date.now() - perfStart}ms`);
        console.time('[perf] SDK query call');

        // Try to start the conversation. If resuming a previous session fails
        // (e.g. stale/corrupt session file, CLI version mismatch), automatically
        // fall back to starting a fresh conversation without resume.
        const startConversation = (resumeSession: boolean): ReturnType<typeof query> => {
          if (resumeSession && sdkSessionId) {
            queryOptions.resume = sdkSessionId;
            emitStatus(controller, 'Restoring conversation context...', { phase: 'resuming' });
            recordRuntimeEvent({ sessionId, sdkSessionId, event: 'session_resumed' });
          } else {
            delete queryOptions.resume;
            recordRuntimeEvent({ sessionId, sdkSessionId, event: 'session_started_fresh' });
          }

          const nextConversation = query({
            prompt: resumeSession ? finalPrompt : buildFinalPrompt(true),
            options: queryOptions,
          });
          emitStatus(controller, 'Waiting for model response...', { phase: 'model' });
          startModelFirstResponseTimer();
          registerConversation(sessionId, nextConversation);
          return nextConversation;
        };

        const consumeConversation = async (conversation: ReturnType<typeof query>) => {
          for await (const message of conversation) {
            if (!firstMessageReceived) {
              console.timeEnd('[perf] SDK query call');
              console.log(`[perf] First message received after ${Date.now() - perfStart}ms total`);
              firstMessageReceived = true;
            }

            if (abortController?.signal.aborted) {
              break;
            }

            switch (message.type) {
              case 'assistant': {
                markModelActivity();
                const assistantMsg = message as SDKAssistantMessage;
                // Text deltas are handled by stream_event for real-time streaming.
                const text = extractTextFromMessage(assistantMsg);
                if (text) {
                  visibleContentEmitted = true;
                  /* noop: text already streamed via stream_event */
                }

                // Check for tool use blocks
                for (const block of assistantMsg.message.content) {
                  if (block.type === 'tool_use') {
                    visibleContentEmitted = true;
                    if (typeof block.name === 'string' && block.name.startsWith('mcp__')) {
                      pendingToolUsesForMemory.set(block.id, {
                        name: block.name,
                        startedAt: Date.now(),
                      });
                    }
                    controller.enqueue(formatSSE({
                      type: 'tool_use',
                      data: JSON.stringify({
                        id: block.id,
                        name: block.name,
                        input: block.input,
                      }),
                    }));
                  }
                }
                break;
              }

              case 'user': {
                markModelActivity();
                // Tool execution results come back as user messages with tool_result blocks
                const userMsg = message as SDKUserMessage;
                const content = userMsg.message.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'tool_result') {
                      visibleContentEmitted = true;
                      const resultContent = typeof block.content === 'string'
                        ? block.content
                        : Array.isArray(block.content)
                          ? block.content
                              .filter((c): c is { type: 'text'; text: string } =>
                                c.type === 'text' && typeof (c as { text?: unknown }).text === 'string')
                              .map((c) => c.text)
                              .join('\n')
                          : String(block.content ?? '');
                      const pendingTool = pendingToolUsesForMemory.get(block.tool_use_id);
                      if (pendingTool) {
                        recordMemoryV2McpToolCallEvent({
                          toolName: pendingTool.name,
                          status: block.is_error ? 'failed' : 'success',
                          sessionId,
                          source: 'claude-agent-sdk',
                          summary: summarizeToolResultForMemory(resultContent, Boolean(block.is_error)),
                          durationMs: Date.now() - pendingTool.startedAt,
                          metadata: {
                            resultChars: resultContent.length,
                          },
                        });
                        pendingToolUsesForMemory.delete(block.tool_use_id);
                      }
                      controller.enqueue(formatSSE({
                        type: 'tool_result',
                        data: JSON.stringify({
                          tool_use_id: block.tool_use_id,
                          content: resultContent,
                          is_error: block.is_error || false,
                        }),
                      }));
                    }
                  }
                }
                break;
              }

              case 'stream_event': {
                const streamEvent = message as SDKPartialAssistantMessage;
                const evt = streamEvent.event;
                if (evt.type === 'content_block_delta' && 'delta' in evt) {
                  const delta = evt.delta;
                  if ('text' in delta && delta.text) {
                    markModelActivity();
                    visibleContentEmitted = true;
                    controller.enqueue(formatSSE({ type: 'text', data: delta.text }));
                  }
                }
                break;
              }

              case 'system': {
                const sysMsg = message as SDKSystemMessage;
                if ('subtype' in sysMsg) {
                  if (sysMsg.subtype === 'init') {
                    controller.enqueue(formatSSE({
                      type: 'status',
                      data: JSON.stringify({
                        session_id: sysMsg.session_id,
                        model: sysMsg.model,
                        tools: sysMsg.tools,
                      }),
                    }));
                  } else if (sysMsg.subtype === 'status') {
                    // SDK sends status messages when permission mode changes (e.g. ExitPlanMode)
                    const statusMsg = sysMsg as SDKSystemMessage & { permissionMode?: string };
                    if (statusMsg.permissionMode) {
                      controller.enqueue(formatSSE({
                        type: 'mode_changed',
                        data: statusMsg.permissionMode,
                      }));
                    }
                  }
                }
                break;
              }

              case 'tool_progress': {
                markModelActivity();
                const progressMsg = message as SDKToolProgressMessage;
                controller.enqueue(formatSSE({
                  type: 'tool_output',
                  data: JSON.stringify({
                    _progress: true,
                    tool_use_id: progressMsg.tool_use_id,
                    tool_name: progressMsg.tool_name,
                    elapsed_time_seconds: progressMsg.elapsed_time_seconds,
                  }),
                }));
                // Auto-timeout: abort if tool runs longer than configured threshold
                if (toolTimeoutSeconds > 0 && progressMsg.elapsed_time_seconds >= toolTimeoutSeconds) {
                  controller.enqueue(formatSSE({
                    type: 'tool_timeout',
                    data: JSON.stringify({
                      tool_name: progressMsg.tool_name,
                      elapsed_seconds: Math.round(progressMsg.elapsed_time_seconds),
                    }),
                  }));
                  abortController?.abort();
                }
                break;
              }

              case 'tool_use_summary': {
                markModelActivity();
                visibleContentEmitted = true;
                const summaryMsg = message as SDKToolUseSummaryMessage;
                controller.enqueue(formatSSE({
                  type: 'tool_use_summary',
                  data: JSON.stringify({
                    summary: summaryMsg.summary,
                    preceding_tool_use_ids: summaryMsg.preceding_tool_use_ids,
                  }),
                }));
                break;
              }

              case 'result': {
                clearModelFirstResponseTimer();
                const resultMsg = message as SDKResultMessage;
                tokenUsage = extractTokenUsage(resultMsg);
                resultHadError = resultHadError || Boolean(resultMsg.is_error);

                if (resultMsg.is_error && !visibleContentEmitted && !modelFirstResponseTimedOut) {
                  const subtype = resultMsg.subtype ? ` (${resultMsg.subtype})` : '';
                  controller.enqueue(formatSSE({
                    type: 'error',
                    data: `Claude Code returned an error before producing a response${subtype}. This is usually caused by provider throttling, an expired session, or a model gateway failure. Please retry or switch to another model/provider.`,
                  }));
                }

                // Save SDK session ID to database for future resume
                if (resultMsg.session_id && sessionId) {
                  try {
                    updateSdkSessionId(sessionId, resultMsg.session_id);
                    console.log('[claude-client] Saved SDK session ID:', resultMsg.session_id);
                  } catch (err) {
                    console.warn('[claude-client] Failed to save SDK session ID:', err);
                  }
                }

                controller.enqueue(formatSSE({
                  type: 'result',
                  data: JSON.stringify({
                    subtype: resultMsg.subtype,
                    is_error: resultMsg.is_error,
                    num_turns: resultMsg.num_turns,
                    duration_ms: resultMsg.duration_ms,
                    usage: tokenUsage,
                    session_id: resultMsg.session_id,
                  }),
                }));
                break;
              }
            }
          }

          if (modelFirstResponseTimedOut) {
            throw new Error(MODEL_FIRST_RESPONSE_TIMEOUT_ERROR);
          }
        };

        let conversation = startConversation(shouldResume);
        try {
          await consumeConversation(conversation);
        } catch (resumeError) {
          if (modelFirstResponseTimedOut || !shouldResume || firstMessageReceived) {
            throw resumeError;
          }

          const errMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
          console.warn('[claude-client] Resume failed, retrying without resume:', errMsg);
          recordRuntimeEvent({
            sessionId, sdkSessionId,
            event: 'resume_failed_at_runtime',
            detail: { error: errMsg.slice(0, 500) },
          });
          if (sessionId) {
            try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
          }
          emitStatus(controller, 'Previous session could not be resumed. Starting fresh conversation.', {
            title: 'Session fallback',
            phase: 'fallback',
          });
          conversation = startConversation(false);
          await consumeConversation(conversation);
        }

        if (resultHadError) {
          const resultError = new Error('Claude Code returned an error result before stream completed');
          recordLlmProviderFailure({
            providerId: activeProvider?.id,
            providerName: activeProvider?.name,
            error: resultError,
          });
          finishRequestLog({ status: 'failed', error: resultError });
        } else {
          finishRequestLog({ status: 'succeeded' });
        }
        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      } catch (error) {
        recordLlmProviderFailure({
          providerId: activeProvider?.id,
          providerName: activeProvider?.name,
          error,
        });
        finishRequestLog({
          status: error && typeof error === 'object' && (error as { code?: unknown }).code === 'llm_provider_circuit_open'
            ? 'blocked'
            : 'failed',
          error,
        });
        const rawMessage = error instanceof Error ? error.message : 'Unknown error';
        // Log full error details for debugging (visible in terminal / dev tools)
        console.error('[claude-client] Stream error:', {
          message: rawMessage,
          stack: error instanceof Error ? error.stack : undefined,
          cause: error instanceof Error ? (error as { cause?: unknown }).cause : undefined,
          stderr: error instanceof Error ? (error as { stderr?: string }).stderr : undefined,
          code: error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined,
        });

        // Try to extract stderr or cause for more useful error messages
        const stderr = error instanceof Error ? (error as { stderr?: string }).stderr : undefined;
        const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
        const extraDetail = stderr || (cause instanceof Error ? cause.message : cause ? String(cause) : '');

        let errorMessage = rawMessage;

        // Insufficient balance / exhausted quota: reuse the shared terminal
        // error classifier (it digs through message/cause/stderr where the
        // upstream gateway text lands) and surface its friendly Chinese
        // message instead of a raw 402/403/429 dump. Checked FIRST so a quota
        // error that happens to carry a 403/429 code isn't mislabelled as
        // "auth failed" / "rate limited" by the string branches below.
        const terminalClass = classifyTerminalLlmError(error);

        // Provide more specific error messages based on error type
        if (terminalClass?.code === 'llm_quota_exhausted') {
          errorMessage = `${terminalClass.userMessage}\n\nOriginal error: ${rawMessage}`;
        } else if (modelFirstResponseTimedOut || rawMessage === MODEL_FIRST_RESPONSE_TIMEOUT_ERROR) {
          const timeoutSeconds = Math.round(MODEL_FIRST_RESPONSE_TIMEOUT_MS / 1000);
          const providerHint = activeProvider?.name ? `（${activeProvider.name}）` : '';
          const modelHint = model ? ` / ${model}` : '';
          errorMessage = `模型${providerHint}${modelHint} 在 ${timeoutSeconds} 秒内没有返回首个内容。通常是上游排队、限流、网络超时，或会话续接上下文过大导致。请重试，或切换到更快/额度更充足的模型。`;
        } else if (error instanceof Error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || rawMessage.includes('ENOENT') || rawMessage.includes('spawn')) {
            errorMessage = `Claude Code CLI not found. Please ensure Claude Code is installed and available in your PATH.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('exited with code 1') || rawMessage.includes('exit code 1')) {
            const providerHint = activeProvider?.name ? ` (Provider: ${activeProvider.name})` : '';
            const detailHint = extraDetail ? `\n\nDetails: ${extraDetail}` : '';

            // Build configuration info for debugging
            const configInfo = {
              provider: activeProvider?.name || 'Built-in',
              model: model || 'default',
              base_url: isClaudeLocalAuthProvider(activeProvider)
                ? 'Claude 本地登录模式'
                : (activeProvider?.base_url || 'default (https://api.anthropic.com)'),
              api_key_set: isClaudeLocalAuthProvider(activeProvider) ? true : !!activeProvider?.api_key,
              api_key_length: activeProvider?.api_key?.length || 0,
              api_key_prefix: activeProvider?.api_key ? activeProvider.api_key.substring(0, 10) + '...' : 'not set',
            };

            // Log to server console
            console.error('[claude-client] Claude API call failed with exit code 1');
            console.error('[claude-client] Provider configuration:', configInfo);

            // Include config info in error message for user
            const authLine = isClaudeLocalAuthProvider(activeProvider)
              ? '• Auth: Claude 本地登录'
              : `• API Key: ${configInfo.api_key_set ? `Set (${configInfo.api_key_length} chars, prefix: ${configInfo.api_key_prefix})` : 'NOT SET ❌'}`;
            const configDetails = `\n\n📋 Current Configuration:\n• Provider: ${configInfo.provider}\n• Model: ${configInfo.model}\n• Base URL: ${configInfo.base_url}\n${authLine}`;

            errorMessage = isClaudeLocalAuthProvider(activeProvider)
              ? `Claude Code process exited with an error${providerHint}. This is often caused by:\n• Claude 本地登录已失效\n• 当前沙箱 Claude 账号没有可用订阅\n• Network connectivity issues${detailHint}${configDetails}\n\nOriginal error: ${rawMessage}`
              : `Claude Code process exited with an error${providerHint}. This is often caused by:\n• Invalid or missing API Key\n• Incorrect Base URL configuration\n• Network connectivity issues${detailHint}${configDetails}\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('exited with code')) {
            const providerHint = activeProvider?.name ? ` (Provider: ${activeProvider.name})` : '';
            errorMessage = `Claude Code process crashed unexpectedly${providerHint}.\n\nOriginal error: ${rawMessage}`;
          } else if (code === 'ECONNREFUSED' || rawMessage.includes('ECONNREFUSED') || rawMessage.includes('fetch failed')) {
            const baseUrl = activeProvider?.base_url || 'default';
            errorMessage = `Cannot connect to API endpoint (${baseUrl}). Please check your network connection and Base URL configuration.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('401') || rawMessage.includes('Unauthorized') || rawMessage.includes('authentication')) {
            const providerHint = activeProvider?.name ? ` for provider "${activeProvider.name}"` : '';
            errorMessage = isClaudeLocalAuthProvider(activeProvider)
              ? `Claude 本地登录认证失败${providerHint}。请在设置里重新登录后再试。\n\nOriginal error: ${rawMessage}`
              : `Authentication failed${providerHint}. Please verify your API Key is correct and has not expired.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('403') || rawMessage.includes('Forbidden')) {
            errorMessage = isClaudeLocalAuthProvider(activeProvider)
              ? `Claude 本地登录账号当前没有权限执行该操作，或登录状态已经失效。\n\nOriginal error: ${rawMessage}`
              : `Access denied. Your API Key may not have permission for this operation.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('429') || rawMessage.includes('rate limit') || rawMessage.includes('Rate limit')) {
            errorMessage = `服务商返回 429。对 Lumos 服务站或上游模型通道来说，这通常表示当前通道被限流、排队或不可用；不等于你刚刚发了太多请求。请稍后重试，或切换到其它服务商/模型。\n\nOriginal error: ${rawMessage}`;
          }
        }

        clearModelFirstResponseTimer();
        controller.enqueue(formatSSE({ type: 'error', data: errorMessage }));
        controller.enqueue(formatSSE({ type: 'done', data: '' }));

        // If we were resuming a session and it crashed mid-stream, clear the
        // stale sdk_session_id so the next message starts a fresh SDK session
        // instead of repeatedly hitting the same broken resume.
        if (sdkSessionId && sessionId) {
          try {
            updateSdkSessionId(sessionId, '');
            console.warn('[claude-client] Cleared stale sdk_session_id for session', sessionId);
          } catch {
            // best effort
          }
        }

        controller.close();
      } finally {
        clearModelFirstResponseTimer();
        // Restore original execPath after SDK conversation ends
        if (systemNode) {
          process.execPath = originalExecPath;
        }
        unregisterConversation(sessionId);
      }
    },

    cancel() {
      abortController?.abort();
    },
  });
}
