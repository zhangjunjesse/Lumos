import { createLumosMcpServer } from '@/lib/tools/lumos-mcp-server';
import { IMAGE_GEN_IN_PROCESS_HINT } from '@/lib/tools/image-gen-hints';

export interface BuiltinAgentContext {
  inProcessMcpServers?: Record<string, ReturnType<typeof createLumosMcpServer>>;
  systemPromptSuffix?: string;
}

/**
 * Shared built-in agent runtime context used by both chat and workflow agent
 * execution so built-in MCP tools stay aligned across entry points.
 */
export function buildBuiltinAgentContext(input: {
  sessionId?: string;
  userId?: string;
} = {}): BuiltinAgentContext {
  const lumosMcpServer = createLumosMcpServer(input.sessionId, input.userId);

  return {
    inProcessMcpServers: {
      [lumosMcpServer.name]: lumosMcpServer,
    },
    systemPromptSuffix: IMAGE_GEN_IN_PROCESS_HINT,
  };
}
