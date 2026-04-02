import { z } from 'zod';
import { WORKFLOW_AGENT_ROLES, type WorkflowStepType } from './types';

export interface StepCompilerDefinition {
  type: WorkflowStepType;
  runtimeBinding: 'agentStep' | 'notificationStep' | 'capabilityStep' | 'waitStep';
  inputSchema: z.ZodType<Record<string, unknown>>;
}

const supportedWorkflowAgentRoleValues = [...WORKFLOW_AGENT_ROLES, 'general'] as const;

const codeConfigSchema = z.object({
  handler: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
  strategy: z.enum(['code-only', 'code-first', 'agent-only']).optional(),
}).strict();

const agentStepInputSchema: z.ZodType<Record<string, unknown>> = z.object({
  prompt: z.string().min(1),
  preset: z.string().min(1).optional(),
  role: z.enum(supportedWorkflowAgentRoleValues).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  outputMode: z.enum(['structured', 'plain-text']).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  code: codeConfigSchema.optional(),
}).strict();

const notificationStepInputSchema: z.ZodType<Record<string, unknown>> = z.object({
  message: z.string().min(1),
  level: z.enum(['info', 'warning', 'error']).optional(),
  channel: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
}).strict();

const capabilityStepInputSchema: z.ZodType<Record<string, unknown>> = z.object({
  capabilityId: z.string().min(1),
  input: z.unknown(),
}).strict();

const waitStepInputSchema: z.ZodType<Record<string, unknown>> = z.object({
  durationMs: z.number().int().min(0).max(3_600_000),
}).strict();

// Partial because v2 control flow types (if-else, for-each, while)
// are validated by their own schemas in dsl.ts, not through this registry.
export const STEP_REGISTRY: Partial<Record<WorkflowStepType, StepCompilerDefinition>> = {
  agent: {
    type: 'agent',
    runtimeBinding: 'agentStep',
    inputSchema: agentStepInputSchema,
  },
  notification: {
    type: 'notification',
    runtimeBinding: 'notificationStep',
    inputSchema: notificationStepInputSchema,
  },
  capability: {
    type: 'capability',
    runtimeBinding: 'capabilityStep',
    inputSchema: capabilityStepInputSchema,
  },
  wait: {
    type: 'wait',
    runtimeBinding: 'waitStep',
    inputSchema: waitStepInputSchema,
  },
};

export function getStepCompilerDefinition(type: string): StepCompilerDefinition | null {
  return STEP_REGISTRY[type as WorkflowStepType] ?? null;
}

export function getSupportedStepTypes(): WorkflowStepType[] {
  return Object.keys(STEP_REGISTRY) as WorkflowStepType[];
}
