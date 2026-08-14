import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createImageGenTool, type ImageProviderBinding } from './image-gen-tool';
import { createVideoGenTool } from './video-gen-tool';

export const LUMOS_MCP_SERVER_NAME = 'lumos-image';

export function createLumosMcpServer(sessionId?: string, userId?: string, imageProviderBinding?: ImageProviderBinding) {
  return createSdkMcpServer({
    name: LUMOS_MCP_SERVER_NAME,
    tools: [
      // 绑定由调用方按就近原则提供(会话级/成员级);传函数则每次出图现解析,
      // 用户中途切换服务商即时生效(#65);空则全局默认
      createImageGenTool(sessionId, userId, imageProviderBinding),
      createVideoGenTool(sessionId, userId),
    ],
  });
}
