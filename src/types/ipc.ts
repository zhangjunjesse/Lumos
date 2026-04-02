// IPC Request/Response types for database operations

export interface IpcRequest<T = unknown> {
  data: T;
  requestId?: string; // For logging and tracing
}

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================
// Sessions
// ============================================

export interface SessionListRequest {
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface SessionGetRequest {
  id: string;
}

export interface SessionCreateRequest {
  name: string;
  provider_id?: string;
  working_directory?: string;
}

export interface SessionUpdateRequest {
  id: string;
  name?: string;
  provider_id?: string;
  working_directory?: string;
}

export interface SessionDeleteRequest {
  id: string;
}

export interface Session {
  id: string;
  name: string;
  provider_id: string | null;
  working_directory: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// Providers
// ============================================

export interface ProviderListRequest {
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at' | 'sort_order';
  sortOrder?: 'asc' | 'desc';
}

export interface ProviderListResponse {
  providers: Provider[];
  total: number;
}

export interface ProviderGetRequest {
  id: string;
}

export interface ProviderCreateRequest {
  name: string;
  provider_type?: string;
  api_protocol?: string;
  capabilities?: string;
  provider_origin?: string;
  auth_mode?: string;
  base_url?: string;
  api_key?: string;
  is_active?: boolean;
  sort_order?: number;
  extra_env?: string;
  notes?: string;
  is_builtin?: boolean;
}

export interface ProviderUpdateRequest {
  id: string;
  name?: string;
  provider_type?: string;
  api_protocol?: string;
  capabilities?: string;
  provider_origin?: string;
  auth_mode?: string;
  base_url?: string;
  api_key?: string;
  is_active?: boolean;
  sort_order?: number;
  extra_env?: string;
  notes?: string;
  user_modified?: boolean;
}

export interface ProviderDeleteRequest {
  id: string;
}

export interface Provider {
  id: string;
  name: string;
  provider_type: string;
  api_protocol: string;
  capabilities: string;
  provider_origin: string;
  auth_mode: string;
  base_url: string;
  api_key: string;
  is_active: number;
  sort_order: number;
  extra_env: string;
  notes: string;
  is_builtin: number;
  user_modified: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// MCP Servers
// ============================================

export interface McpServerListRequest {
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface McpServerListResponse {
  servers: McpServer[];
  total: number;
}

export interface McpServerGetRequest {
  id: string;
}

export interface McpServerCreateRequest {
  name: string;
  command: string;
  args?: string;
  env?: string;
  is_enabled?: boolean;
  scope?: string;
  source?: string;
  content_hash?: string;
  description?: string;
}

export interface McpServerUpdateRequest {
  id: string;
  name?: string;
  command?: string;
  args?: string;
  env?: string;
  is_enabled?: boolean;
  scope?: string;
  source?: string;
  content_hash?: string;
  description?: string;
}

export interface McpServerDeleteRequest {
  id: string;
}

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
  is_enabled: number;
  scope: string;
  source: string;
  content_hash: string;
  description: string;
  created_at: string;
  updated_at: string;
}

// ============================================
// Skills
// ============================================

export interface SkillListRequest {
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at' | 'name';
  sortOrder?: 'asc' | 'desc';
  scope?: 'builtin' | 'user';
}

export interface SkillListResponse {
  skills: Skill[];
  total: number;
}

export interface SkillGetRequest {
  id: string;
}

export interface SkillCreateRequest {
  name: string;
  scope: 'builtin' | 'user';
  description?: string;
  file_path: string;
  content_hash?: string;
  is_enabled?: boolean;
}

export interface SkillUpdateRequest {
  id: string;
  name?: string;
  scope?: 'builtin' | 'user';
  description?: string;
  file_path?: string;
  content_hash?: string;
  is_enabled?: boolean;
}

export interface SkillDeleteRequest {
  id: string;
}

export interface Skill {
  id: string;
  name: string;
  scope: string;
  description: string;
  file_path: string;
  content_hash: string;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// Tasks
// ============================================

export interface TaskListRequest {
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
  session_id?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

export interface TaskGetRequest {
  id: string;
}

export interface TaskCreateRequest {
  session_id: string;
  title: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  description?: string;
}

export interface TaskUpdateRequest {
  id: string;
  title?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed';
  description?: string;
}

export interface TaskDeleteRequest {
  id: string;
}

export interface Task {
  id: string;
  session_id: string;
  title: string;
  status: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// Media Generations
// ============================================

export interface MediaGeneration {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  provider: string;
  model: string;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  local_path: string;
  thumbnail_path: string;
  session_id: string | null;
  message_id: string | null;
  tags: string; // JSON array
  metadata: string; // JSON object
  favorited: number;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface MediaListRequest {
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'completed_at';
  sortOrder?: 'asc' | 'desc';
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  favorited?: boolean;
  session_id?: string;
}

export interface MediaListResponse {
  media: MediaGeneration[];
  total: number;
}

export interface MediaGetRequest {
  id: string;
}

export interface MediaCreateRequest {
  id?: string;
  type?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  provider: string;
  model: string;
  prompt: string;
  aspect_ratio?: string;
  image_size?: string;
  local_path?: string;
  thumbnail_path?: string;
  session_id?: string;
  message_id?: string;
  tags?: string;
  metadata?: string;
  favorited?: number;
}

export interface MediaUpdateRequest {
  id: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  local_path?: string;
  thumbnail_path?: string;
  tags?: string;
  metadata?: string;
  favorited?: number;
  error?: string;
  completed_at?: string;
}

export interface MediaDeleteRequest {
  id: string;
}
