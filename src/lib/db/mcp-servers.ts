import crypto from 'crypto';
import type { MCPServerConfig } from '@/types';
import { getDb } from './connection';
import { getMcpOAuthToken } from './mcp-oauth';
import { recordMemoryV2CapabilityEvent } from '@/lib/memory-v2/capability-events';

// ==========================================
// MCP Server Database Types
// ==========================================

export interface McpServerRecord {
  id: string;
  name: string;
  command: string;
  args: string; // JSON array
  env: string; // JSON object
  type: string; // 'stdio' | 'sse' | 'http'
  run_mode: 'on_demand' | 'keep_alive';
  runtime_kind: 'auto' | 'node' | 'python' | 'bun' | 'custom';
  url: string;
  headers: string; // JSON object
  is_enabled: number;
  scope: 'builtin' | 'user';
  source: string;
  content_hash: string;
  description: string;
  health_status: 'unknown' | 'ok' | 'failed' | 'skipped';
  health_checked_at: string;
  health_error: string;
  health_message: string;
  health_tools: string;
  health_transport: string;
  created_at: string;
  updated_at: string;
}

export interface McpServerHealthData {
  status: 'unknown' | 'ok' | 'failed' | 'skipped';
  checked_at?: string;
  error?: string;
  message?: string;
  tools?: string[];
  transport?: 'stdio' | 'sse' | 'http';
}

export interface CreateMcpServerData {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  runMode?: 'on_demand' | 'keep_alive';
  runtime?: 'auto' | 'node' | 'python' | 'bun' | 'custom';
  url?: string;
  headers?: Record<string, string>;
  is_enabled?: boolean;
  scope: 'builtin' | 'user';
  source?: string;
  content_hash?: string;
  description?: string;
}

export interface UpdateMcpServerData {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  runMode?: 'on_demand' | 'keep_alive';
  runtime?: 'auto' | 'node' | 'python' | 'bun' | 'custom';
  url?: string;
  headers?: Record<string, string>;
  is_enabled?: boolean;
  description?: string;
  source?: string;
  content_hash?: string;
}

// ==========================================
// Helper Functions
// ==========================================

export function parseMcpStringArray(raw: string | undefined | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
    if (typeof parsed === 'string' && parsed.trim()) return [parsed];
    return [];
  } catch {
    return [];
  }
}

export function parseMcpStringMap(raw: string | undefined | null): Record<string, string> {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')])
    );
  } catch {
    return {};
  }
}

function normalizeMcpStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function normalizeMcpStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, String(item ?? '')])
  );
}

export function mcpServerRecordToConfig(record: McpServerRecord): MCPServerConfig {
  const config: MCPServerConfig = {
    command: record.command,
  };

  const args = parseMcpStringArray(record.args);
  if (args.length > 0) config.args = args;

  const env = parseMcpStringMap(record.env);
  if (Object.keys(env).length > 0) config.env = env;

  const type = record.type || 'stdio';
  if (type !== 'stdio') config.type = type as 'sse' | 'http';
  config.runMode = record.run_mode || 'on_demand';
  config.runtime = record.runtime_kind || 'auto';

  if (record.url) config.url = record.url;

  const headers = parseMcpStringMap(record.headers);
  const authorized = applyOAuthHeader(record, headers);
  if (Object.keys(authorized).length > 0) config.headers = authorized;

  return config;
}

/**
 * 给已授权的远程 MCP 注入 Bearer。
 *
 * 放在这里是因为它是所有运行路径(chat / workflow / bridge)的必经之地 ——
 * 换句话说,不存在"某条路径忘了带令牌"的可能。
 *
 * 用户手填的 Authorization 优先:那是明确的人工意图,不该被自动令牌盖掉。
 * 令牌的新鲜度由 ensureFreshMcpOAuthTokens() 在会话启动前保证,这里只读。
 */
function applyOAuthHeader(
  record: McpServerRecord,
  headers: Record<string, string>,
): Record<string, string> {
  if (!record.url) return headers;
  const hasManualAuth = Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');
  if (hasManualAuth) return headers;
  try {
    const token = getMcpOAuthToken(record.id);
    if (!token) return headers;
    return { ...headers, Authorization: `Bearer ${token.accessToken}` };
  } catch {
    // 表缺失等异常不该让整个 MCP 加载失败
    return headers;
  }
}

function shouldResetHealth(data: UpdateMcpServerData): boolean {
  return data.command !== undefined
    || data.args !== undefined
    || data.env !== undefined
    || data.type !== undefined
    || data.runMode !== undefined
    || data.runtime !== undefined
    || data.url !== undefined
    || data.headers !== undefined;
}

