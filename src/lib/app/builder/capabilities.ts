import type Database from 'better-sqlite3';

/**
 * AppBuilder capability probe.
 *
 * The AppBuilder agent can ONLY use what the host Lumos instance has
 * actually configured — anything else is hallucination. This module reads
 * the live state of MCP servers, agent presets, knowledge collections,
 * and the static set of platform tools / LLM tiers, then returns a
 * compact summary that the system prompt embeds.
 *
 * Reading directly from SQLite (rather than going through each module's
 * API surface) keeps the probe robust to test environments and avoids
 * pulling in unrelated initialization code. Missing tables are treated
 * as "no capability of that kind" — the AppBuilder simply won't suggest
 * solutions that depend on them.
 */

export interface McpCapability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scope: 'builtin' | 'user';
}

export interface AgentCapability {
  id: string;
  name: string;
  /** Higher-level role hint (worker / researcher / coder / integration / ...) */
  role?: string;
  description?: string;
}

export interface KnowledgeCapability {
  id: string;
  name: string;
  itemCount: number;
}

export type LlmTier = 'chat' | 'reasoning' | 'fast';
export type ToolName = 'bash' | 'python' | 'file' | 'web-fetch';

export interface AvailableCapabilities {
  mcps: McpCapability[];
  agents: AgentCapability[];
  knowledge: KnowledgeCapability[];
  llmTiers: LlmTier[];
  tools: ToolName[];
  /** Whether code-component apps (M6+) are unlocked. v1: false. */
  codeAppsEnabled: boolean;
  /** Whether app-side workflow execution is wired (M3 unblocks). */
  workflowExecutionReady: boolean;
}

/** Constants — these are platform invariants, not host configuration. */
const LLM_TIERS: LlmTier[] = ['chat', 'reasoning', 'fast'];
const TOOLS: ToolName[] = ['bash', 'python', 'file', 'web-fetch'];

export interface ProbeOptions {
  /** Override workflowExecutionReady; defaults to false until M3 lands. */
  workflowExecutionReady?: boolean;
  /** Override codeAppsEnabled; defaults to false until M6 lands. */
  codeAppsEnabled?: boolean;
}

export function probeCapabilities(
  db: Database.Database,
  opts: ProbeOptions = {},
): AvailableCapabilities {
  return {
    mcps: probeMcps(db),
    agents: probeAgents(db),
    knowledge: probeKnowledge(db),
    llmTiers: LLM_TIERS,
    tools: TOOLS,
    codeAppsEnabled: opts.codeAppsEnabled ?? false,
    workflowExecutionReady: opts.workflowExecutionReady ?? false,
  };
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function probeMcps(db: Database.Database): McpCapability[] {
  if (!tableExists(db, 'mcp_servers')) return [];
  const rows = db
    .prepare(
      `SELECT id, name, description, is_enabled, scope FROM mcp_servers
       ORDER BY is_enabled DESC, name`,
    )
    .all() as Array<{
    id: string;
    name: string;
    description: string;
    is_enabled: number;
    scope: 'builtin' | 'user';
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    enabled: r.is_enabled === 1,
    scope: r.scope,
  }));
}

function probeAgents(db: Database.Database): AgentCapability[] {
  if (!tableExists(db, 'agent_presets')) return [];
  // Use a defensive SELECT: column names may evolve in lumos main; we query
  // only what we definitely need and fall back gracefully on missing fields.
  const cols = db
    .prepare("PRAGMA table_info(agent_presets)")
    .all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  const idCol = colNames.has('id') ? 'id' : 'rowid';
  const nameCol = colNames.has('name') ? 'name' : 'id';
  const descCol = colNames.has('description') ? ', description' : '';
  const roleCol = colNames.has('role') ? ', role' : '';
  const rows = db
    .prepare(`SELECT ${idCol} AS id, ${nameCol} AS name${descCol}${roleCol} FROM agent_presets`)
    .all() as Array<{ id: string; name: string; description?: string; role?: string }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    role: r.role ?? undefined,
  }));
}

function probeKnowledge(db: Database.Database): KnowledgeCapability[] {
  if (!tableExists(db, 'kb_collections')) return [];
  const cols = db
    .prepare("PRAGMA table_info(kb_collections)")
    .all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('id') || !colNames.has('name')) return [];
  const rows = db
    .prepare(`SELECT id, name FROM kb_collections ORDER BY name`)
    .all() as Array<{ id: string; name: string }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    itemCount: countKbItems(db, r.id),
  }));
}

function countKbItems(db: Database.Database, collectionId: string): number {
  if (!tableExists(db, 'kb_items')) return 0;
  const cols = db
    .prepare("PRAGMA table_info(kb_items)")
    .all() as Array<{ name: string }>;
  const fk = cols.find((c) => c.name === 'collection_id') ? 'collection_id' : 'collectionId';
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM kb_items WHERE ${fk} = ?`)
      .get(collectionId) as { c: number };
    return row.c;
  } catch {
    return 0;
  }
}
