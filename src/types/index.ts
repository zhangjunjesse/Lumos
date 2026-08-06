// ==========================================
// Database Models
// ==========================================

export interface ChatSession {
  id: string;
  /** 会话身份（专属应用/主 agent/普通对话）。真源在 chat_sessions.kind 列。 */
  kind: import('@/lib/chat/session-kind').SessionKind;
  title: string;
  created_at: string;
  updated_at: string;
  model: string;
  requested_model: string;
  resolved_model: string;
  system_prompt: string;
  working_directory: string;
  sdk_session_id: string; // Claude Agent SDK session ID for resume
  project_name: string;
  status: 'active' | 'archived';
  mode?: 'code' | 'plan' | 'ask' | 'workflow';
  needs_approval?: boolean;
  provider_name: string;
  provider_id: string;
  /** 会话级图片服务商;空=跟随全局默认 provider_override:image */
  image_provider_id?: string;
  browser_context_id: string;
  knowledge_enabled: number;
  knowledge_tag_ids: string;
  knowledge_overrides: string;
  sdk_cwd: string;
  runtime_status: string;
  runtime_updated_at: string;
  runtime_error: string;
  folder: string;
  auto_continue_enabled: number;
  auto_continue_status: string;
  auto_continue_next_run_at: string | null;
  auto_continue_delay_seconds: number;
  auto_continue_round: number;
  auto_continue_max_rounds: number;
  auto_continue_fail_count: number;
  auto_continue_last_summary: string;
  auto_continue_last_error: string;
  auto_continue_stop_requested: number;
  /** 团队会话:绑定的平台团队 id(lumos_teams);空=普通聊天。 */
  team_id?: string | null;
}

// ==========================================
// Project / File Types
// ==========================================

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  size?: number;
  extension?: string;
}

export interface FilePreview {
  path: string;
  content: string;
  language: string;
  line_count: number;
}

// ==========================================
// Task Types
// ==========================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TaskItem {
  id: string;
  session_id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// Agent preset role kinds. Kept as a free-standing enum so the workflow
// agent-preset system can keep using the existing role taxonomy without
// pulling in the deleted team-planning types.
export type AgentPresetRoleKind = 'orchestrator' | 'lead' | 'worker';
/** @deprecated Alias for AgentPresetRoleKind, kept for back-compat in older imports. */
export type TeamAgentPresetRoleKind = AgentPresetRoleKind;

export const MAIN_AGENT_AGENT_PRESET_KIND = 'main-agent-agent-preset' as const;
export const MAIN_AGENT_TEAM_TEMPLATE_KIND = 'main-agent-team-template' as const;

export interface AgentPresetToolPermissions {
  read: boolean;
  write: boolean;
  exec: boolean;
}

export interface AgentPresetRecord {
  kind: typeof MAIN_AGENT_AGENT_PRESET_KIND;
  version: 1;
  name: string;
  roleKind: TeamAgentPresetRoleKind;
  responsibility?: string;
  systemPrompt: string;
  description?: string;
  collaborationStyle?: string;
  outputContract?: string;
  preferredModel?: string;
  providerId?: string;
  /** 成员出图用的图片服务商;空=跟随全局默认 */
  imageProviderId?: string;
  mcpServers?: string[];
  toolPermissions?: AgentPresetToolPermissions;
  // 员工身份信息
  position?: string;
  interests?: string;
  specialties?: string;
  avatarPath?: string;
}

export interface TeamTemplateRecord {
  kind: typeof MAIN_AGENT_TEAM_TEMPLATE_KIND;
  version: 1;
  name: string;
  summary: string;
  agentPresetIds: string[];
  activationHint?: string;
  defaultGoal?: string;
  defaultOutcome?: string;
  notes?: string;
}

export type AgentPresetSource = 'user';
export type TeamTemplateSource = 'user';

export interface AgentPresetDirectoryItem {
  id: string;
  source: AgentPresetSource;
  name: string;
  roleKind: TeamAgentPresetRoleKind;
  responsibility?: string;
  systemPrompt: string;
  updatedAt: string;
  description?: string;
  collaborationStyle?: string;
  outputContract?: string;
  preferredModel?: string;
  providerId?: string;
  /** 成员出图用的图片服务商;空=跟随全局默认 */
  imageProviderId?: string;
  mcpServers?: string[];
  toolPermissions?: AgentPresetToolPermissions;
  templateCount: number;
  // 员工身份信息
  position?: string;
  interests?: string;
  specialties?: string;
  avatarPath?: string;
  departmentId?: string;
}

