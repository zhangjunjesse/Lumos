import { randomUUID } from 'crypto';
import { getDb } from './index';
import {
  MAIN_AGENT_AGENT_PRESET_KIND,
  parseAgentPresetRecord,
  type AgentPresetDirectoryItem,
  type AgentPresetRecord,
  type AgentPresetToolPermissions,
  type TeamAgentPresetRoleKind,
} from '@/types';

interface TemplateRow {
  id: string;
  name: string;
  type: string;
  category: string;
  content_skeleton: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentPresetInput {
  name: string;
  roleKind: TeamAgentPresetRoleKind;
  responsibility: string;
  systemPrompt: string;
  description?: string;
  collaborationStyle?: string;
  outputContract?: string;
  preferredModel?: string;
  mcpServers?: string[];
  toolPermissions?: AgentPresetToolPermissions;
}

export type UpdateAgentPresetInput = Partial<CreateAgentPresetInput>;

function hasTemplatesTable(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='templates'")
    .get() as { name?: string } | undefined;
  return row?.name === 'templates';
}

function rowToDirectoryItem(row: TemplateRow, templateCount = 0): AgentPresetDirectoryItem | null {
  let payload: unknown;
  try {
    payload = JSON.parse(row.content_skeleton);
  } catch {
    return null;
  }
  const record = parseAgentPresetRecord(payload);
  if (!record) return null;
  return {
    id: row.id,
    source: 'user',
    name: record.name,
    roleKind: record.roleKind,
    responsibility: record.responsibility,
    systemPrompt: record.systemPrompt,
    updatedAt: row.updated_at,
    ...(record.description ? { description: record.description } : {}),
    ...(record.collaborationStyle ? { collaborationStyle: record.collaborationStyle } : {}),
    ...(record.outputContract ? { outputContract: record.outputContract } : {}),
    ...(record.preferredModel ? { preferredModel: record.preferredModel } : {}),
    ...(record.mcpServers ? { mcpServers: record.mcpServers } : {}),
    ...(record.toolPermissions ? { toolPermissions: record.toolPermissions } : {}),
    templateCount,
  };
}

function buildRecord(input: CreateAgentPresetInput): AgentPresetRecord {
  const record: AgentPresetRecord = {
    kind: MAIN_AGENT_AGENT_PRESET_KIND,
    version: 1,
    name: input.name.trim(),
    roleKind: input.roleKind,
    responsibility: input.responsibility.trim(),
    systemPrompt: input.systemPrompt.trim(),
  };
  if (input.description) record.description = input.description.trim();
  if (input.collaborationStyle) record.collaborationStyle = input.collaborationStyle.trim();
  if (input.outputContract) record.outputContract = input.outputContract.trim();
  if (input.preferredModel) record.preferredModel = input.preferredModel.trim();
  if (input.mcpServers && input.mcpServers.length > 0) record.mcpServers = input.mcpServers;
  if (input.toolPermissions) record.toolPermissions = input.toolPermissions;
  return record;
}

export function listAgentPresets(): AgentPresetDirectoryItem[] {
  if (!hasTemplatesTable()) return [];
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM templates WHERE type = 'conversation' ORDER BY updated_at DESC")
    .all() as TemplateRow[];

  const items: AgentPresetDirectoryItem[] = [];
  for (const row of rows) {
    const item = rowToDirectoryItem(row);
    if (item) items.push(item);
  }
  return items;
}

export function getAgentPreset(id: string): AgentPresetDirectoryItem | null {
  if (!hasTemplatesTable()) return null;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM templates WHERE id = ? AND type = 'conversation'")
    .get(id) as TemplateRow | undefined;
  if (!row) return null;
  return rowToDirectoryItem(row);
}

export function createAgentPreset(input: CreateAgentPresetInput): AgentPresetDirectoryItem {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const record = buildRecord(input);
  const contentSkeleton = JSON.stringify(record);

  db.prepare(`
    INSERT INTO templates (id, name, type, category, content_skeleton, created_at, updated_at)
    VALUES (?, ?, 'conversation', 'user', ?, ?, ?)
  `).run(id, input.name.trim(), contentSkeleton, now, now);

  const item = getAgentPreset(id);
  if (!item) throw new Error('Failed to create agent preset');
  return item;
}

export function updateAgentPreset(
  id: string,
  input: UpdateAgentPresetInput,
): AgentPresetDirectoryItem | null {
  const existing = getAgentPreset(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const merged: CreateAgentPresetInput = {
    name: input.name ?? existing.name,
    roleKind: input.roleKind ?? existing.roleKind,
    responsibility: input.responsibility ?? existing.responsibility,
    systemPrompt: input.systemPrompt ?? existing.systemPrompt,
    description: input.description !== undefined ? input.description : existing.description,
    collaborationStyle: input.collaborationStyle !== undefined ? input.collaborationStyle : existing.collaborationStyle,
    outputContract: input.outputContract !== undefined ? input.outputContract : existing.outputContract,
    preferredModel: input.preferredModel !== undefined ? input.preferredModel : existing.preferredModel,
    mcpServers: input.mcpServers !== undefined ? input.mcpServers : existing.mcpServers,
    toolPermissions: input.toolPermissions !== undefined ? input.toolPermissions : existing.toolPermissions,
  };

  const record = buildRecord(merged);
  const contentSkeleton = JSON.stringify(record);

  db.prepare(`
    UPDATE templates SET name = ?, content_skeleton = ?, updated_at = ?
    WHERE id = ? AND type = 'conversation'
  `).run(merged.name, contentSkeleton, now, id);

  return getAgentPreset(id);
}

export function deleteAgentPreset(id: string): boolean {
  if (!hasTemplatesTable()) return false;
  const db = getDb();
  const result = db
    .prepare("DELETE FROM templates WHERE id = ? AND type = 'conversation'")
    .run(id);
  return result.changes > 0;
}
