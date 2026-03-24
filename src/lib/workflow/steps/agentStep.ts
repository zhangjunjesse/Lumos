import { executeWorkflowAgentStep } from '../subagent';
import type { AgentStepInput, StepResult } from '../types';

export async function agentStep(input: AgentStepInput): Promise<StepResult> {
  return executeWorkflowAgentStep(input);
}
