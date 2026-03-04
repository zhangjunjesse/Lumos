import Database from 'better-sqlite3';
import type {
  Session,
  SessionListRequest,
  SessionListResponse,
  SessionCreateRequest,
  SessionUpdateRequest,
  Provider,
  ProviderListRequest,
  ProviderListResponse,
  ProviderCreateRequest,
  ProviderUpdateRequest,
  McpServer,
  McpServerListRequest,
  McpServerListResponse,
  McpServerCreateRequest,
  McpServerUpdateRequest,
  Skill,
  SkillListRequest,
  SkillListResponse,
  SkillCreateRequest,
  SkillUpdateRequest,
  Task,
  TaskListRequest,
  TaskListResponse,
  TaskCreateRequest,
  TaskUpdateRequest,
  MediaGeneration,
  MediaListRequest,
  MediaListResponse,
  MediaCreateRequest,
  MediaUpdateRequest,
} from '../../src/types/ipc';

export class DatabaseService {
  constructor(private db: Database.Database) {}

  // ============================================
  // Sessions
  // ============================================

  async listSessions(params: SessionListRequest): Promise<SessionListResponse> {
    const { limit = 50, offset = 0, sortBy = 'updated_at', sortOrder = 'desc' } = params;

    const sessions = this.db
      .prepare(
        `SELECT * FROM sessions
         ORDER BY ${sortBy} ${sortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Session[];

    const total = this.db
      .prepare('SELECT COUNT(*) as count FROM sessions')
      .get() as { count: number };

    return { sessions, total: total.count };
  }

  async getSession(params: { id: string }): Promise<Session> {
    const session = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(params.id) as Session | undefined;

    if (!session) {
      throw new Error(`Session not found: ${params.id}`);
    }

    return session;
  }

  async createSession(params: SessionCreateRequest): Promise<Session> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (id, name, provider_id, working_directory, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.name,
        params.provider_id ?? null,
        params.working_directory ?? null,
        now,
        now
      );

    return this.getSession({ id });
  }

  async updateSession(params: SessionUpdateRequest): Promise<Session> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) {
      updates.push('name = ?');
      values.push(params.name);
    }

    if (params.provider_id !== undefined) {
      updates.push('provider_id = ?');
      values.push(params.provider_id);
    }

    if (params.working_directory !== undefined) {
      updates.push('working_directory = ?');
      values.push(params.working_directory);
    }

    if (updates.length === 0) {
      return this.getSession({ id: params.id });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(params.id);

    this.db
      .prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getSession({ id: params.id });
  }

  async deleteSession(params: { id: string }): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM sessions WHERE id = ?')
      .run(params.id);

    if (result.changes === 0) {
      throw new Error(`Session not found: ${params.id}`);
    }
  }

  // ============================================
  // Providers
  // ============================================

  async listProviders(params: ProviderListRequest): Promise<ProviderListResponse> {
    const { limit = 50, offset = 0, sortBy = 'sort_order', sortOrder = 'asc' } = params;

    const providers = this.db
      .prepare(
        `SELECT * FROM api_providers
         ORDER BY ${sortBy} ${sortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Provider[];

    const total = this.db
      .prepare('SELECT COUNT(*) as count FROM api_providers')
      .get() as { count: number };

    return { providers, total: total.count };
  }

  async getProvider(params: { id: string }): Promise<Provider> {
    const provider = this.db
      .prepare('SELECT * FROM api_providers WHERE id = ?')
      .get(params.id) as Provider | undefined;

    if (!provider) {
      throw new Error(`Provider not found: ${params.id}`);
    }

    return provider;
  }

  async createProvider(params: ProviderCreateRequest): Promise<Provider> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO api_providers (
          id, name, provider_type, base_url, api_key, is_active,
          sort_order, extra_env, notes, is_builtin, user_modified,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.name,
        params.provider_type ?? 'anthropic',
        params.base_url ?? '',
        params.api_key ?? '',
        params.is_active ? 1 : 0,
        params.sort_order ?? 0,
        params.extra_env ?? '{}',
        params.notes ?? '',
        params.is_builtin ? 1 : 0,
        0, // user_modified defaults to 0
        now,
        now
      );

    return this.getProvider({ id });
  }

  async updateProvider(params: ProviderUpdateRequest): Promise<Provider> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) {
      updates.push('name = ?');
      values.push(params.name);
    }