// ==========================================
// MCP Server Operations
// ==========================================

export function getAllMcpServers(): McpServerRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM mcp_servers ORDER BY scope ASC, name ASC').all() as McpServerRecord[];
}

export function getMcpServersByScope(scope: 'builtin' | 'user'): McpServerRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM mcp_servers WHERE scope = ? ORDER BY name ASC').all(scope) as McpServerRecord[];
}

export function getEnabledMcpServers(): McpServerRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM mcp_servers WHERE is_enabled = 1 ORDER BY scope ASC, name ASC').all() as McpServerRecord[];
}

export function getMcpServer(id: string): McpServerRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRecord | undefined;
}

export function getMcpServerByNameAndScope(name: string, scope: 'builtin' | 'user'): McpServerRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM mcp_servers WHERE name = ? AND scope = ?').get(name, scope) as McpServerRecord | undefined;
}

export function createMcpServer(data: CreateMcpServerData): McpServerRecord {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    'INSERT INTO mcp_servers (id, name, command, args, env, type, run_mode, runtime_kind, url, headers, is_enabled, scope, source, content_hash, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.command,
    JSON.stringify(normalizeMcpStringArray(data.args)),
    JSON.stringify(normalizeMcpStringMap(data.env)),
    data.type || 'stdio',
    data.runMode || 'on_demand',
    data.runtime || 'auto',
    data.url || '',
    JSON.stringify(normalizeMcpStringMap(data.headers)),
    data.is_enabled ? 1 : 0,
    data.scope,
    data.source || 'manual',
    data.content_hash || '',
    data.description || '',
    now,
    now,
  );

  const record = getMcpServer(id)!;
  recordMemoryV2CapabilityEvent({
    capabilityType: 'mcp',
    capabilityName: record.name,
    scope: record.scope,
    action: 'created',
    status: 'success',
    source: record.source || (record.scope === 'builtin' ? 'builtin-resource-sync' : 'mcp-manager'),
    summary: record.description,
    relatedId: record.id,
    version: record.content_hash,
    metadata: {
      enabled: record.is_enabled === 1,
      type: record.type,
      runMode: record.run_mode,
      runtime: record.runtime_kind,
    },
  });
  return record;
}

