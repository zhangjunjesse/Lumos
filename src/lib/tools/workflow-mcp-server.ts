import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { createWorkflowCodeRunTool } from './workflow-code-run-tool';
import { createWorkflowAgentStepRunTool } from './workflow-agent-step-run-tool';
import {
  createListWorkflowAgentsTool,
  createGetWorkflowAgentTool,
} from './workflow-agents-tool';

export const WORKFLOW_MCP_SERVER_NAME = 'lumos-workflow';

export function createWorkflowMcpServer() {
  return createSdkMcpServer({
    name: WORKFLOW_MCP_SERVER_NAME,
    tools: [
      createWorkflowCodeRunTool(),
      createWorkflowAgentStepRunTool(),
      createListWorkflowAgentsTool(),
      createGetWorkflowAgentTool(),
    ],
  });
}
