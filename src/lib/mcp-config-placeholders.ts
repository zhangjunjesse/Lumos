import type { MCPServerConfig } from '@/types';

export interface PortableMcpValueContext {
  dataDir?: string;
  homeDir?: string;
}

export interface McpPlaceholderContext {
  runtimePath: string;
  workspacePath: string;
  dataDir: string;
  pythonPath: string;
  userHome: string;
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/');
}

function replacePathPrefix(value: string, prefix: string | undefined, placeholder: string): string {
  if (!prefix) return value;

  const normalizedValue = normalizePathSeparators(value);
  const normalizedPrefix = normalizePathSeparators(prefix).replace(/\/+$/, '');
  if (!normalizedPrefix) return value;

  if (normalizedValue === normalizedPrefix) {
    return placeholder;
  }

  if (normalizedValue.startsWith(`${normalizedPrefix}/`)) {
    return `${placeholder}/${normalizedValue.slice(normalizedPrefix.length + 1)}`;
  }

  return value;
}

export function normalizePortableMcpValue(
  value: string,
  context: PortableMcpValueContext = {},
): string {
  let next = value
    .replace(/\$\{DATA_DIR\}/g, '[DATA_DIR]')
    .replace(/\[LUMOS_HOME\]|\$\{LUMOS_HOME\}/g, '[DATA_DIR]');

  const mcpScriptMatch = next.match(/^(?:[a-zA-Z]:)?[\\/].*[\\/]mcp-scripts[\\/](.+)$/);
  if (mcpScriptMatch?.[1]) {
    return `[DATA_DIR]/mcp-scripts/${normalizePathSeparators(mcpScriptMatch[1])}`;
  }

  next = replacePathPrefix(next, context.dataDir, '[DATA_DIR]');
  next = replacePathPrefix(next, context.homeDir, '${USER_HOME}');
  return next;
}

export function normalizePortableMcpMap(
  input: Record<string, string> | undefined,
  context: PortableMcpValueContext = {},
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input || {}).map(([key, value]) => [
      key,
      normalizePortableMcpValue(String(value ?? ''), context),
    ]),
  );
}

export function normalizePortableMcpConfig(
  config: MCPServerConfig,
  context: PortableMcpValueContext = {},
): MCPServerConfig {
  return {
    command: normalizePortableMcpValue(config.command || '', context),
    args: Array.isArray(config.args)
      ? config.args.map((arg) => normalizePortableMcpValue(String(arg), context))
      : [],
    env: normalizePortableMcpMap(config.env, context),
    type: config.type || 'stdio',
    runMode: config.runMode || 'on_demand',
    runtime: config.runtime || 'auto',
    url: config.url ? normalizePortableMcpValue(config.url, context) : undefined,
    headers: normalizePortableMcpMap(config.headers, context),
    description: config.description,
  };
}

export function resolveMcpConfigPlaceholders(value: string, context: McpPlaceholderContext): string {
  return value
    .replace(/\[RUNTIME_PATH\]|\$\{RUNTIME_PATH\}/g, context.runtimePath)
    .replace(/\[WORKSPACE_PATH\]|\$\{WORKSPACE_PATH\}/g, context.workspacePath)
    .replace(/\[DATA_DIR\]|\$\{DATA_DIR\}|\[LUMOS_HOME\]|\$\{LUMOS_HOME\}/g, context.dataDir)
    .replace(/\[PYTHON_PATH\]|\$\{PYTHON_PATH\}/g, context.pythonPath)
    .replace(/\[USER_HOME\]|\$\{USER_HOME\}/g, context.userHome)
    .replace(/^~(?=$|[/\\])/, context.userHome);
}