export interface TeamTemplateDirectoryItem {
  id: string;
  source: TeamTemplateSource;
  name: string;
  summary: string;
  agentPresetIds: string[];
  agentPresetNames: string[];
  updatedAt: string;
  activationHint?: string;
  defaultGoal?: string;
  defaultOutcome?: string;
  notes?: string;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isTeamAgentPresetRoleKind(value: unknown): value is TeamAgentPresetRoleKind {
  return typeof value === 'string' && ['orchestrator', 'lead', 'worker'].includes(value);
}


export function parseAgentPresetRecord(value: unknown): AgentPresetRecord | null {
  if (!isObjectRecord(value)) return null;
  if (
    value.kind !== MAIN_AGENT_AGENT_PRESET_KIND
    || !isNonEmptyString(value.name)
    || !isTeamAgentPresetRoleKind(value.roleKind)
    || !isNonEmptyString(value.systemPrompt)
  ) {
    return null;
  }

  const mcpServers = Array.isArray(value.mcpServers)
    ? value.mcpServers.filter(isNonEmptyString)
    : undefined;

  const toolPermissions = isObjectRecord(value.toolPermissions)
    ? {
        read: Boolean(value.toolPermissions.read),
        write: Boolean(value.toolPermissions.write),
        exec: Boolean(value.toolPermissions.exec),
      }
    : undefined;

  return {
    kind: MAIN_AGENT_AGENT_PRESET_KIND,
    version: 1,
    name: value.name.trim(),
    roleKind: value.roleKind,
    systemPrompt: value.systemPrompt.trim(),
    ...(isNonEmptyString(value.responsibility) ? { responsibility: value.responsibility.trim() } : {}),
    ...(isNonEmptyString(value.description) ? { description: value.description.trim() } : {}),
    ...(isNonEmptyString(value.collaborationStyle) ? { collaborationStyle: value.collaborationStyle.trim() } : {}),
    ...(isNonEmptyString(value.outputContract) ? { outputContract: value.outputContract.trim() } : {}),
    ...(isNonEmptyString(value.preferredModel) ? { preferredModel: value.preferredModel.trim() } : {}),
    ...(isNonEmptyString(value.providerId) ? { providerId: value.providerId.trim() } : {}),
    ...(isNonEmptyString(value.imageProviderId) ? { imageProviderId: value.imageProviderId.trim() } : {}),
    ...(mcpServers && mcpServers.length > 0 ? { mcpServers } : {}),
    ...(toolPermissions ? { toolPermissions } : {}),
    ...(isNonEmptyString(value.position) ? { position: value.position.trim() } : {}),
    ...(isNonEmptyString(value.interests) ? { interests: value.interests.trim() } : {}),
    ...(isNonEmptyString(value.specialties) ? { specialties: value.specialties.trim() } : {}),
    ...(isNonEmptyString(value.avatarPath) ? { avatarPath: value.avatarPath.trim() } : {}),
  };
}

export function parseTeamTemplateRecord(value: unknown): TeamTemplateRecord | null {
  if (!isObjectRecord(value)) return null;
  if (
    value.kind !== MAIN_AGENT_TEAM_TEMPLATE_KIND
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.summary)
  ) {
    return null;
  }

  const agentPresetIds = Array.isArray(value.agentPresetIds)
    ? value.agentPresetIds.filter(isNonEmptyString).map((item) => item.trim())
    : [];

  if (agentPresetIds.length === 0) {
    return null;
  }

  return {
    kind: MAIN_AGENT_TEAM_TEMPLATE_KIND,
    version: 1,
    name: value.name.trim(),
    summary: value.summary.trim(),
    agentPresetIds,
    ...(isNonEmptyString(value.activationHint) ? { activationHint: value.activationHint.trim() } : {}),
    ...(isNonEmptyString(value.defaultGoal) ? { defaultGoal: value.defaultGoal.trim() } : {}),
    ...(isNonEmptyString(value.defaultOutcome) ? { defaultOutcome: value.defaultOutcome.trim() } : {}),
    ...(isNonEmptyString(value.notes) ? { notes: value.notes.trim() } : {}),
  };
}


