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

export interface NativeIntegrationCapability {
  id: string;
  name: string;
  status: 'available' | 'requires_setup' | 'not_connected';
  setupUi: string;
  readActions: string[];
  writeActions: string[];
  highRiskActions: string[];
  unavailableActions: string[];
  safetyRules: string[];
}

export type LlmTier = 'chat' | 'reasoning' | 'fast';
export type ToolName = 'bash' | 'python' | 'file' | 'web-fetch';

export interface AvailableCapabilities {
  mcps: McpCapability[];
  agents: AgentCapability[];
  knowledge: KnowledgeCapability[];
  nativeIntegrations: NativeIntegrationCapability[];
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
const NATIVE_INTEGRATIONS: NativeIntegrationCapability[] = [
  {
    id: 'goofish',
    name: '闲鱼 / Goofish',
    status: 'requires_setup',
    setupUi: '扩展 > 闲鱼',
    readActions: [
      '检测 goofish-cli 安装状态',
      '查看账号登录状态和账号列表',
      '触发同步并读取本地会话归档',
      '读取收件箱、会话列表、消息详情和聊天搜索结果',
      '搜索闲鱼商品',
    ],
    writeActions: [
      '向明确会话发送文本消息，但必须先生成草稿并由用户确认',
    ],
    highRiskActions: [
      '发送买家消息',
      '确认 IM 命令触发的低风险写操作',
    ],
    unavailableActions: [
      '自动无确认回复买家',
      '发布商品',
      '改价',
      '下架或删除商品',
      '批量修改商品',
      '绕过闲鱼风控的浏览器自动化',
    ],
    safetyRules: [
      '缺安装、缺登录或同步失败时，生成应用必须显示未接入 / 需授权 / 失败原因。',
      'AI 只能先生成回复草稿；真正发送必须由用户在 UI 或受控 IM 确认。',
      '商品管理第一阶段只允许只读、备注和待处理标记。',
    ],
  },
];

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
    nativeIntegrations: NATIVE_INTEGRATIONS,
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
