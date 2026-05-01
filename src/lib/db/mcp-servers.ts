import crypto from 'crypto';
import type { MCPServerConfig } from '@/types';
import { getDb } from './connection';

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

export function mcpServerRecordToConfig(record: McpServerRecord): MCPServerConfig {
  const config: MCPServerConfig = {
    command: record.command,
  };

  const args = JSON.parse(record.args) as string[];
  if (args.length > 0) config.args = args;

  const env = JSON.parse(record.env) as Record<string, string>;
  if (Object.keys(env).length > 0) config.env = env;

  const type = record.type || 'stdio';
  if (type !== 'stdio') config.type = type as 'sse' | 'http';
  config.runMode = record.run_mode || 'on_demand';
  config.runtime = record.runtime_kind || 'auto';

  if (record.url) config.url = record.url;

  const headers = JSON.parse(record.headers || '{}') as Record<string, string>;
  if (Object.keys(headers).length > 0) config.headers = headers;

  return config;
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
    JSON.stringify(data.args || []),
    JSON.stringify(data.env || {}),
    data.type || 'stdio',
    data.runMode || 'on_demand',
    data.runtime || 'auto',
    data.url || '',
    JSON.stringify(data.headers || {}),
    data.is_enabled ? 1 : 0,
    data.scope,
    data.source || 'manual',
    data.content_hash || '',
    data.description || '',
    now,
    now,
  );

  return getMcpServer(id)!;
}

export function updateMcpServer(id: string, data: UpdateMcpServerData): McpServerRecord | undefined {
  const db = getDb();
  const existing = getMcpServer(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const command = data.command ?? existing.command;
  const args = data.args !== undefined ? JSON.stringify(data.args) : existing.args;
  const env = data.env !== undefined ? JSON.stringify(data.env) : existing.env;
  const type = data.type ?? existing.type ?? 'stdio';
  const runMode = data.runMode ?? existing.run_mode ?? 'on_demand';
  const runtimeKind = data.runtime ?? existing.runtime_kind ?? 'auto';
  const url = data.url ?? existing.url ?? '';
  const headers = data.headers !== undefined ? JSON.stringify(data.headers) : (existing.headers || '{}');
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

  return getMcpServer(id);
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

  return getMcpServer(id);
}

export function deleteMcpServer(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
  return result.changes > 0;
}

export function toggleMcpServerEnabled(id: string, enabled: boolean): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = db.prepare('UPDATE mcp_servers SET is_enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id);
  return result.changes > 0;
}

export function getEnabledMcpServersAsConfig(): Record<string, MCPServerConfig> {
  const servers = getEnabledMcpServers();
  const config: Record<string, MCPServerConfig> = {};

  for (const server of servers) {
    config[server.name] = mcpServerRecordToConfig(server);
  }

  return config;
}
