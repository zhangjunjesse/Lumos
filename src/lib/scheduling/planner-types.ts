import { z } from 'zod';
import type { WorkflowDSL } from '@/lib/workflow/types';
import type { ApiProvider } from '@/types';
import type {
  PublishedCodeCapabilitySummary,
  PublishedPromptCapabilitySummary,
} from '@/lib/db/capabilities';

// ---------------------------------------------------------------------------
// Exported types / interfaces
// ---------------------------------------------------------------------------

export type SchedulingStrategy = 'workflow' | 'simple';
export type SchedulingPlanSource = 'llm';
export type SchedulingTaskComplexity = 'simple' | 'moderate' | 'complex';

export interface SchedulingPlanAnalysis {
  complexity: SchedulingTaskComplexity;
  needsBrowser: boolean;
  needsNotification: boolean;
  needsMultipleSteps: boolean;
  needsParallel: boolean;
  detectedUrl?: string;
  detectedUrls?: string[];
}

export interface SchedulingPlan {
  strategy: SchedulingStrategy;
  source: SchedulingPlanSource;
  reason: string;
  estimatedDurationSeconds: number;
  workflowDsl?: WorkflowDSL;
  analysis: SchedulingPlanAnalysis;
  model?: string;
  diagnostics?: SchedulingPlanDiagnostics;
}

export interface SchedulingPlanDiagnostics {
  llmAttempted: boolean;
  llmAttempts: number;
  llmErrors: string[];
  llmTimeoutMs?: number;
  llmSkippedReason?: string;
}

export class SchedulingPlannerError extends Error {
  diagnostics: SchedulingPlanDiagnostics;

  constructor(message: string, diagnostics: SchedulingPlanDiagnostics) {
    super(message);
    this.name = 'SchedulingPlannerError';
    this.diagnostics = diagnostics;
  }
}

// ---------------------------------------------------------------------------
// Planning context types (used by planner-capabilities and planner-prompt)
// ---------------------------------------------------------------------------

export interface PromptCapabilityPlanningContext {
  available: PublishedPromptCapabilitySummary[];
  explicitlyMatchedIds: string[];
}

export interface CodeCapabilityPlanningContext {
  available: PublishedCodeCapabilitySummary[];
  explicitlyMatchedId?: string;
  explicitInput?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// PlannerModelContext / PlannerProviderRow
// ---------------------------------------------------------------------------

export interface PlannerModelContext {
  provider: ApiProvider;
  model: string;
  workingDirectory?: string;
}

export type PlannerProviderRow = Pick<
  ApiProvider,
  'id'
  | 'provider_type'
  | 'api_protocol'
  | 'base_url'
  | 'capabilities'
  | 'api_key'
  | 'auth_mode'
  | 'model_catalog'
  | 'model_catalog_source'
  | 'model_catalog_updated_at'
>;

// ---------------------------------------------------------------------------
// Duration / timeout constants
// ---------------------------------------------------------------------------

export const SIMPLE_ESTIMATED_DURATION_SECONDS = 45;
export const WORKFLOW_ESTIMATED_DURATION_SECONDS = 120;
export const BROWSER_WORKFLOW_ESTIMATED_DURATION_SECONDS = 180;
export const AGENT_STEP_TIMEOUT_MS = 90_000;
export const LONG_AGENT_STEP_TIMEOUT_MS = 180_000;
export const REPORT_WRITING_TIMEOUT_MS = 420_000;
export const REPORT_SYNTHESIS_TIMEOUT_MS = 240_000;
export const BROWSER_STEP_TIMEOUT_MS = 45_000;
export const NOTIFICATION_STEP_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const optionalPlannerUrlSchema = z.preprocess((value) => {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized || undefined;
}, z.string().url().optional());

export const optionalPlannerUrlArraySchema = z.preprocess((value) => {
  if (value == null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    return value;
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}, z.array(z.string().url()).optional());

export const plannerStepPolicySchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  retry: z.object({
    maximumAttempts: z.number().int().positive().optional(),
  }).strict().optional(),
}).strict().optional();

export const plannerConditionExprSchema = z.union([
  z.object({
    op: z.literal('exists'),
    ref: z.string().min(1),
  }).strict(),
  z.object({
    op: z.literal('eq'),
    left: z.string().min(1),
    right: z.unknown(),
  }).strict(),
  z.object({
    op: z.literal('neq'),
    left: z.string().min(1),
    right: z.unknown(),
  }).strict(),
]);

export const plannerAgentStepInputSchema = z.object({
  prompt: z.string().min(1),
  preset: z.string().min(1).optional(),
  role: z.enum(['worker', 'researcher', 'coder', 'integration', 'general']).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  outputMode: z.enum(['structured', 'plain-text']).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const plannerWorkflowBaseStepSchema = z.object({
  id: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).optional(),
  when: plannerConditionExprSchema.optional(),
  policy: plannerStepPolicySchema,
});

export const plannerWorkflowStepSchema = plannerWorkflowBaseStepSchema.extend({
  type: z.literal('agent'),
  input: plannerAgentStepInputSchema,
});

export const plannerWorkflowDslSchema = z.object({
  version: z.literal('v1'),
  name: z.string().min(1),
  steps: z.array(plannerWorkflowStepSchema).min(1).max(20),
}).strict();

export interface WorkflowAgentPresetSummary {
  id: string;
  name: string;
  expertise: string;
  category: 'builtin' | 'user';
}

export interface WorkflowAgentPlanningContext {
  available: WorkflowAgentPresetSummary[];
}

export const plannerResponseSchema = z.object({
  strategy: z.enum(['workflow', 'simple']),
  reason: z.string().min(1),
  analysis: z.object({
    complexity: z.enum(['simple', 'moderate', 'complex']),
    needsBrowser: z.boolean(),
    needsNotification: z.boolean(),
    needsMultipleSteps: z.boolean(),
    needsParallel: z.boolean(),
    detectedUrl: optionalPlannerUrlSchema,
    detectedUrls: optionalPlannerUrlArraySchema,
  }).strict().optional(),
  workflowDsl: plannerWorkflowDslSchema.nullable().optional(),
}).strict();