export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string; // JSON string of MessageContentBlock[] for structured content
  created_at: string;
  token_usage: string | null; // JSON string of TokenUsage
  elapsed_ms?: number | null;
}

// Structured message content blocks (stored as JSON in messages.content)
export type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; summary: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'code'; language: string; code: string };

// Helper to parse message content - returns blocks or wraps plain text
export function parseMessageContent(content: string): MessageContentBlock[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON, treat as plain text
  }
  return [{ type: 'text', text: content }];
}

export interface Setting {
  id: number;
  key: string;
  value: string;
}

// ==========================================
// API Provider Types
// ==========================================

export interface ApiProvider {
  id: string;
  name: string;
  provider_type: string; // 'anthropic' | 'openrouter' | 'bedrock' | 'vertex' | 'custom'
  api_protocol: ProviderApiProtocol;
  capabilities: string; // JSON string of ProviderCapability[]
  provider_origin: ProviderOrigin;
  auth_mode: ProviderAuthMode;
  base_url: string;
  api_key: string;
  is_active: number; // SQLite boolean: 0 or 1
  sort_order: number;
  extra_env: string; // JSON string of Record<string, string>
  model_catalog: string; // JSON string of ProviderModelOption[]
  model_catalog_source: ProviderModelCatalogSource;
  model_catalog_updated_at: string | null;
  notes: string;
  is_builtin: number; // SQLite boolean: 0 or 1, only one provider can be 1
  user_modified: number; // SQLite boolean: 0 or 1, tracks if builtin provider was modified
  /** Selected default model id from `model_catalog`. Empty means "no preference"
   *  — falls through to whatever the consumer (chat UI / workflow agent) picks. */
  default_model: string;
  created_at: string;
  updated_at: string;
}

export type ProviderApiProtocol = 'anthropic-messages' | 'openai-compatible';
export type ProviderCapability = 'agent-chat' | 'text-gen' | 'image-gen' | 'video-gen' | 'embedding' | 'speech';
export type ProviderOrigin = 'system' | 'preset' | 'custom';
export type ProviderAuthMode = 'api_key' | 'local_auth';

export type ProviderModelCatalogSource = 'default' | 'manual' | 'detected';

export interface ProviderModelOption {
  value: string;
  label: string;
  /** 可选展示单价（每 1,000,000 输入 token 的额度单位，500000 = ¥1）。由云端下发，仅用于展示。 */
  input_price_per_mtok?: number;
  /** 可选展示单价（每 1,000,000 输出 token 的额度单位）。 */
  output_price_per_mtok?: number;
  /** 可选展示单价（每张生成图片消耗的额度单位，500000 = ¥1）。仅图片模型有。 */
  price_per_image?: number;
  /** 可选展示单价（每秒生成视频消耗的额度单位，500000 = ¥1）。仅视频模型有。 */
  price_per_second?: number;
}

export interface ProviderModelGroup {
  provider_id: string;       // provider DB id
  provider_name: string;
  provider_type: string;
  /** 'system' = cloud-provisioned, 'custom' = user-created. Chat dropdown
   *  filters by this to hide custom providers when admin disallows the chat
   *  custom-provider category (mirrors ChatProvidersCard readOnly filter). */
  provider_origin: string;
  models: ProviderModelOption[];
  default_model?: string;
  model_catalog_source: ProviderModelCatalogSource;
  model_catalog_updated_at: string | null;
  model_catalog_uses_default: boolean;
}

export interface CreateProviderRequest {
  name: string;
  provider_type?: string;
  api_protocol?: ProviderApiProtocol;
  capabilities?: string;
  provider_origin?: ProviderOrigin;
  auth_mode?: ProviderAuthMode;
  base_url?: string;
  api_key?: string;
  extra_env?: string;
  model_catalog?: string;
  model_catalog_source?: ProviderModelCatalogSource;
  model_catalog_updated_at?: string | null;
  notes?: string;
  default_model?: string;
}

