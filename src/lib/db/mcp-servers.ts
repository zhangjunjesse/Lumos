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
  is_enabled: number;
  scope: 'builtin' | 'user';
  source: string;
  content_hash: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface CreateMcpServerData {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
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
  is_enabled?: boolean;
  description?: string;
  source?: string;
  content_hash?: string;
}

// ==========================================
// Helper Functions
// ==========================================

function recordToConfig(record: McpServerRecord): MCPServerConfig {
  const config: MCPServerConfig = {
    command: record.command,
  };

  const args = JSON.parse(record.args) as string[];
  if (args.length > 0) {
    config.args = args;
  }

  const env = JSON.parse(record.env) as Record<string, string>;
  if (Object.keys(env).length > 0) {
    config.env = env;
  }

  return config;
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
    'INSERT INTO mcp_servers (id, name, command, args, env, is_enabled, scope, source, content_hash, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.command,
    JSON.stringify(data.args || []),
    JSON.stringify(data.env || {}),
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
  const isEnabled = data.is_enabled !== undefined ? (data.is_enabled ? 1 : 0) : existing.is_enabled;
  const description = data.description ?? existing.description;

  db.prepare(
    'UPDATE mcp_servers SET command = ?, args = ?, env = ?, is_enabled = ?, description = ?, updated_at = ? WHERE id = ?'
  ).run(command, args, env, isEnabled, description, now, id);

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
    config[server.name] = recordToConfig(server);
  }

  return config;
}

