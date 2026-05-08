import '@/lib/wechat-assistant/workflow-handlers';
import '@/lib/app/native-automation-workflow-handler';

import { executeWorkflowAgentStep } from '../subagent';
import type { AgentStepInput, StepResult } from '../types';

export async function agentStep(input: AgentStepInput): Promise<StepResult> {
  return executeWorkflowAgentStep(input);
}
