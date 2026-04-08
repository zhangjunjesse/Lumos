/**
 * Unified MCP server resolution pipeline.
 *
 * Single source of truth for loading MCP servers from DB, resolving paths,
 * injecting runtime env vars, and converting to SDK format.
 *
 * Used by: chat route, conversation-engine, stage-worker.
 */
import os from 'os';
import path from 'path';
import type {
  McpServerConfig,
  McpStdioServerConfig,
  McpSSEServerConfig,
  McpHttpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import { getEnabledMcpServersAsConfig, dataDir } from '@/lib/db';
import type { MCPServerConfig } from '@/types';
import { ENRICHER_MAP, type McpEnrichContext } from '@/lib/mcp-env-enrichers';
import { getVenvPythonPath } from '@/lib/python-venv';
import { resolvePythonBinary } from '@/lib/python-runtime';

export interface McpResolveOptions {
  sessionWorkingDirectory?: string;
  sessionId?: string;
  /** Browser bridge info from HTTP request headers (chat route only). */
  browserBridgeOverride?: { url?: string; token?: string };
  /** MCP names to skip (e.g. chat route skips 'task-management'). */
  skipNames?: Set<string>;
  /** When true, browser MCP operates in background mode (no UI tab switching). */
  browserBackground?: boolean;
}

// Re-export enricher utilities that callers may need
export { readBrowserBridgeFromRuntimeFile } from '@/lib/mcp-env-enrichers';

// ---------------------------------------------------------------------------
// Pipeline: load → resolve paths → enrich env → filter → return
// ---------------------------------------------------------------------------

/** Load enabled MCP servers from DB, resolve paths & env, return Lumos-typed config. */
export function resolveEnabledMcpServers(
  options: McpResolveOptions = {},
): Record<string, MCPServerConfig> | undefined {
  const mcpServers = getEnabledMcpServersAsConfig();
  if (Object.keys(mcpServers).length === 0) return undefined;

  // Build resolution context (once per call)
  const runtimePath = resolveRuntimePath();
  const workspacePath = options.sessionWorkingDirectory || process.cwd();
  const pythonPath = resolvePythonBinary() || getVenvPythonPath();
  const enrichContext: McpEnrichContext = {
    sessionWorkingDirectory: options.sessionWorkingDirectory,
    sessionId: options.sessionId,
    dataDir,
    browserBridgeOverride: options.browserBridgeOverride,
    browserBackground: options.browserBackground,
  };

  const legacyMcpPathPattern = /[/\\]feishu-mcp-server[/\\]mcp-servers[/\\]/g;
  const normalizedMcpPathSegment = `${path.sep}mcp-servers${path.sep}`;

  for (const [name, config] of Object.entries(mcpServers)) {
    // Step 0: Skip excluded MCPs
    if (options.skipNames?.has(name)) {
      delete mcpServers[name];
      continue;
    }

    // Step 1a: Resolve path placeholders in command
    if (config.command) {
      config.command = config.command
        .replace('[RUNTIME_PATH]', runtimePath)
        .replace('[PYTHON_PATH]', pythonPath)
        .replace('[DATA_DIR]', dataDir)
        .replace(/^~\//, os.homedir() + '/');
    }

    // Step 1b: Resolve path placeholders in args
    if (config.args) {
      config.args = config.args.map(arg => {
        const normalized = arg.replace(legacyMcpPathPattern, normalizedMcpPathSegment);
        return normalized
          .replace('[RUNTIME_PATH]', runtimePath)
          .replace('[WORKSPACE_PATH]', workspacePath)
          .replace('[DATA_DIR]', dataDir)
          .replace('[PYTHON_PATH]', pythonPath)
          .replace(/^~\//, os.homedir() + '/');
      });
    }

    // Step 2: Resolve path placeholders in env
    if (config.env) {
      const resolved: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.env)) {
        resolved[key] = value
          .replace('[RUNTIME_PATH]', runtimePath)
          .replace('[WORKSPACE_PATH]', workspacePath)
          .replace('[DATA_DIR]', dataDir)
          .replace('[PYTHON_PATH]', pythonPath)
          .replace(/^~\//, os.homedir() + '/');
      }
      config.env = resolved;
    }

    // Step 3: Apply enricher (per-MCP runtime env injection)
    const enricher = ENRICHER_MAP[name];
    if (enricher) {
      try {
        config.env = enricher(config.env || {}, enrichContext);
      } catch (err) {
        console.warn(`[mcp-resolver] enricher failed for "${name}":`, err);
      }
    }
  }

  return Object.keys(mcpServers).length > 0 ? mcpServers : undefined;
}

// ---------------------------------------------------------------------------
// SDK format converter
// ---------------------------------------------------------------------------

/** Convert Lumos MCPServerConfig → SDK McpServerConfig discriminated union. */
export function toSdkMcpConfig(
  servers: Record<string, MCPServerConfig>,
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
        const sse: McpSSEServerConfig = { type: 'sse', url: config.url };
        if (config.headers && Object.keys(config.headers).length > 0) sse.headers = config.headers;
        result[name] = sse;
        break;
      }
      case 'http': {
        if (!config.url) {
          console.warn(`[mcp] HTTP server "${name}" is missing url, skipping`);
          continue;
        }
        const http: McpHttpServerConfig = { type: 'http', url: config.url };
        if (config.headers && Object.keys(config.headers).length > 0) http.headers = config.headers;
        result[name] = http;
        break;
      }
      case 'stdio':
      default: {
        if (!config.command) {
          console.warn(`[mcp] stdio server "${name}" is missing command, skipping`);
          continue;
        }
        const stdio: McpStdioServerConfig = { command: config.command, args: config.args, env: config.env };
        result[name] = stdio;
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveRuntimePath(): string {
  if (process.env.NODE_ENV === 'production' && typeof process.resourcesPath === 'string') {
    return process.resourcesPath;
  }
  return path.join(process.cwd(), 'resources');
}