export interface UpdateProviderRequest {
  name?: string;
  provider_type?: string;
  api_protocol?: ProviderApiProtocol;
  capabilities?: string;
  provider_origin?: ProviderOrigin;
  auth_mode?: ProviderAuthMode;
  base_url?: string;
  api_key?: string;
  extra_env?: string;
  model_catalog?: string;
  model_catalog_source?: ProviderModelCatalogSource;
  model_catalog_updated_at?: string | null;
  notes?: string;
  sort_order?: number;
  is_active?: number;
  default_model?: string;
}

export interface ProvidersResponse {
  providers: ApiProvider[];
  default_provider_id?: string;
}

export interface ProviderResponse {
  provider: ApiProvider;
}

export type ProviderPresetModule = 'chat' | 'knowledge' | 'agent' | 'image' | 'video';

export interface ProviderPreset {
  id: string;
  name: string;
  description: string;
  provider_type: string;
  api_protocol: ProviderApiProtocol;
  capabilities: ProviderCapability[];
  provider_origin: ProviderOrigin;
  auth_mode: ProviderAuthMode;
  base_url: string;
  notes?: string;
  tags?: string[];
  supported_modules?: ProviderPresetModule[];
  requires_base_url?: boolean;
  default_models?: ProviderModelOption[];
}

// ==========================================
// Browser Provider Types
// ==========================================

export type BrowserProviderType = 'embedded' | 'external-cdp' | 'adspower';
export type BrowserProviderTestStatus = 'untested' | 'success' | 'failed';

export interface BrowserProviderConfig {
  id: string;
  provider_type: BrowserProviderType;
  display_name: string;
  enabled: number;
  api_base_url: string;
  api_key: string;
  cdp_endpoint: string;
  profile_id: string;
  profile_name: string;
  notes: string;
  last_test_status: BrowserProviderTestStatus;
  last_test_message: string;
  last_profile_count: number;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrowserProviderConfigView extends Omit<BrowserProviderConfig, 'api_key'> {
  api_key: string;
  has_api_key: boolean;
  context_id: string;
  aliases: string[];
  usage: BrowserProviderUsageView;
}

export interface BrowserProfileSummary {
  id: string;
  name: string;
  status?: string;
  group?: string;
  serial_number?: string;
}

export interface BrowserProviderUsageView {
  chat_session_count: number;
  schedule_count: number;
  enabled_schedule_count: number;
}

export interface BrowserProvidersResponse {
  embedded_context: {
    id: 'embedded:default';
    display_name: string;
    provider_type: 'embedded';
  };
  configs: BrowserProviderConfigView[];
  /** 本地 Chrome 上下文——仅在已启用且系统检测到 Chrome 时非空,供浏览器选择器展示。 */
  local_chrome_context?: {
    id: string;
    display_name: string;
    provider_type: 'local-chrome';
  } | null;
}

export interface CreateBrowserProviderConfigRequest {
  provider_type: Exclude<BrowserProviderType, 'embedded'>;
  display_name: string;
  enabled?: boolean;
  api_base_url?: string;
  api_key?: string;
  cdp_endpoint?: string;
  profile_id?: string;
  profile_name?: string;
  aliases?: string[];
  notes?: string;
}

export interface UpdateBrowserProviderConfigRequest {
  display_name?: string;
  enabled?: boolean;
  api_base_url?: string;
  api_key?: string;
  clear_api_key?: boolean;
  cdp_endpoint?: string;
  profile_id?: string;
  profile_name?: string;
  aliases?: string[];
  notes?: string;
}

export interface BrowserProviderConfigResponse {
  config: BrowserProviderConfigView;
}

export interface BrowserProviderTestResponse {
  ok: boolean;
  status: BrowserProviderTestStatus;
  message: string;
  profile_count: number;
  profiles: BrowserProfileSummary[];
  config: BrowserProviderConfigView;
}

export interface BrowserProviderDraftTestRequest {
  config_id?: string;
  provider_type: Exclude<BrowserProviderType, 'embedded'>;
  display_name?: string;
  api_base_url?: string;
  api_key?: string;
  cdp_endpoint?: string;
  profile_id?: string;
  profile_name?: string;
}

export type BrowserProviderDraftTestResponse = Omit<BrowserProviderTestResponse, 'config'>;

export interface BrowserProviderRuntimeStatus {
  context_id: string;
  bridge_ready: boolean;
  occupied: boolean;
  owner_id?: string;
  started_at?: string;
  updated_at?: string;
  expires_at?: string;
  last_path?: string;
  error?: string;
}

export interface BrowserProviderRuntimeStatusesResponse {
  statuses: BrowserProviderRuntimeStatus[];
}

export interface BrowserProviderRuntimeReleaseRequest {
  context_id: string;
}

export interface BrowserProviderRuntimeReleaseResponse {
  ok: boolean;
  context_id: string;
  released: boolean;
  previous_owner_id?: string;
}

export interface BrowserProviderProfileImportRequest {
  source_config_id?: string;
  provider_type: 'adspower';
  api_base_url?: string;
  api_key?: string;
  profiles: BrowserProfileSummary[];
  enabled?: boolean;
}

export interface BrowserProviderProfileImportResponse {
  created: BrowserProviderConfigView[];
  skipped: Array<{ profile_id: string; name?: string; reason: string }>;
}

export interface BrowserProviderProfileSyncRequest {
  source_config_id?: string;
  api_base_url?: string;
  api_key?: string;
  enabled?: boolean;
  max_profiles?: number;
  dry_run?: boolean;
}

export interface BrowserProviderProfileSyncPlanItem {
  action: 'create' | 'update' | 'unchanged' | 'skip';
  profile_id: string;
  name?: string;
  context_id: string;
  display_name?: string;
  group?: string;
  serial_number?: string;
  changes: string[];
  reason?: string;
}

export interface BrowserProviderProfileSyncResponse {
  created: BrowserProviderConfigView[];
  updated: BrowserProviderConfigView[];
  skipped: Array<{ profile_id: string; name?: string; reason: string }>;
  profile_count?: number;
  unchanged?: number;
  dry_run?: boolean;
  plan?: BrowserProviderProfileSyncPlanItem[];
}

// ==========================================
// Token Usage
// ==========================================

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
}

