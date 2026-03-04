import { z } from 'zod';

// ============================================
// Sessions Schemas
// ============================================

export const SessionListSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  sortBy: z.enum(['created_at', 'updated_at']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const SessionGetSchema = z.object({
  id: z.string().uuid(),
});

export const SessionCreateSchema = z.object({
  name: z.string().min(1),
  provider_id: z.string().uuid().optional(),
  working_directory: z.string().optional(),
});

export const SessionUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  provider_id: z.string().uuid().optional(),
  working_directory: z.string().optional(),
});

export const SessionDeleteSchema = z.object({
  id: z.string().uuid(),
});

// ============================================
// Providers Schemas
// ============================================

export const ProviderListSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'sort_order']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const ProviderGetSchema = z.object({
  id: z.string().uuid(),
});

export const ProviderCreateSchema = z.object({
  name: z.string().min(1),
  provider_type: z.string().optional(),
  base_url: z.string().optional(),
  api_key: z.string().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().nonnegative().optional(),
  extra_env: z.string().optional(),
  notes: z.string().optional(),
  is_builtin: z.boolean().optional(),
});

export const ProviderUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  provider_type: z.string().optional(),
  base_url: z.string().optional(),
  api_key: z.string().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().nonnegative().optional(),
  extra_env: z.string().optional(),
  notes: z.string().optional(),
  user_modified: z.boolean().optional(),
});

export const ProviderDeleteSchema = z.object({
  id: z.string().uuid(),
});

// ============================================
// MCP Servers Schemas
// ============================================

export const McpServerListSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'name']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

export const McpServerGetSchema = z.object({
  id: z.string().uuid(),
});

export const McpServerCreateSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.string().optional(),
  env: z.string().optional(),
  is_enabled: z.boolean().optional(),
  scope: z.string().optional(),
  source: z.string().optional(),
  content_hash: z.string().optional(),
  description: z.string().optional(),
});

export const McpServerUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  command: z.string().min(1).optional(),
  args: z.string().optional(),
  env: z.string().optional(),
  is_enabled: z.boolean().optional(),
  scope: z.string().optional(),
  source: z.string().optional(),
  content_hash: z.string().optional(),
  description: z.string().optional(),
});

export const McpServerDeleteSchema = z.object({
  id: z.string().uuid(),
});

// ============================================
// Skills Schemas
// ============================================

export const SkillListSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'name']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  scope: z.enum(['builtin', 'user']).optional(),
});

export const SkillGetSchema = z.object({
  id: z.string().uuid(),
});

export const SkillCreateSchema = z.object({
  name: z.string().min(1),
  scope: z.enum(['builtin', 'user']),
  description: z.string().optional(),
  file_path: z.string().min(1),
  content_hash: z.string().optional(),
  is_enabled: z.boolean().optional(),
});

export const SkillUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  scope: z.enum(['builtin', 'user']).optional(),
  description: z.string().optional(),
  file_path: z.string().min(1).optional(),
  content_hash: z.string().optional(),
  is_enabled: z.boolean().optional(),
});

export const SkillDeleteSchema = z.object({
  id: z.string().uuid(),
});

// ============================================
// Tasks Schemas
// ============================================

export const TaskListSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  sortBy: z.enum(['created_at', 'updated_at']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  session_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
});

export const TaskGetSchema = z.object({
  id: z.string().uuid(),
});

export const TaskCreateSchema = z.object({
  session_id: z.string().uuid(),
  title: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
  description: z.string().optional(),
});

export const TaskUpdateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'failed']).optional(),
  description: z.string().optional(),
});

export const TaskDeleteSchema = z.object({
  id: z.string().uuid(),
});

// ============================================
// Media Generations Schemas
// ============================================

export const MediaListSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  sortBy: z.enum(['created_at', 'completed_at']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  favorited: z.boolean().optional(),
  session_id: z.string().uuid().optional(),
});

export const MediaGetSchema = z.object({
  id: z.string(),
});

export const MediaCreateSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  prompt: z.string().min(1),
  aspect_ratio: z.string().optional(),
  image_size: z.string().optional(),
  local_path: z.string().optional(),
  thumbnail_path: z.string().optional(),
  session_id: z.string().uuid().optional(),
  message_id: z.string().optional(),
  tags: z.string().optional(),
  metadata: z.string().optional(),
  favorited: z.number().int().min(0).max(1).optional(),
});

export const MediaUpdateSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  local_path: z.string().optional(),
  thumbnail_path: z.string().optional(),
  tags: z.string().optional(),
  metadata: z.string().optional(),
  favorited: z.number().int().min(0).max(1).optional(),
  error: z.string().optional(),
  completed_at: z.string().optional(),
});

export const MediaDeleteSchema = z.object({
  id: z.string(),
});
