import { z } from 'zod';
import { WORKFLOW_AGENT_ROLES, type WorkflowStepType } from './types';

export interface StepCompilerDefinition {
  type: WorkflowStepType;
  runtimeBinding: 'agentStep' | 'browserStep' | 'notificationStep' | 'capabilityStep';
  inputSchema: z.ZodType<Record<string, unknown>>;
}

const supportedWorkflowAgentRoleValues = [...WORKFLOW_AGENT_ROLES, 'general'] as const;

const agentStepInputSchema: z.ZodType<Record<string, unknown>> = z.object({
  prompt: z.string().min(1),
  role: z.enum(supportedWorkflowAgentRoleValues).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  outputMode: z.enum(['structured', 'plain-text']).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

const browserStepInputSchema: z.ZodType<Record<string, unknown>> = z.object({
  action: z.enum(['navigate', 'click', 'fill', 'screenshot']),
  url: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  createPage: z.boolean().optional(),
}).strict().superRefine((input, ctx) => {
  if (input.action === 'navigate' && !input.url) {
    ctx.addIssue({
      code: 'custom',
      message: 'browser.navigate requires "url"',
      path: ['url'],
    });
  }

  if ((input.action === 'click' || input.action === 'fill') && !input.selector) {
    ctx.addIssue({
      code: 'custom',
      message: `browser.${input.action} requires "selector"`,
      path: ['selector'],
    });
  }

  if (input.action === 'fill' && !input.value) {
    ctx.addIssue({
      code: 'custom',
      message: 'browser.fill requires "value"',
      path: ['value'],
    });
  }
});

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

export const STEP_REGISTRY: Record<WorkflowStepType, StepCompilerDefinition> = {
  agent: {
    type: 'agent',
    runtimeBinding: 'agentStep',
    inputSchema: agentStepInputSchema,
  },
  browser: {
    type: 'browser',
    runtimeBinding: 'browserStep',
    inputSchema: browserStepInputSchema,
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
};

export function getStepCompilerDefinition(type: string): StepCompilerDefinition | null {
  return STEP_REGISTRY[type as WorkflowStepType] ?? null;
}

export function getSupportedStepTypes(): WorkflowStepType[] {
  return Object.keys(STEP_REGISTRY) as WorkflowStepType[];
}