// ==========================================
// API Request Types
// ==========================================

export interface CreateSessionRequest {
  title?: string;
  model?: string;
  provider_id?: string;
  browser_context_id?: string;
  system_prompt?: string;
  working_directory?: string;
  mode?: string;
  entry?: 'chat' | 'main-agent';
  folder?: string;
  /** 团队会话:绑定的平台团队 id(整个会话由该团队执行) */
  team_id?: string;
}

export type KnowledgeRetrievalMode = 'reference' | 'enhanced';

/** Per-conversation overrides for knowledge retrieval params. Any field omitted = follow global default. */
export interface KnowledgeOverrides {
  retrievalMode?: KnowledgeRetrievalMode;
  rewriteEnabled?: boolean;
  topK?: number;
  candidatePool?: number;
}

export interface ChatKnowledgeOptions {
  enabled: boolean;
  tagIds: string[];
  overrides?: KnowledgeOverrides;
}

export interface SendMessageRequest {
  session_id: string;
  content: string;
  model?: string;
  mode?: string;
  provider_id?: string;
  knowledge_enabled?: boolean;
  knowledge_tag_ids?: string[];
  knowledge_overrides?: KnowledgeOverrides;
}

export interface UpdateMCPConfigRequest {
  mcpServers: Record<string, MCPServerConfig>;
}

export interface AddMCPServerRequest {
  name: string;
  server: MCPServerConfig;
}

export interface UpdateSettingsRequest {
  settings: SettingsMap;
}

// --- File API ---

export interface FileTreeRequest {
  dir: string;
  depth?: number; // default 3
}

export interface FilePreviewRequest {
  path: string;
  maxLines?: number; // default 200
}

// --- Skill API ---

export interface SkillDefinition {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  prompt: string;
}

export interface UpdateSkillRequest {
  description?: string;
  prompt?: string;
  enabled?: boolean;
}

// ==========================================
// API Response Types
// ==========================================

export interface SessionsResponse {
  sessions: ChatSession[];
}

export interface SessionResponse {
  session: ChatSession;
}

export interface MessagesResponse {
  messages: Message[];
  hasMore?: boolean;
}

export interface SuccessResponse {
  success: true;
}

export interface ErrorResponse {
  error: string;
}

export interface SettingsResponse {
  settings: SettingsMap;
}

export interface PluginsResponse {
  plugins: PluginInfo[];
}

