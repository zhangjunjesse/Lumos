export type MemoryV2Kind = 'task' | 'people' | 'resource' | 'capability' | 'reflection';
export type MemoryV2ScopeType = 'user' | 'main_agent' | 'project' | 'session' | 'module' | 'entity';
export type MemoryV2Status = 'candidate' | 'active' | 'archived' | 'rejected';
export type MemoryV2Sensitivity = 'normal' | 'sensitive_ref' | 'secret_ref_required';

export interface MemoryV2Entry {
  id: string;
  kind: MemoryV2Kind;
  scope_type: MemoryV2ScopeType;
  scope_key: string;
  owner_module: string;
  status: MemoryV2Status;
  title: string;
  body: string;
  summary: string;
  tags: string;
  source_type: string;
  source_id: string;
  session_id: string;
  message_id: string;
  project_path: string;
  related_entity_type: string;
  related_entity_id: string;
  sensitivity: MemoryV2Sensitivity;
  secret_ref: string;
  confidence: number;
  importance: number;
  evidence: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  hit_count: number;
  embedding: Buffer | null;
}

export interface MemoryV2Input {
  kind: MemoryV2Kind;
  scopeType: MemoryV2ScopeType;
  scopeKey?: string;
  ownerModule?: string;
  status?: MemoryV2Status;
  title: string;
  body: string;
  summary?: string;
  tags?: string[];
  sourceType?: string;
  sourceId?: string;
  sessionId?: string;
  messageId?: string;
  projectPath?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  sensitivity?: MemoryV2Sensitivity;
  secretRef?: string;
  confidence?: number;
  importance?: number;
  evidence?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryV2UpdateInput extends Partial<Omit<MemoryV2Input, 'metadata'>> {
  metadata?: Record<string, unknown>;
}

export interface MemoryV2ListFilters {
  status?: MemoryV2Status | 'all';
  kind?: MemoryV2Kind | 'all';
  scopeType?: MemoryV2ScopeType | 'all';
  scopeKey?: string;
  ownerModule?: string;
  query?: string;
  includeArchived?: boolean;
  limit?: number;
}

export interface MemoryV2Scope {
  type: MemoryV2ScopeType;
  key: string;
}

export interface MemoryV2Pack {
  text: string;
  entries: MemoryV2Entry[];
  scopes: MemoryV2Scope[];
}