    if (params.provider_type !== undefined) {
      updates.push('provider_type = ?');
      values.push(params.provider_type);
    }

    if (params.base_url !== undefined) {
      updates.push('base_url = ?');
      values.push(params.base_url);
    }

    if (params.api_key !== undefined) {
      updates.push('api_key = ?');
      values.push(params.api_key);
    }

    if (params.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(params.is_active ? 1 : 0);
    }

    if (params.sort_order !== undefined) {
      updates.push('sort_order = ?');
      values.push(params.sort_order);
    }

    if (params.extra_env !== undefined) {
      updates.push('extra_env = ?');
      values.push(params.extra_env);
    }

    if (params.notes !== undefined) {
      updates.push('notes = ?');
      values.push(params.notes);
    }

    if (params.user_modified !== undefined) {
      updates.push('user_modified = ?');
      values.push(params.user_modified ? 1 : 0);
    }

    if (updates.length === 0) {
      return this.getProvider({ id: params.id });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(params.id);

    this.db
      .prepare(`UPDATE api_providers SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getProvider({ id: params.id });
  }

  async deleteProvider(params: { id: string }): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM api_providers WHERE id = ?')
      .run(params.id);

    if (result.changes === 0) {
      throw new Error(`Provider not found: ${params.id}`);
    }
  }

  // ============================================
  // MCP Servers
  // ============================================

  async listMcpServers(params: McpServerListRequest): Promise<McpServerListResponse> {
    const { limit = 50, offset = 0, sortBy = 'name', sortOrder = 'asc' } = params;

    const servers = this.db
      .prepare(
        `SELECT * FROM mcp_servers
         ORDER BY ${sortBy} ${sortOrder}
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as McpServer[];

    const total = this.db
      .prepare('SELECT COUNT(*) as count FROM mcp_servers')
      .get() as { count: number };

    return { servers, total: total.count };
  }

  async getMcpServer(params: { id: string }): Promise<McpServer> {
    const server = this.db
      .prepare('SELECT * FROM mcp_servers WHERE id = ?')
      .get(params.id) as McpServer | undefined;

    if (!server) {
      throw new Error(`MCP Server not found: ${params.id}`);
    }

    return server;
  }

  async createMcpServer(params: McpServerCreateRequest): Promise<McpServer> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO mcp_servers (
          id, name, command, args, env, is_enabled,
          scope, source, content_hash, description,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.name,
        params.command,
        params.args ?? '[]',
        params.env ?? '{}',
        params.is_enabled ? 1 : 0,
        params.scope ?? 'user',
        params.source ?? 'manual',
        params.content_hash ?? '',
        params.description ?? '',
        now,
        now
      );

    return this.getMcpServer({ id });
  }