export interface MCPConfigResponse {
  mcpServers: Record<string, MCPServerConfig>;
}

// --- File API Responses ---

export interface FileTreeResponse {
  tree: FileTreeNode[];
  root: string;
}

export interface FilePreviewResponse {
  preview: FilePreview;
}

// --- Skill API Responses ---

export interface SkillsResponse {
  skills: SkillDefinition[];
}

export interface SkillResponse {
  skill: SkillDefinition;
}

// ==========================================
// SSE Event Types (streaming chat response)
// ==========================================

export type SSEEventType =
  | 'text'               // text content delta
  | 'tool_use_summary'   // summarized reasoning/tool-use progress
  | 'tool_use'           // tool invocation info
  | 'tool_result'        // tool execution result
  | 'tool_output'        // streaming tool output (stderr from SDK process)
  | 'tool_timeout'       // tool execution timed out
  | 'status'             // status update (compacting, etc.)
  | 'result'             // final result with usage stats
  | 'error'              // error occurred
  | 'permission_request' // permission approval needed
  | 'mode_changed'       // SDK permission mode changed (e.g. plan → code)
  | 'memory_captured'    // explicit memory captured from user input
  | 'memory_conflict'    // memory conflict detected
  | 'memory_v2_captured' // explicit action memory captured from user input
  | 'done';              // stream complete

export interface SSEEvent {
  type: SSEEventType;
  data: string;
}

// ==========================================
// Permission Types
// ==========================================

export interface PermissionSuggestion {
  type: string;
  rules?: Array<{ toolName: string; ruleContent?: string }>;
  behavior?: string;
  destination?: string;
}

export interface PermissionRequestEvent {
  permissionRequestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  suggestions?: PermissionSuggestion[];
  decisionReason?: string;
  blockedPath?: string;
  toolUseId: string;
  description?: string;
}

export interface PermissionResponseRequest {
  permissionRequestId: string;
  decision: {
    behavior: 'allow';
    updatedPermissions?: PermissionSuggestion[];
    updatedInput?: Record<string, unknown>;
  } | {
    behavior: 'deny';
    message?: string;
  };
}

// ==========================================
// Plugin / MCP Types
// ==========================================

