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
import { getVenvPythonPath, isVenvReady } from '@/lib/python-venv';
import { resolvePythonBinary } from '@/lib/python-runtime';
import { resolveRuntimeResourceRootFor } from '@/lib/runtime-resources';
import {
  resolveMcpConfigPlaceholders,
  type McpPlaceholderContext,
} from '@/lib/mcp-config-placeholders';

export interface McpResolveOptions {
  sessionWorkingDirectory?: string;
  sessionId?: string;
  /** Browser bridge info from HTTP request headers (chat route only). */
  browserBridgeOverride?: { url?: string; token?: string; browserContextId?: string };
  /** Browser context routed through the bridge. Defaults to the embedded browser. */
  browserContextId?: string;
  /** MCP names to skip when loading. */
  skipNames?: Set<string>;
  /** When true, browser MCP operates in background mode (no UI tab switching). */
  browserBackground?: boolean;
}

// Re-export enricher utilities that callers may need
export { readBrowserBridgeFromRuntimeFile } from '@/lib/mcp-env-enrichers';

function normalizeMcpArgsForRuntime(args: unknown): string[] {
  if (Array.isArray(args)) return args.map((arg) => String(arg));
  if (typeof args === 'string' && args.trim()) return [args];
  return [];
}

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
  // [PYTHON_PATH] must resolve to the lumos venv when it's ready — that's where
  // pip packages required by Python MCPs (mcp[cli], zstandard, etc.) live.
  // System python is only the fallback for first-run before venv exists.
  const pythonPath = isVenvReady()
    ? getVenvPythonPath()
    : (resolvePythonBinary() || getVenvPythonPath());
  const placeholderContext: McpPlaceholderContext = {
    runtimePath,
    workspacePath,
    dataDir,
    pythonPath,
    userHome: os.homedir(),
  };
  const enrichContext: McpEnrichContext = {
    sessionWorkingDirectory: options.sessionWorkingDirectory,
    sessionId: options.sessionId,
    dataDir,
    browserBridgeOverride: options.browserBridgeOverride,
    browserContextId: options.browserContextId,
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
      config.command = resolveMcpConfigPlaceholders(config.command, placeholderContext);
    }

    // Step 1b: Resolve path placeholders in args
    const normalizedArgs = normalizeMcpArgsForRuntime(config.args);
    if (normalizedArgs.length > 0) {
      config.args = normalizedArgs.map(arg => {
        const normalized = arg.replace(legacyMcpPathPattern, normalizedMcpPathSegment);
        return resolveMcpConfigPlaceholders(normalized, placeholderContext);
      });
    } else {
      delete config.args;
    }

    // Step 2: Resolve path placeholders in env
    if (config.env) {
      const resolved: Record<string, string> = {};
      for (const [key, value] of Object.entries(config.env)) {
        resolved[key] = resolveMcpConfigPlaceholders(value, placeholderContext);
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
    const sdkName = toSdkMcpServerName(name);
    const transport = config.type || 'stdio';
    switch (transport) {
      case 'sse': {
        if (!config.url) {
          console.warn(`[mcp] SSE server "${name}" is missing url, skipping`);
          continue;
        }
        const sse: McpSSEServerConfig = { type: 'sse', url: config.url };
        if (config.headers && Object.keys(config.headers).length > 0) sse.headers = config.headers;
        result[sdkName] = sse;
        break;
      }
      case 'http': {
        if (!config.url) {
          console.warn(`[mcp] HTTP server "${name}" is missing url, skipping`);
          continue;
        }
        const http: McpHttpServerConfig = { type: 'http', url: config.url };
        if (config.headers && Object.keys(config.headers).length > 0) http.headers = config.headers;
        result[sdkName] = http;
        break;
      }
      case 'stdio':
      default: {
        if (!config.command) {
          console.warn(`[mcp] stdio server "${name}" is missing command, skipping`);
          continue;
        }
        const args = normalizeMcpArgsForRuntime(config.args);
        const stdio: McpStdioServerConfig = {
          command: config.command,
          env: config.env,
        };
        if (args.length > 0) stdio.args = args;
        result[sdkName] = stdio;
        break;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toSdkMcpServerName(name: string): string {
  if (name === 'chrome-devtools') {
    return 'chrome_devtools';
  }
  return name;
}

function resolveRuntimePath(): string {
  return resolveRuntimeResourceRootFor('mcp-servers')
    || resolveRuntimeResourceRootFor('feishu-mcp-server')
    || path.join(process.cwd(), 'resources');
}
