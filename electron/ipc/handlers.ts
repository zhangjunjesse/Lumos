import { ipcMain } from 'electron';
import { z } from 'zod';
import type { IpcRequest, IpcResponse } from '../../src/types/ipc';
import { DatabaseService } from '../db/service';
import {
  SessionListSchema,
  SessionGetSchema,
  SessionCreateSchema,
  SessionUpdateSchema,
  SessionDeleteSchema,
  ProviderListSchema,
  ProviderGetSchema,
  ProviderCreateSchema,
  ProviderUpdateSchema,
  ProviderDeleteSchema,
  McpServerListSchema,
  McpServerGetSchema,
  McpServerCreateSchema,
  McpServerUpdateSchema,
  McpServerDeleteSchema,
  SkillListSchema,
  SkillGetSchema,
  SkillCreateSchema,
  SkillUpdateSchema,
  SkillDeleteSchema,
  TaskListSchema,
  TaskGetSchema,
  TaskCreateSchema,
  TaskUpdateSchema,
  TaskDeleteSchema,
  MediaListSchema,
  MediaGetSchema,
  MediaCreateSchema,
  MediaUpdateSchema,
  MediaDeleteSchema,
} from './schemas';

// Helper function to create type-safe IPC handlers
function createHandler<TReq, TRes>(
  schema: z.ZodSchema<TReq>,
  handler: (data: TReq) => Promise<TRes>
) {
  return async (
    _event: Electron.IpcMainInvokeEvent,
    request: IpcRequest<TReq>
  ): Promise<IpcResponse<TRes>> => {
    const requestId = request.requestId ?? 'unknown';

    try {
      // Validate request data
      const validatedData = schema.parse(request.data);

      // Execute handler
      const result = await handler(validatedData);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error(`[IPC Handler Error] ${requestId}:`, error);

      return {
        success: false,
        error: {
          code: error instanceof z.ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          details: error instanceof z.ZodError ? error.errors : undefined,
        },
      };
    }
  };
}

export function registerIpcHandlers(dbService: DatabaseService) {
  // Sessions
  ipcMain.handle(
    'db:sessions:list',
    createHandler(SessionListSchema, (data) => dbService.listSessions(data))
  );

  ipcMain.handle(
    'db:sessions:get',
    createHandler(SessionGetSchema, (data) => dbService.getSession(data))
  );

  ipcMain.handle(
    'db:sessions:create',
    createHandler(SessionCreateSchema, (data) => dbService.createSession(data))
  );

  ipcMain.handle(
    'db:sessions:update',
    createHandler(SessionUpdateSchema, (data) => dbService.updateSession(data))
  );

  ipcMain.handle(
    'db:sessions:delete',
    createHandler(SessionDeleteSchema, (data) => dbService.deleteSession(data))
  );

  // Providers
  ipcMain.handle(
    'db:providers:list',
    createHandler(ProviderListSchema, (data) => dbService.listProviders(data))
  );

  ipcMain.handle(
    'db:providers:get',
    createHandler(ProviderGetSchema, (data) => dbService.getProvider(data))
  );

  ipcMain.handle(
    'db:providers:create',
    createHandler(ProviderCreateSchema, (data) => dbService.createProvider(data))
  );

  ipcMain.handle(
    'db:providers:update',
    createHandler(ProviderUpdateSchema, (data) => dbService.updateProvider(data))
  );

  ipcMain.handle(
    'db:providers:delete',
    createHandler(ProviderDeleteSchema, (data) => dbService.deleteProvider(data))
  );

  // MCP Servers
  ipcMain.handle(
    'db:mcp-servers:list',
    createHandler(McpServerListSchema, (data) => dbService.listMcpServers(data))
  );

  ipcMain.handle(
    'db:mcp-servers:get',
    createHandler(McpServerGetSchema, (data) => dbService.getMcpServer(data))
  );

  ipcMain.handle(
    'db:mcp-servers:create',
    createHandler(McpServerCreateSchema, (data) => dbService.createMcpServer(data))
  );

  ipcMain.handle(
    'db:mcp-servers:update',
    createHandler(McpServerUpdateSchema, (data) => dbService.updateMcpServer(data))
  );

  ipcMain.handle(
    'db:mcp-servers:delete',
    createHandler(McpServerDeleteSchema, (data) => dbService.deleteMcpServer(data))
  );

  // Skills
  ipcMain.handle(
    'db:skills:list',
    createHandler(SkillListSchema, (data) => dbService.listSkills(data))
  );

  ipcMain.handle(
    'db:skills:get',
    createHandler(SkillGetSchema, (data) => dbService.getSkill(data))
  );

  ipcMain.handle(
    'db:skills:create',
    createHandler(SkillCreateSchema, (data) => dbService.createSkill(data))
  );

  ipcMain.handle(
    'db:skills:update',
    createHandler(SkillUpdateSchema, (data) => dbService.updateSkill(data))
  );

  ipcMain.handle(
    'db:skills:delete',
    createHandler(SkillDeleteSchema, (data) => dbService.deleteSkill(data))
  );

  // Tasks
  ipcMain.handle(
    'db:tasks:list',
    createHandler(TaskListSchema, (data) => dbService.listTasks(data))
  );

  ipcMain.handle(
    'db:tasks:get',
    createHandler(TaskGetSchema, (data) => dbService.getTask(data))
  );

  ipcMain.handle(
    'db:tasks:create',
    createHandler(TaskCreateSchema, (data) => dbService.createTask(data))
  );

  ipcMain.handle(
    'db:tasks:update',
    createHandler(TaskUpdateSchema, (data) => dbService.updateTask(data))
  );

  ipcMain.handle(
    'db:tasks:delete',
    createHandler(TaskDeleteSchema, (data) => dbService.deleteTask(data))
  );

  // Media Generations
  ipcMain.handle(
    'db:media:list',
    createHandler(MediaListSchema, (data) => dbService.listMedia(data))
  );

  ipcMain.handle(
    'db:media:get',
    createHandler(MediaGetSchema, (data) => dbService.getMedia(data))
  );

  ipcMain.handle(
    'db:media:create',
    createHandler(MediaCreateSchema, (data) => dbService.createMedia(data))
  );

  ipcMain.handle(
    'db:media:update',
    createHandler(MediaUpdateSchema, (data) => dbService.updateMedia(data))
  );

  ipcMain.handle(
    'db:media:delete',
    createHandler(MediaDeleteSchema, (data) => dbService.deleteMedia(data))
  );

  console.log('[IPC] Handlers registered');
}