export interface PluginInfo {
  name: string;
  description: string;
  enabled: boolean;
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'stdio' | 'sse' | 'http';
  runMode?: 'on_demand' | 'keep_alive';
  runtime?: 'auto' | 'node' | 'python' | 'bun' | 'custom';
  url?: string;
  headers?: Record<string, string>;
  description?: string;
  scope?: 'builtin' | 'user';
  is_enabled?: boolean;
  health?: {
    status: 'unknown' | 'ok' | 'failed' | 'skipped';
    checkedAt?: string;
    error?: string;
    message?: string;
    tools?: string[];
    transport?: 'stdio' | 'sse' | 'http';
  };
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// Backward-compatible alias
export type MCPServer = MCPServerConfig;

// ==========================================
// Settings Types
// ==========================================

export interface SettingsMap {
  [key: string]: string;
}

// ==========================================
// Reference Image Types (for image generation)
// ==========================================

export interface ReferenceImage {
  mimeType: string;
  data?: string;       // base64 (user upload)
  localPath?: string;  // file path (generated result)
}

// ==========================================
// File Attachment Types
// ==========================================

export interface FileAttachment {
  id: string;
  name: string;
  type: string; // MIME type
  size: number;
  data: string; // base64 encoded content
  filePath?: string; // persisted disk path (for messages reloaded from DB)
}

// Check if a MIME type is an image
export function isImageFile(type: string): boolean {
  return type.startsWith('image/');
}

// Format bytes into human-readable size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==========================================
// Claude Client Types
// ==========================================

// ==========================================
// Batch Image Generation Types
// ==========================================

export type MediaJobStatus = 'draft' | 'planning' | 'planned' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
export type MediaJobItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface MediaJob {
  id: string;
  session_id: string | null;
  status: MediaJobStatus;
  doc_paths: string;       // JSON array of file paths
  style_prompt: string;
  batch_config: string;    // JSON of BatchConfig
  total_items: number;
  completed_items: number;
  failed_items: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MediaJobItem {
  id: string;
  job_id: string;
  idx: number;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  model: string;
  tags: string;            // JSON array of strings
  source_refs: string;     // JSON array of strings
  status: MediaJobItemStatus;
  retry_count: number;
  result_media_generation_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaContextEvent {
  id: string;
  session_id: string;
  job_id: string;
  payload: string;         // JSON object
  sync_mode: 'manual' | 'auto_batch';
  synced_at: string | null;
  created_at: string;
}

export interface BatchConfig {
  concurrency: number;     // max parallel image generations (default: 2)
  maxRetries: number;      // max retry attempts per item (default: 2)
  retryDelayMs: number;    // base delay for exponential backoff (default: 2000)
}

export interface PlannerItem {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  tags: string[];
  sourceRefs: string[];
}

export interface PlannerOutput {
  summary: string;
  items: PlannerItem[];
}

export type JobProgressEventType =
  | 'item_started'
  | 'item_completed'
  | 'item_failed'
  | 'item_retry'
  | 'job_completed'
  | 'job_paused'
  | 'job_cancelled';

export interface JobProgressEvent {
  type: JobProgressEventType;
  jobId: string;
  itemId?: string;
  itemIdx?: number;
  progress: {
    total: number;
    completed: number;
    failed: number;
    processing: number;
  };
  error?: string;
  retryCount?: number;
  mediaGenerationId?: string;
  timestamp: string;
}

// --- Batch Image Gen API Types ---

export interface CreateMediaJobRequest {
  sessionId?: string;
  items: Array<{
    prompt: string;
    aspectRatio?: string;
    imageSize?: string;
    model?: string;
    tags?: string[];
    sourceRefs?: string[];
  }>;
  batchConfig?: Partial<BatchConfig>;
  stylePrompt?: string;
  docPaths?: string[];
}

export interface PlanMediaJobRequest {
  docPaths?: string[];
  docContent?: string;
  stylePrompt: string;
  sessionId?: string;
  count?: number;
}

export interface UpdateMediaJobItemsRequest {
  items: Array<{
    id: string;
    prompt?: string;
    aspectRatio?: string;
    imageSize?: string;
    tags?: string[];
  }>;
}

export interface ClaudeStreamOptions {
  prompt: string;
  /** Raw user prompt before any app-side context expansion (used by memory hooks). */
  rawPrompt?: string;
  sessionId: string;
  sdkSessionId?: string; // SDK session ID for resuming conversations
  forceFreshSession?: boolean;
  model?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  /** In-process MCP servers (created via createSdkMcpServer). Merged into mcpServers at query time. */
  inProcessMcpServers?: Record<string, import('@anthropic-ai/claude-agent-sdk').McpSdkServerConfigWithInstance>;
  /**
   * serverName → 变体指纹。in-process server 的 resume 签名默认只认名字，
   * 抓不到工具集/配置变体（如 knowledge 的 tagIds/overrides）。此处提供
   * 变体指纹并入签名，使变更真正触发新会话（R5）。
   */
  inProcessVariantKeys?: Record<string, string>;
  abortController?: AbortController;
  permissionMode?: string;
  files?: FileAttachment[];
  toolTimeoutSeconds?: number;
  sdkBuiltinTools?: import('@anthropic-ai/claude-agent-sdk').Options['tools'];
  disallowedTools?: string[];
  provider?: ApiProvider;
  knowledgeOptions?: ChatKnowledgeOptions;
  /** Recent conversation history from DB — used as fallback context when SDK resume is unavailable or fails */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  onRuntimeStatusChange?: (status: string) => void;
  /**
   * 团队会话模式(聊天团队,docs/chat-team-design.md §5):队长=主会话,成员=SDK agents 子代理。
   * 设置后:声明式工具面 + bypassPermissions,并跳过 canUseTool/hooks——控制协议回调在
   * 复杂多子代理会话里必断(实测),权限闸门全在各成员的 tools 清单里。
   */
  teamSession?: {
    agents: NonNullable<import('@anthropic-ai/claude-agent-sdk').Options['agents']>;
    /** 团队特有的 SDK-形状 MCP servers(如 stdio 出图通道),叠加到会话已有 MCP 之上 */
    sdkMcpServers?: Record<string, import('@anthropic-ai/claude-agent-sdk').McpServerConfig>;
  };
}

export * from './deepsearch';
