import type {
  IpcResponse,
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
} from '@/types/ipc';

class IpcClient {
  private async invoke<T, R>(
    channel: string,
    data: T,
    options?: { timeout?: number; retry?: number }
  ): Promise<R> {
    // Check if we're in Electron environment
    if (typeof window === 'undefined' || !window.electronAPI?.ipcRenderer) {
      throw new Error('IPC client is only available in Electron environment');
    }

    const requestId = crypto.randomUUID();
    const timeout = options?.timeout ?? 5000;
    const retry = options?.retry ?? 0;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retry; attempt++) {
      try {
        const response = (await Promise.race([
          window.electronAPI.ipcRenderer.invoke(channel, { data, requestId }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('IPC timeout')), timeout)
          ),
        ])) as IpcResponse<R>;

        if (!response.success) {
          throw new Error(response.error?.message ?? 'IPC call failed');
        }

        return response.data!;
      } catch (error) {
        lastError = error as Error;
        if (attempt < retry) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError;
  }

  // ============================================
  // Sessions
  // ============================================

  async listSessions(params: SessionListRequest = {}): Promise<SessionListResponse> {
    return this.invoke('db:sessions:list', params);
  }

  async getSession(id: string): Promise<Session> {
    return this.invoke('db:sessions:get', { id });
  }

  async createSession(params: SessionCreateRequest): Promise<Session> {
    return this.invoke('db:sessions:create', params);
  }

  async updateSession(params: SessionUpdateRequest): Promise<Session> {
    return this.invoke('db:sessions:update', params);
  }

  async deleteSession(id: string): Promise<void> {
    return this.invoke('db:sessions:delete', { id });
  }

  // ============================================
  // Providers
  // ============================================

  async listProviders(params: ProviderListRequest = {}): Promise<ProviderListResponse> {
    return this.invoke('db:providers:list', params);
  }

  async getProvider(id: string): Promise<Provider> {
    return this.invoke('db:providers:get', { id });
  }

  async createProvider(params: ProviderCreateRequest): Promise<Provider> {
    return this.invoke('db:providers:create', params);
  }

  async updateProvider(params: ProviderUpdateRequest): Promise<Provider> {
    return this.invoke('db:providers:update', params);
  }

  async deleteProvider(id: string): Promise<void> {
    return this.invoke('db:providers:delete', { id });
  }

  // ============================================
  // MCP Servers
  // ============================================

  async listMcpServers(params: McpServerListRequest = {}): Promise<McpServerListResponse> {
    return this.invoke('db:mcp-servers:list', params);
  }

  async getMcpServer(id: string): Promise<McpServer> {
    return this.invoke('db:mcp-servers:get', { id });
  }

  async createMcpServer(params: McpServerCreateRequest): Promise<McpServer> {
    return this.invoke('db:mcp-servers:create', params);
  }

  async updateMcpServer(params: McpServerUpdateRequest): Promise<McpServer> {
    return this.invoke('db:mcp-servers:update', params);
  }

  async deleteMcpServer(id: string): Promise<void> {
    return this.invoke('db:mcp-servers:delete', { id });
  }

  // ============================================
  // Skills
  // ============================================

  async listSkills(params: SkillListRequest = {}): Promise<SkillListResponse> {
    return this.invoke('db:skills:list', params);
  }

  async getSkill(id: string): Promise<Skill> {
    return this.invoke('db:skills:get', { id });
  }

  async createSkill(params: SkillCreateRequest): Promise<Skill> {
    return this.invoke('db:skills:create', params);
  }

  async updateSkill(params: SkillUpdateRequest): Promise<Skill> {
    return this.invoke('db:skills:update', params);
  }

  async deleteSkill(id: string): Promise<void> {
    return this.invoke('db:skills:delete', { id });
  }

  // ============================================
  // Tasks
  // ============================================

  async listTasks(params: TaskListRequest = {}): Promise<TaskListResponse> {
    return this.invoke('db:tasks:list', params);
  }

  async getTask(id: string): Promise<Task> {
    return this.invoke('db:tasks:get', { id });
  }

  async createTask(params: TaskCreateRequest): Promise<Task> {
    return this.invoke('db:tasks:create', params);
  }

  async updateTask(params: TaskUpdateRequest): Promise<Task> {
    return this.invoke('db:tasks:update', params);
  }

  async deleteTask(id: string): Promise<void> {
    return this.invoke('db:tasks:delete', { id });
  }

  // ============================================
  // Media Generations
  // ============================================

  async listMedia(params: MediaListRequest = {}): Promise<MediaListResponse> {
    return this.invoke('db:media:list', params);
  }

  async getMedia(id: string): Promise<MediaGeneration> {
    return this.invoke('db:media:get', { id });
  }

  async createMedia(params: MediaCreateRequest): Promise<MediaGeneration> {
    return this.invoke('db:media:create', params);
  }

  async updateMedia(params: MediaUpdateRequest): Promise<MediaGeneration> {
    return this.invoke('db:media:update', params);
  }

  async deleteMedia(id: string): Promise<void> {
    return this.invoke('db:media:delete', { id });
  }
}

export const ipcClient = new IpcClient();
