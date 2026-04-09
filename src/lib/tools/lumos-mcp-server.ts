import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createImageGenTool } from './image-gen-tool';

export const LUMOS_MCP_SERVER_NAME = 'lumos-image';

export function createLumosMcpServer(sessionId?: string, userId?: string) {
  return createSdkMcpServer({
    name: LUMOS_MCP_SERVER_NAME,
    tools: [
      createImageGenTool(sessionId, userId),
    ],
  });
}
