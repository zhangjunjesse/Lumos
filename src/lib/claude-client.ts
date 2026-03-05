import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
  Options,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
  McpServerConfig,
  NotificationHookInput,
  PostToolUseHookInput,
} from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeStreamOptions, SSEEvent, TokenUsage, MCPServerConfig, PermissionRequestEvent, FileAttachment, ApiProvider } from '@/types';
import { isImageFile } from '@/types';
import { registerPendingPermission } from './permission-registry';
import { registerConversation, unregisterConversation } from './conversation-registry';
import { getSetting, getActiveProvider, updateSdkSessionId, createPermissionRequest, getEnabledSkills } from './db';
import { findClaudeBinary, findGitBash, getExpandedPath } from './platform';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { searchAll, buildContext } from '@/lib/knowledge/searcher';
import { sanitizeEnv, resolveScriptFromCmd } from './claude/utils';

let cachedClaudePath: string | null | undefined;

function findClaudePath(): string | undefined {
  if (cachedClaudePath !== undefined) return cachedClaudePath || undefined;
  console.log('[claude-client] Searching for Claude CLI...');
  const found = findClaudeBinary();
  console.log('[claude-client] Claude CLI search result:', found || 'NOT FOUND');
  cachedClaudePath = found ?? null;
  return found;
}

/**
 * Find the system `node` binary. Required in packaged Electron apps where
 * process.execPath points to the Electron binary (which lacks web globals
 * like ReadableStream that the CLI needs).
 */
let _cachedNodePath: string | null | undefined;

