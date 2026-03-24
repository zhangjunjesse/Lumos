import type { Workflow } from 'openworkflow';

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowStepType = 'agent' | 'browser' | 'notification' | 'capability';
export const WORKFLOW_AGENT_ROLES = ['worker', 'researcher', 'coder', 'integration'] as const;
export type WorkflowAgentRole = (typeof WORKFLOW_AGENT_ROLES)[number];
export type WorkflowAgentExecutionMode = 'auto' | 'claude' | 'synthetic';

export type WorkflowExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StepResult<TOutput = unknown> {
  success: boolean;
  output: TOutput | null;
  error?: string;
  metadata?: Record<string, JsonValue>;
}

export interface WorkflowStepRuntimeContext {
  workflowRunId: string;
  stepId: string;
  stepType: WorkflowStepType;
  timeoutMs?: number;
  taskId?: string;
  sessionId?: string;
  requestedModel?: string;
  workingDirectory?: string;
}

export interface WorkflowStepRuntimeCarrier {
  __runtime?: WorkflowStepRuntimeContext;
}

export interface AgentStepInput extends WorkflowStepRuntimeCarrier {
  prompt: string;
  role?: WorkflowAgentRole;
  model?: string;
  tools?: string[];
  context?: Record<string, unknown>;
  outputMode?: 'structured' | 'plain-text';
}

export interface BrowserStepInput extends WorkflowStepRuntimeCarrier {
  action: 'navigate' | 'click' | 'fill' | 'screenshot';
  url?: string;
  selector?: string;
  value?: string;
  pageId?: string;
  createPage?: boolean;
}

export interface NotificationStepInput extends WorkflowStepRuntimeCarrier {
  message: string;
  level?: 'info' | 'warning' | 'error';
  channel?: string;
  sessionId?: string;
}

export type ConditionExpr =
  | { op: 'exists'; ref: string }
  | { op: 'eq'; left: string; right: unknown }
  | { op: 'neq'; left: string; right: unknown };

export interface WorkflowStepPolicy {
  timeoutMs?: number;
  retry?: {
    maximumAttempts?: number;
  };
}

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  dependsOn?: string[];
  when?: ConditionExpr;
  input?: Record<string, unknown>;
  policy?: WorkflowStepPolicy;
}

export interface WorkflowDSL {
  version: 'v1';
  name: string;
  steps: WorkflowStep[];
}

export interface CompiledWorkflowManifest {
  dslVersion: 'v1';
  artifactKind: 'workflow-factory-module';
  exportedSymbol: 'buildWorkflow';
  workflowName: string;
  workflowVersion: string;
  stepIds: string[];
  stepTypes: WorkflowStepType[];
  warnings: string[];
}

export interface WorkflowStepLifecycleEvent {
  workflowRunId: string;
  stepId: string;
}

export interface WorkflowRuntimeBindings {
  agentStep: (input: AgentStepInput) => Promise<StepResult>;
  browserStep: (input: BrowserStepInput) => Promise<StepResult>;
  notificationStep: (input: NotificationStepInput) => Promise<StepResult>;
  capabilityStep: (input: { capabilityId: string; input: unknown }) => Promise<StepResult>;
  onStepStarted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepCompleted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepSkipped?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
}

export interface WorkflowFactoryModule {
  buildWorkflow: (
    runtime: WorkflowRuntimeBindings
  ) => Workflow<unknown, unknown, unknown>;
}

export interface GenerateWorkflowValidation {
  valid: boolean;
  errors: string[];
}

export interface GenerateWorkflowResult {
  code: string;
  manifest: CompiledWorkflowManifest;
  validation: GenerateWorkflowValidation;
}

export interface SubmitWorkflowRequest {
  taskId: string;
  workflowCode: string;
  workflowManifest: CompiledWorkflowManifest;
  inputs: Record<string, unknown>;
  timeoutMs?: number;
}

export interface SubmitWorkflowResponse {
  workflowId: string;
  status: 'accepted' | 'rejected';
  errors?: string[];
}

export interface WorkflowStatusResponse {
  status: WorkflowExecutionStatus;
  progress: number;
  currentStep?: string;
  completedSteps: string[];
  result?: unknown;
  error?: unknown;
}
