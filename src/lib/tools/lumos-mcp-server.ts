import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createImageGenTool } from './image-gen-tool';
import { createVideoGenTool } from './video-gen-tool';

export const LUMOS_MCP_SERVER_NAME = 'lumos-image';

export function createLumosMcpServer(sessionId?: string, userId?: string, imageProviderId?: string) {
  return createSdkMcpServer({
    name: LUMOS_MCP_SERVER_NAME,
    tools: [
      // imageProviderId 由调用方按就近原则解析后传入(会话级/成员级);空则全局默认
      createImageGenTool(sessionId, userId, imageProviderId),
      createVideoGenTool(sessionId, userId),
    ],
  });
}