/** Check if a node binary is version >= 18 (required for ReadableStream etc.) */
function isNodeVersionOk(nodePath: string): boolean {
  try {
    const { execFileSync } = require('child_process');
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

  // In packaged app, resources are at process.resourcesPath
  const resourcesPath = process.resourcesPath || path.join(process.cwd(), '..');
  const nodePath = path.join(resourcesPath, 'node-runtime', platform, arch, exeName);

  console.log('[claude-client] Looking for bundled Node.js:', {
    platform,
    arch,
    resourcesPath,
    nodePath,
    exists: fs.existsSync(nodePath),
  });

  if (fs.existsSync(nodePath)) {
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
    const { execFileSync } = require('child_process');
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

/**
 * Find the SDK's bundled cli.js as a fallback when no system Claude CLI is installed.
 * The SDK package includes a complete Claude Code CLI at its root as cli.js.
 */
function findBundledCliPath(): string | undefined {
  // 1. process.cwd() — most reliable in packaged Electron app where
  //    cwd is set to standalone/ by the main process.
  //    Also works in dev mode where cwd is the project root.
  const cwdCandidate = path.join(
    process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'
  );
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;

  // 2. require.resolve — works in dev mode with normal Node.js resolution.
  //    NOTE: webpack compiles this to a numeric module ID in production,
  //    so it will fail in the packaged app (caught by try/catch).
  try {
    const sdkPkg = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    if (typeof sdkPkg === 'string' && sdkPkg.includes('claude-agent-sdk')) {
      const cliPath = path.join(path.dirname(sdkPkg), 'cli.js');
      if (fs.existsSync(cliPath)) return cliPath;
    }
  } catch {
    // SDK not resolvable via require.resolve (e.g. in standalone build)
  }

  return undefined;
}

/**
 * Convert our MCPServerConfig to the SDK's McpServerConfig format.
 * Supports stdio, sse, and http transport types.
 */
function toSdkMcpConfig(
  servers: Record<string, MCPServerConfig>
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    const transport = config.type || 'stdio';

    switch (transport) {
      case 'sse': {
        if (!config.url) {
          console.warn(`[mcp] SSE server "${name}" is missing url, skipping`);
          continue;
        }
        const sseConfig: McpSSEServerConfig = {
          type: 'sse',
          url: config.url,
        };
        if (config.headers && Object.keys(config.headers).length > 0) {
          sseConfig.headers = config.headers;
        }
        result[name] = sseConfig;
        break;
      }

      case 'http': {
        if (!config.url) {
          console.warn(`[mcp] HTTP server "${name}" is missing url, skipping`);
          continue;
        }
        const httpConfig: McpHttpServerConfig = {
          type: 'http',
          url: config.url,
        };
        if (config.headers && Object.keys(config.headers).length > 0) {
          httpConfig.headers = config.headers;
        }
        result[name] = httpConfig;
        break;
      }

      case 'stdio':
      default: {
        if (!config.command) {
          console.warn(`[mcp] stdio server "${name}" is missing command, skipping`);
          continue;
        }
        const stdioConfig: McpStdioServerConfig = {
          command: config.command,
          args: config.args,
          env: config.env,
        };
        result[name] = stdioConfig;
        break;
      }
    }
  }
  return result;
}

/**
 * Format an SSE line from an event object
 */
function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
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

/**
 * Stream Claude responses using the Agent SDK.
 * Returns a ReadableStream of SSE-formatted strings.
 */
/**
 * Get file paths for non-image attachments. If the file already has a
 * persisted filePath (written by the uploads route), reuse it. Otherwise
 * fall back to writing the file to .codepilot-uploads/.
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
        uploadDir = path.join(workDir, '.codepilot-uploads');
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

/**
 * Build a context-enriched prompt by prepending conversation history.
 * Used when SDK session resume is unavailable or fails.
 */
function buildPromptWithHistory(
  prompt: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
): string {
  if (!history || history.length === 0) return prompt;

  const lines: string[] = ['<conversation_history>'];
  for (const msg of history) {
    // For assistant messages with tool blocks (JSON arrays), summarize
    let content = msg.content;
    if (msg.role === 'assistant' && content.startsWith('[')) {
      try {
        const blocks = JSON.parse(content);
        const parts: string[] = [];
        for (const b of blocks) {
          if (b.type === 'text' && b.text) parts.push(b.text);
          else if (b.type === 'tool_use') parts.push(`[Used tool: ${b.name}]`);
          else if (b.type === 'tool_result') {
            const resultStr = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            // Truncate long tool results
            parts.push(`[Tool result: ${resultStr.slice(0, 500)}${resultStr.length > 500 ? '...' : ''}]`);
          }
        }
        content = parts.join('\n');
      } catch {
        // Not JSON, use as-is
      }
    }
    lines.push(`${msg.role === 'user' ? 'Human' : 'Assistant'}: ${content}`);
  }
  lines.push('</conversation_history>');
  lines.push('');
  lines.push(prompt);
  return lines.join('\n');
}

export function streamClaude(options: ClaudeStreamOptions): ReadableStream<string> {
  const {
    prompt,
    sessionId,
    sdkSessionId,
    model,
    systemPrompt,
    workingDirectory,
    mcpServers,
    abortController,
    permissionMode,
    files,
    toolTimeoutSeconds = 0,
    conversationHistory,
    onRuntimeStatusChange,
  } = options;

  return new ReadableStream<string>({
    async start(controller) {
      const perfStart = Date.now();
      console.log('[perf] streamClaude start');

      // Hoist activeProvider so it's accessible in the catch block for error messages
      const activeProvider: ApiProvider | undefined = options.provider ?? getActiveProvider();
      console.log('[claude-client] activeProvider:', activeProvider ? `${activeProvider.name} (${activeProvider.base_url})` : 'undefined');

      // Hoist execPath override vars so they're accessible in the finally block
      const originalExecPath = process.execPath;
      let systemNode: string | undefined;

      try {
        // Build env for the Claude Code subprocess.
        // Start with process.env (includes user shell env from Electron's loadUserShellEnv).
        // Then overlay any API config the user set in Lumos settings (optional).
        const sdkEnv: Record<string, string> = { ...process.env as Record<string, string> };

        // Ensure HOME/USERPROFILE are set so Claude Code can find ~/.claude/commands/
        if (!sdkEnv.HOME) sdkEnv.HOME = os.homedir();
        if (!sdkEnv.USERPROFILE) sdkEnv.USERPROFILE = os.homedir();
        // Ensure SDK subprocess has expanded PATH (consistent with Electron mode)
        sdkEnv.PATH = getExpandedPath();

        // When running inside Electron, process.execPath is the Electron binary.
        // The SDK uses process.execPath to fork the CLI subprocess, but Electron's
        // Node.js runtime lacks web globals like ReadableStream, causing the CLI to
        // crash with "ReferenceError: ReadableStream is not defined".
        // Setting ELECTRON_RUN_AS_NODE=1 makes the Electron binary behave as plain
        // Node.js in child processes, restoring all expected globals.
        sdkEnv.ELECTRON_RUN_AS_NODE = '1';

        // === ISOLATION: Clear all user environment variables ===
        // Remove all CLAUDE_* and ANTHROPIC_* variables from user's environment
        // to prevent pollution from user's local Claude Code installation.
        // We'll re-inject only what Lumos needs below.
        for (const key of Object.keys(sdkEnv)) {
          if (key.startsWith('CLAUDE_') || key.startsWith('ANTHROPIC_')) {
            delete sdkEnv[key];
          }
        }

        // On Windows, auto-detect Git Bash if not already configured
        if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
          const gitBashPath = findGitBash();
          if (gitBashPath) {
            sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
          }
        }

        // Sandbox: isolate CLI config directory so it doesn't read/write ~/.claude/
        const claudeConfigDir = process.env.LUMOS_CLAUDE_CONFIG_DIR || process.env.CODEPILOT_CLAUDE_CONFIG_DIR;
        if (claudeConfigDir) {
          sdkEnv.CLAUDE_CONFIG_DIR = claudeConfigDir;
          console.log('[claude-client] Isolation: using config dir:', claudeConfigDir);
          if (process.env.CODEPILOT_CLAUDE_CONFIG_DIR && !process.env.LUMOS_CLAUDE_CONFIG_DIR) {
            console.warn('[claude-client] CODEPILOT_CLAUDE_CONFIG_DIR is deprecated. Please use LUMOS_CLAUDE_CONFIG_DIR instead.');
          }
        } else {
          console.warn('[claude-client] WARNING: LUMOS_CLAUDE_CONFIG_DIR not set, may use user ~/.claude/');
        }

        if (activeProvider && activeProvider.api_key) {
          // Inject provider config — set both token variants so extra_env can clear the unwanted one
          sdkEnv.ANTHROPIC_AUTH_TOKEN = activeProvider.api_key;
          sdkEnv.ANTHROPIC_API_KEY = activeProvider.api_key;
          if (activeProvider.base_url) {
            sdkEnv.ANTHROPIC_BASE_URL = activeProvider.base_url;
          }

          // Inject extra environment variables
          // Empty string values mean "delete this variable" (e.g. clear ANTHROPIC_API_KEY for AUTH_TOKEN-only providers)
          try {
            const extraEnv = JSON.parse(activeProvider.extra_env || '{}');
            for (const [key, value] of Object.entries(extraEnv)) {
              if (typeof value === 'string') {
                if (value === '') {
                  delete sdkEnv[key];
                } else {
                  sdkEnv[key] = value;
                }
              }
            }
          } catch {
            // ignore malformed extra_env
          }
        } else {
          // No active provider — check legacy DB settings first, then fall back to
          // environment variables already present in process.env (copied into sdkEnv above).
          // This allows users who set ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL
          // in their shell environment to use them without configuring a provider in the UI.
          const appToken = getSetting('anthropic_auth_token');
          const appBaseUrl = getSetting('anthropic_base_url');
          if (appToken) {
            sdkEnv.ANTHROPIC_AUTH_TOKEN = appToken;
          }
          if (appBaseUrl) {
            sdkEnv.ANTHROPIC_BASE_URL = appBaseUrl;
          }
          // If neither legacy settings nor env vars provide a key, log a warning
          if (!appToken && !sdkEnv.ANTHROPIC_API_KEY && !sdkEnv.ANTHROPIC_AUTH_TOKEN) {
            console.warn('[claude-client] No API key found: no active provider, no legacy settings, and no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN in environment');
          }
        }

        // Check if dangerously_skip_permissions is enabled in app settings
        const skipPermissions = getSetting('dangerously_skip_permissions') === 'true';

        const queryOptions: Options = {
          cwd: workingDirectory || os.homedir(),
          abortController,
          includePartialMessages: true,
          permissionMode: skipPermissions
            ? 'bypassPermissions'
            : ((permissionMode as Options['permissionMode']) || 'acceptEdits'),
          env: sanitizeEnv(sdkEnv),
          // === ISOLATION: Prevent loading user's ~/.claude/ config ===
          // settingSources: [] means the SDK won't read:
          // - ~/.claude/settings.json (user's global settings)
          // - ~/.claude.json (user's global MCP servers)
          // - .claude/settings.json (project settings)
          // - .claude.json (project MCP servers)
          // All config (API key, MCP servers, skills, hooks) must be injected
          // programmatically via this Options object.
          settingSources: [],
        };

        if (skipPermissions) {
          queryOptions.allowDangerouslySkipPermissions = true;
        }

        // --- Sandbox mode: always use the SDK's bundled CLI ---
        // In packaged Electron apps, process.execPath is the Electron binary
        // which lacks web globals (ReadableStream etc.) that the CLI needs.
        // We override process.execPath to the system `node` so the SDK forks
        // the CLI with a proper Node.js runtime. The bundled CLI ensures the
        // app is self-contained and doesn't depend on a system-installed
        // Claude Code CLI.
        const bundledCli = findBundledCliPath();
        if (bundledCli) {
          queryOptions.pathToClaudeCodeExecutable = bundledCli;
          console.log('[claude-client] Sandbox: using bundled CLI:', bundledCli);
        } else {
          // Fallback: try system CLI (dev mode or bundled CLI missing)
          const claudePath = findClaudeBinary();
          if (claudePath) {
            const ext = path.extname(claudePath).toLowerCase();
            if (ext === '.cmd' || ext === '.bat') {
              const scriptPath = resolveScriptFromCmd(claudePath);
              if (scriptPath) {
                queryOptions.pathToClaudeCodeExecutable = scriptPath;
                console.log('[claude-client] Using system CLI (resolved from .cmd):', scriptPath);
              }
            } else {
              queryOptions.pathToClaudeCodeExecutable = claudePath;
              console.log('[claude-client] Using system CLI:', claudePath);
            }
          } else {
            console.warn('[claude-client] WARNING: No Claude CLI found (bundled or system)');
          }
        }

        if (model) {
          queryOptions.model = model;
        }

        // Knowledge base context injection (only if enabled)
        let kbContext = '';
        const kbEnabled = getSetting('kb_context_enabled') === 'true';
        if (kbEnabled) {
          try {
            console.time('[perf] KB search');
            const kbResults = await searchAll(prompt, 3);
            kbContext = buildContext(kbResults);
            console.timeEnd('[perf] KB search');
          } catch (err) {
            console.warn('[claude-client] KB search failed:', err);
          }
        }

        const fullSystemPrompt = [systemPrompt, kbContext].filter(Boolean).join('\n\n');
        if (fullSystemPrompt) {
          queryOptions.systemPrompt = {
            type: 'preset',
            preset: 'claude_code',
            append: fullSystemPrompt,
          };
        }

        // Check if we should resume session (needed for MCP config decision)
        let shouldResume = !!sdkSessionId;
        if (shouldResume && workingDirectory && !fs.existsSync(workingDirectory)) {
          console.warn(`[claude-client] Working directory "${workingDirectory}" does not exist, skipping resume`);
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
        // With settingSources: [], the SDK won't load user's ~/.claude.json
        // or ~/.claude/settings.json, so no user MCP servers will be loaded.
        // IMPORTANT: Only pass MCP config on first message (not when resuming)
        // to avoid restarting MCP servers on every message.
        if (!shouldResume && mcpServers && Object.keys(mcpServers).length > 0) {
          queryOptions.mcpServers = toSdkMcpConfig(mcpServers);
          console.log('[claude-client] Loading MCP servers:', Object.keys(mcpServers));
        } else if (shouldResume) {
          console.log('[claude-client] Resuming session, reusing existing MCP connections');
        }

        // === ISOLATION: Skills ===
        // Load enabled skills from database via plugin system.
        // With settingSources: [], the SDK won't load user's global ~/.claude/skills/.
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

        // Resume session configuration (shouldResume already defined above)
        if (shouldResume) {
          queryOptions.resume = sdkSessionId;
          console.log('[claude-client] Attempting to resume session:', sdkSessionId);
        }

        // Permission handler: sends SSE event and waits for user response
        queryOptions.canUseTool = async (toolName, input, opts) => {
          // Auto-approve built-in MCP server tools (e.g. feishu)
          if (toolName.startsWith('mcp__feishu__')) {
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
        // When NOT resuming (fresh or fallback), prepend DB history for context.
        function buildFinalPrompt(useHistory: boolean): string | AsyncIterable<SDKUserMessage> {
          const basePrompt = useHistory
            ? buildPromptWithHistory(prompt, conversationHistory)
            : prompt;

          if (!files || files.length === 0) return basePrompt;

          const imageFiles = files.filter(f => isImageFile(f.type));
          const nonImageFiles = files.filter(f => !isImageFile(f.type));

          let textPrompt = basePrompt;
          if (nonImageFiles.length > 0) {
            const workDir = workingDirectory || os.homedir();
            const savedPaths = getUploadedFilePaths(nonImageFiles, workDir);
            const fileReferences = savedPaths
              .map((p, i) => `[User attached file: ${p} (${nonImageFiles[i].name})]`)
              .join('\n');
            textPrompt = `${fileReferences}\n\nPlease read the attached file(s) above using your Read tool, then respond to the user's message:\n\n${basePrompt}`;
          }

          if (imageFiles.length > 0) {
            // Append image disk paths to the text prompt so Claude knows where
            // the files are on disk (enables skills to reference them by path).
            const workDir = workingDirectory || os.homedir();
            const imagePaths = getUploadedFilePaths(imageFiles, workDir);
            const imageReferences = imagePaths
              .map((p, i) => `[User attached image: ${p} (${imageFiles[i].name})]`)
              .join('\n');
            const textWithImageRefs = `${imageReferences}\n\n${textPrompt}`;

            const contentBlocks: Array<
              | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
              | { type: 'text'; text: string }
            > = [];

            for (const img of imageFiles) {
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: img.type || 'image/png',
                  data: img.data,
                },
              });
            }

            contentBlocks.push({ type: 'text', text: textWithImageRefs });

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

          return textPrompt;
        }

        let finalPrompt = buildFinalPrompt(!shouldResume);

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
        let conversation = query({
          prompt: finalPrompt,
          options: queryOptions,
        });

        // Wrap the iterator so we can detect resume failures on the first message
        if (shouldResume) {
          try {
            // Peek at the first message to verify resume works
            const iter = conversation[Symbol.asyncIterator]();
            const first = await iter.next();

            // Re-wrap into an async iterable that yields the first message then the rest
            conversation = (async function* () {
              if (!first.done) yield first.value;
              while (true) {
                const next = await iter.next();
                if (next.done) break;
                yield next.value;
              }
            })() as ReturnType<typeof query>;
          } catch (resumeError) {
            const errMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
            console.warn('[claude-client] Resume failed, retrying without resume:', errMsg);
            // Clear stale sdk_session_id so future messages don't retry this broken resume
            if (sessionId) {
              try { updateSdkSessionId(sessionId, ''); } catch { /* best effort */ }
            }
            // Notify frontend about the fallback
            controller.enqueue(formatSSE({
              type: 'status',
              data: JSON.stringify({
                notification: true,
                title: 'Session fallback',
                message: 'Previous session could not be resumed. Starting fresh conversation.',
              }),
            }));
            // Remove resume and try again as a fresh conversation with history context
            delete queryOptions.resume;
            conversation = query({
              prompt: buildFinalPrompt(true),
              options: queryOptions,
            });
          }
        }

        registerConversation(sessionId, conversation);

        let lastAssistantText = '';
        let tokenUsage: TokenUsage | null = null;
        let firstMessageReceived = false;

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
              const assistantMsg = message as SDKAssistantMessage;
              // Text deltas are handled by stream_event for real-time streaming.
              // Only track lastAssistantText here and process tool_use blocks.
              const text = extractTextFromMessage(assistantMsg);
              if (text) {
                lastAssistantText = text;
              }

              // Check for tool use blocks
              for (const block of assistantMsg.message.content) {
                if (block.type === 'tool_use') {
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
              // Tool execution results come back as user messages with tool_result blocks
              const userMsg = message as SDKUserMessage;
              const content = userMsg.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_result') {
                    const resultContent = typeof block.content === 'string'
                      ? block.content
                      : Array.isArray(block.content)
                        ? block.content
                            .filter((c: { type: string }) => c.type === 'text')
                            .map((c: { text: string }) => c.text)
                            .join('\n')
                        : String(block.content ?? '');
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

            case 'result': {
              const resultMsg = message as SDKResultMessage;
              tokenUsage = extractTokenUsage(resultMsg);

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

        controller.enqueue(formatSSE({ type: 'done', data: '' }));
        controller.close();
      } catch (error) {
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

        // Provide more specific error messages based on error type
        if (error instanceof Error) {
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
              base_url: activeProvider?.base_url || 'default (https://api.anthropic.com)',
              api_key_set: !!activeProvider?.api_key,
              api_key_length: activeProvider?.api_key?.length || 0,
              api_key_prefix: activeProvider?.api_key ? activeProvider.api_key.substring(0, 10) + '...' : 'not set',
            };

            // Log to server console
            console.error('[claude-client] Claude API call failed with exit code 1');
            console.error('[claude-client] Provider configuration:', configInfo);

            // Include config info in error message for user
            const configDetails = `\n\n📋 Current Configuration:\n• Provider: ${configInfo.provider}\n• Model: ${configInfo.model}\n• Base URL: ${configInfo.base_url}\n• API Key: ${configInfo.api_key_set ? `Set (${configInfo.api_key_length} chars, prefix: ${configInfo.api_key_prefix})` : 'NOT SET ❌'}`;

            errorMessage = `Claude Code process exited with an error${providerHint}. This is often caused by:\n• Invalid or missing API Key\n• Incorrect Base URL configuration\n• Network connectivity issues${detailHint}${configDetails}\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('exited with code')) {
            const providerHint = activeProvider?.name ? ` (Provider: ${activeProvider.name})` : '';
            errorMessage = `Claude Code process crashed unexpectedly${providerHint}.\n\nOriginal error: ${rawMessage}`;
          } else if (code === 'ECONNREFUSED' || rawMessage.includes('ECONNREFUSED') || rawMessage.includes('fetch failed')) {
            const baseUrl = activeProvider?.base_url || 'default';
            errorMessage = `Cannot connect to API endpoint (${baseUrl}). Please check your network connection and Base URL configuration.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('401') || rawMessage.includes('Unauthorized') || rawMessage.includes('authentication')) {
            const providerHint = activeProvider?.name ? ` for provider "${activeProvider.name}"` : '';
            errorMessage = `Authentication failed${providerHint}. Please verify your API Key is correct and has not expired.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('403') || rawMessage.includes('Forbidden')) {
            errorMessage = `Access denied. Your API Key may not have permission for this operation.\n\nOriginal error: ${rawMessage}`;
          } else if (rawMessage.includes('429') || rawMessage.includes('rate limit') || rawMessage.includes('Rate limit')) {
            errorMessage = `Rate limit exceeded. Please wait a moment before retrying.\n\nOriginal error: ${rawMessage}`;
          }
        }

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