  async updateMcpServer(params: McpServerUpdateRequest): Promise<McpServer> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) {
      updates.push('name = ?');
      values.push(params.name);
    }

    if (params.command !== undefined) {
      updates.push('command = ?');
      values.push(params.command);
    }

    if (params.args !== undefined) {
      updates.push('args = ?');
      values.push(params.args);
    }

    if (params.env !== undefined) {
      updates.push('env = ?');
      values.push(params.env);
    }

    if (params.is_enabled !== undefined) {
      updates.push('is_enabled = ?');
      values.push(params.is_enabled ? 1 : 0);
    }

    if (params.scope !== undefined) {
      updates.push('scope = ?');
      values.push(params.scope);
    }

    if (params.source !== undefined) {
      updates.push('source = ?');
      values.push(params.source);
    }

    if (params.content_hash !== undefined) {
      updates.push('content_hash = ?');
      values.push(params.content_hash);
    }

    if (params.description !== undefined) {
      updates.push('description = ?');
      values.push(params.description);
    }

    if (updates.length === 0) {
      return this.getMcpServer({ id: params.id });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(params.id);

    this.db
      .prepare(`UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getMcpServer({ id: params.id });
  }

  async deleteMcpServer(params: { id: string }): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM mcp_servers WHERE id = ?')
      .run(params.id);

    if (result.changes === 0) {
      throw new Error(`MCP Server not found: ${params.id}`);
    }
  }

  // ============================================
  // Skills
  // ============================================

  async listSkills(params: SkillListRequest): Promise<SkillListResponse> {
    const { limit = 50, offset = 0, sortBy = 'name', sortOrder = 'asc', scope } = params;

    let query = 'SELECT * FROM skills';
    const queryParams: unknown[] = [];

    if (scope) {
      query += ' WHERE scope = ?';
      queryParams.push(scope);
    }

    query += ` ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);

    const skills = this.db.prepare(query).all(...queryParams) as Skill[];

    let countQuery = 'SELECT COUNT(*) as count FROM skills';
    const countParams: unknown[] = [];

    if (scope) {
      countQuery += ' WHERE scope = ?';
      countParams.push(scope);
    }

    const total = this.db.prepare(countQuery).get(...countParams) as { count: number };

    return { skills, total: total.count };
  }

  async getSkill(params: { id: string }): Promise<Skill> {
    const skill = this.db
      .prepare('SELECT * FROM skills WHERE id = ?')
      .get(params.id) as Skill | undefined;

    if (!skill) {
      throw new Error(`Skill not found: ${params.id}`);
    }

    return skill;
  }

  async createSkill(params: SkillCreateRequest): Promise<Skill> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO skills (
          id, name, scope, description, file_path, content_hash, is_enabled,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.name,
        params.scope,
        params.description ?? '',
        params.file_path,
        params.content_hash ?? '',
        params.is_enabled ? 1 : 0,
        now,
        now
      );

    return this.getSkill({ id });
  }

  async updateSkill(params: SkillUpdateRequest): Promise<Skill> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) {
      updates.push('name = ?');
      values.push(params.name);
    }

    if (params.scope !== undefined) {
      updates.push('scope = ?');
      values.push(params.scope);
    }

    if (params.description !== undefined) {
      updates.push('description = ?');
      values.push(params.description);
    }

    if (params.file_path !== undefined) {
      updates.push('file_path = ?');
      values.push(params.file_path);
    }

    if (params.content_hash !== undefined) {
      updates.push('content_hash = ?');
      values.push(params.content_hash);
    }

    if (params.is_enabled !== undefined) {
      updates.push('is_enabled = ?');
      values.push(params.is_enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return this.getSkill({ id: params.id });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(params.id);

    this.db
      .prepare(`UPDATE skills SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getSkill({ id: params.id });
  }

  async deleteSkill(params: { id: string }): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM skills WHERE id = ?')
      .run(params.id);

    if (result.changes === 0) {
      throw new Error(`Skill not found: ${params.id}`);
    }
  }

  // ============================================
  // Tasks
  // ============================================

  async listTasks(params: TaskListRequest): Promise<TaskListResponse> {
    const { limit = 50, offset = 0, sortBy = 'created_at', sortOrder = 'desc', session_id, status } = params;

    let query = 'SELECT * FROM tasks';
    const queryParams: unknown[] = [];
    const conditions: string[] = [];

    if (session_id) {
      conditions.push('session_id = ?');
      queryParams.push(session_id);
    }

    if (status) {
      conditions.push('status = ?');
      queryParams.push(status);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);

    const tasks = this.db.prepare(query).all(...queryParams) as Task[];

    let countQuery = 'SELECT COUNT(*) as count FROM tasks';
    const countParams: unknown[] = [];

    if (conditions.length > 0) {
      countQuery += ` WHERE ${conditions.join(' AND ')}`;
      countParams.push(...(session_id ? [session_id] : []), ...(status ? [status] : []));
    }

    const total = this.db.prepare(countQuery).get(...countParams) as { count: number };

    return { tasks, total: total.count };
  }

  async getTask(params: { id: string }): Promise<Task> {
    const task = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(params.id) as Task | undefined;

    if (!task) {
      throw new Error(`Task not found: ${params.id}`);
    }

    return task;
  }

  async createTask(params: TaskCreateRequest): Promise<Task> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO tasks (
          id, session_id, title, status, description,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.session_id,
        params.title,
        params.status ?? 'pending',
        params.description ?? null,
        now,
        now
      );

    return this.getTask({ id });
  }

  async updateTask(params: TaskUpdateRequest): Promise<Task> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.title !== undefined) {
      updates.push('title = ?');
      values.push(params.title);
    }

    if (params.status !== undefined) {
      updates.push('status = ?');
      values.push(params.status);
    }

    if (params.description !== undefined) {
      updates.push('description = ?');
      values.push(params.description);
    }

    if (updates.length === 0) {
      return this.getTask({ id: params.id });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(params.id);

    this.db
      .prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getTask({ id: params.id });
  }

  async deleteTask(params: { id: string }): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM tasks WHERE id = ?')
      .run(params.id);

    if (result.changes === 0) {
      throw new Error(`Task not found: ${params.id}`);
    }
  }

  // ============================================
  // Media Generations Methods
  // ============================================

  async listMedia(params: MediaListRequest): Promise<MediaListResponse> {
    const {
      limit = 50,
      offset = 0,
      sortBy = 'created_at',
      sortOrder = 'desc',
      status,
      favorited,
      session_id,
    } = params;

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (status) {
      conditions.push('status = ?');
      values.push(status);
    }

    if (favorited !== undefined) {
      conditions.push('favorited = ?');
      values.push(favorited ? 1 : 0);
    }

    if (session_id) {
      conditions.push('session_id = ?');
      values.push(session_id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderClause = `ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;

    const media = this.db
      .prepare(
        `SELECT * FROM media_generations ${whereClause} ${orderClause} LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as MediaGeneration[];

    const totalResult = this.db
      .prepare(`SELECT COUNT(*) as count FROM media_generations ${whereClause}`)
      .get(...values) as { count: number };

    return {
      media,
      total: totalResult.count,
    };
  }

  async getMedia(params: { id: string }): Promise<MediaGeneration> {
    const media = this.db
      .prepare('SELECT * FROM media_generations WHERE id = ?')
      .get(params.id) as MediaGeneration | undefined;

    if (!media) {
      throw new Error(`Media not found: ${params.id}`);
    }

    return media;
  }

  async createMedia(params: MediaCreateRequest): Promise<MediaGeneration> {
    const id = params.id || crypto.randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO media_generations (
          id, type, status, provider, model, prompt, aspect_ratio, image_size,
          local_path, thumbnail_path, session_id, message_id, tags, metadata,
          favorited, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        params.type || 'image',
        params.status || 'pending',
        params.provider,
        params.model,
        params.prompt,
        params.aspect_ratio || '1:1',
        params.image_size || '1K',
        params.local_path || '',
        params.thumbnail_path || '',
        params.session_id || null,
        params.message_id || null,
        params.tags || '[]',
        params.metadata || '{}',
        params.favorited || 0,
        now
      );

    return this.getMedia({ id });
  }

  async updateMedia(params: MediaUpdateRequest): Promise<MediaGeneration> {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (params.status !== undefined) {
      updates.push('status = ?');
      values.push(params.status);
    }

    if (params.local_path !== undefined) {
      updates.push('local_path = ?');
      values.push(params.local_path);
    }

    if (params.thumbnail_path !== undefined) {
      updates.push('thumbnail_path = ?');
      values.push(params.thumbnail_path);
    }

    if (params.tags !== undefined) {
      updates.push('tags = ?');
      values.push(params.tags);
    }

    if (params.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(params.metadata);
    }

    if (params.favorited !== undefined) {
      updates.push('favorited = ?');
      values.push(params.favorited);
    }

    if (params.error !== undefined) {
      updates.push('error = ?');
      values.push(params.error);
    }

    if (params.completed_at !== undefined) {
      updates.push('completed_at = ?');
      values.push(params.completed_at);
    }

    if (updates.length === 0) {
      return this.getMedia({ id: params.id });
    }

    values.push(params.id);

    this.db
      .prepare(`UPDATE media_generations SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values);

    return this.getMedia({ id: params.id });
  }

  async deleteMedia(params: { id: string }): Promise<void> {
    const result = this.db
      .prepare('DELETE FROM media_generations WHERE id = ?')
      .run(params.id);

    if (result.changes === 0) {
      throw new Error(`Media not found: ${params.id}`);
    }
  }
}