export function updateMcpServer(id: string, data: UpdateMcpServerData): McpServerRecord | undefined {
  const db = getDb();
  const existing = getMcpServer(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const command = data.command ?? existing.command;
  const args = data.args !== undefined ? JSON.stringify(normalizeMcpStringArray(data.args)) : existing.args;
  const env = data.env !== undefined ? JSON.stringify(normalizeMcpStringMap(data.env)) : existing.env;
  const type = data.type ?? existing.type ?? 'stdio';
  const runMode = data.runMode ?? existing.run_mode ?? 'on_demand';
  const runtimeKind = data.runtime ?? existing.runtime_kind ?? 'auto';
  const url = data.url ?? existing.url ?? '';
  const headers = data.headers !== undefined ? JSON.stringify(normalizeMcpStringMap(data.headers)) : (existing.headers || '{}');
  const isEnabled = data.is_enabled !== undefined ? (data.is_enabled ? 1 : 0) : existing.is_enabled;
  const description = data.description ?? existing.description;
  const source = data.source ?? existing.source;
  const contentHash = data.content_hash ?? existing.content_hash;

  if (shouldResetHealth(data)) {
    db.prepare(
      `UPDATE mcp_servers
       SET command = ?, args = ?, env = ?, type = ?, url = ?, headers = ?,
           run_mode = ?, runtime_kind = ?, is_enabled = ?,
           description = ?, source = ?, content_hash = ?,
           health_status = 'unknown',
           health_checked_at = '', health_error = '', health_message = '',
           health_tools = '[]', health_transport = '', updated_at = ?
       WHERE id = ?`
    ).run(command, args, env, type, url, headers, runMode, runtimeKind, isEnabled, description, source, contentHash, now, id);
  } else {
    db.prepare(
      'UPDATE mcp_servers SET command = ?, args = ?, env = ?, type = ?, url = ?, headers = ?, run_mode = ?, runtime_kind = ?, is_enabled = ?, description = ?, source = ?, content_hash = ?, updated_at = ? WHERE id = ?'
    ).run(command, args, env, type, url, headers, runMode, runtimeKind, isEnabled, description, source, contentHash, now, id);
  }

  const updated = getMcpServer(id);
  if (updated) {
    const configChanged = shouldResetHealth(data);
    const enabledChanged = existing.is_enabled !== updated.is_enabled;
    recordMemoryV2CapabilityEvent({
      capabilityType: 'mcp',
      capabilityName: updated.name,
      scope: updated.scope,
      action: configChanged ? 'updated' : enabledChanged ? (updated.is_enabled === 1 ? 'enabled' : 'disabled') : 'updated',
      status: 'success',
      source: updated.source || (updated.scope === 'builtin' ? 'builtin-resource-sync' : 'mcp-manager'),
      summary: updated.description,
      relatedId: updated.id,
      version: updated.content_hash,
      metadata: {
        enabled: updated.is_enabled === 1,
        type: updated.type,
        runMode: updated.run_mode,
        runtime: updated.runtime_kind,
        configChanged,
        healthReset: configChanged,
      },
    });
  }
  return updated;
}

export function updateMcpServerHealth(id: string, data: McpServerHealthData): McpServerRecord | undefined {
  const db = getDb();
  const existing = getMcpServer(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const checkedAt = data.checked_at || now;
  db.prepare(
    `UPDATE mcp_servers
     SET health_status = ?,
         health_checked_at = ?,
         health_error = ?,
         health_message = ?,
         health_tools = ?,
         health_transport = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    data.status,
    checkedAt,
    data.error || '',
    data.message || '',
    JSON.stringify(data.tools || []),
    data.transport || '',
    now,
    id,
  );

  const updated = getMcpServer(id);
  if (updated) {
    recordMemoryV2CapabilityEvent({
      capabilityType: 'mcp',
      capabilityName: updated.name,
      scope: updated.scope,
      action: 'health_checked',
      status: data.status === 'ok' ? 'success' : data.status,
      source: 'mcp-health-check',
      summary: data.message || (data.status === 'ok' ? 'MCP protocol check passed' : 'MCP protocol check did not pass'),
      detail: data.error || data.message || '',
      relatedId: updated.id,
      version: updated.content_hash,
      metadata: {
        type: updated.type,
        transport: data.transport,
        toolsCount: Array.isArray(data.tools) ? data.tools.length : 0,
        tools: Array.isArray(data.tools) ? data.tools.slice(0, 40) : [],
      },
    });
  }
  return updated;
}

export function deleteMcpServer(id: string): boolean {
  const db = getDb();
  const existing = getMcpServer(id);
  const result = db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  if (result.changes > 0) {
    // 令牌不该比服务器活得久。CASCADE 依赖 PRAGMA foreign_keys=ON,这里显式删一次兜底。
    db.prepare('DELETE FROM mcp_oauth_tokens WHERE server_id = ?').run(id);
  }
  if (result.changes > 0 && existing) {
    recordMemoryV2CapabilityEvent({
      capabilityType: 'mcp',
      capabilityName: existing.name,
      scope: existing.scope,
      action: 'deleted',
      status: 'success',
      source: existing.source || (existing.scope === 'builtin' ? 'builtin-resource-sync' : 'mcp-manager'),
      summary: existing.description,
      relatedId: existing.id,
      version: existing.content_hash,
      metadata: {
        type: existing.type,
        runMode: existing.run_mode,
        runtime: existing.runtime_kind,
      },
    });
  }
  return result.changes > 0;
}

export function toggleMcpServerEnabled(id: string, enabled: boolean): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = db.prepare('UPDATE mcp_servers SET is_enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id);
  if (result.changes > 0) {
    const updated = getMcpServer(id);
    if (updated) {
      recordMemoryV2CapabilityEvent({
        capabilityType: 'mcp',
        capabilityName: updated.name,
        scope: updated.scope,
        action: enabled ? 'enabled' : 'disabled',
        status: 'success',
        source: 'mcp-manager',
        summary: updated.description,
        relatedId: updated.id,
        version: updated.content_hash,
        metadata: {
          type: updated.type,
          runMode: updated.run_mode,
          runtime: updated.runtime_kind,
        },
      });
    }
  }
  return result.changes > 0;
}

export function getEnabledMcpServersAsConfig(): Record<string, MCPServerConfig> {
  const servers = getEnabledMcpServers();
  const config: Record<string, MCPServerConfig> = {};

  for (const server of servers) {
    if (!shouldExposeMcpServerToRuntime(server)) continue;
    config[server.name] = mcpServerRecordToConfig(server);
  }

  return config;
}

function shouldExposeMcpServerToRuntime(server: McpServerRecord): boolean {
  if (server.name !== 'goofish') return true;
  if (server.health_status !== 'failed') return true;
  const error = server.health_error || server.health_message || '';
  return !isGoofishCliMissingError(error);
}

function isGoofishCliMissingError(error: string): boolean {
  return /No module named ['"]goofish_cli['"]/.test(error)
    || /goofish-cli is not installed/i.test(error)
    || /goofish_cli\.mcp_server/.test(error);
}
