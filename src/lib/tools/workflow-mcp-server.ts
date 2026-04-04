import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createWorkflowCodeRunTool } from './workflow-code-run-tool';

export const WORKFLOW_MCP_SERVER_NAME = 'lumos-workflow';

export function createWorkflowMcpServer() {
  return createSdkMcpServer({
    name: WORKFLOW_MCP_SERVER_NAME,
    tools: [
      createWorkflowCodeRunTool(),
    ],
  });
}
