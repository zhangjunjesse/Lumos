import type { Workflow } from 'openworkflow';
import type { AgentStepCodeConfig } from './code-handler-types';

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowStepType = 'agent' | 'notification' | 'capability' | 'if-else' | 'for-each' | 'while' | 'wait';
export type WorkflowStepTypeV1 = 'agent' | 'notification' | 'capability';
export type WorkflowStepTypeV2Control = 'if-else' | 'for-each' | 'while';
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
  preset?: string;
  role?: WorkflowAgentRole;
  model?: string;
  tools?: string[];
  context?: Record<string, unknown>;
  outputMode?: 'structured' | 'plain-text';
  /** 代码模式配置：优先执行固定代码，失败可回退到 agent */
  code?: AgentStepCodeConfig;
}

export interface NotificationStepInput extends WorkflowStepRuntimeCarrier {
  message: string;
  level?: 'info' | 'warning' | 'error';
  channel?: string;
  sessionId?: string;
}

export interface CapabilityStepInput extends WorkflowStepRuntimeCarrier {
  capabilityId: string;
  input: unknown;
}

export interface WaitStepInput {
  durationMs: number;
}

export type ConditionExpr =
  | { op: 'exists'; ref: string }
  | { op: 'eq'; left: string; right: unknown }
  | { op: 'neq'; left: string; right: unknown }
  | { op: 'gt'; left: string; right: unknown }
  | { op: 'lt'; left: string; right: unknown }
  | { op: 'and'; conditions: ConditionExpr[] }
  | { op: 'or'; conditions: ConditionExpr[] }
  | { op: 'not'; condition: ConditionExpr };

export interface WorkflowStepPolicy {
  timeoutMs?: number;
  retry?: {
    maximumAttempts?: number;
  };
  /** When true, step failure does not throw — result is stored in stepOutputs for if-else to reference */
  continueOnFailure?: boolean;
}

export interface WorkflowStepMetadata {
  position?: { x: number; y: number };
  label?: string;
}

export interface WorkflowStep {
  id: string;
  type: WorkflowStepType;
  dependsOn?: string[];
  when?: ConditionExpr;
  input?: Record<string, unknown>;
  policy?: WorkflowStepPolicy;
  metadata?: WorkflowStepMetadata;
}

export interface WorkflowParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description?: string;
  default?: string | number | boolean;
  required?: boolean;
}

export interface WorkflowDSL {
  version: 'v1';
  name: string;
  params?: WorkflowParamDef[];
  steps: WorkflowStep[];
}

export interface WorkflowDSLV2 {
  version: 'v2';
  name: string;
  description?: string;
  params?: WorkflowParamDef[];
  steps: WorkflowStep[];
}

export type AnyWorkflowDSL = WorkflowDSL | WorkflowDSLV2;

export interface CompiledWorkflowManifest {
  dslVersion: 'v1' | 'v2';
  artifactKind: 'workflow-factory-module';
  exportedSymbol: 'buildWorkflow';
  workflowName: string;
  workflowVersion: string;
  stepIds: string[];
  stepTypes: WorkflowStepType[];
  stepTimeoutsMs?: number[];
  warnings: string[];
}

export interface WorkflowStepLifecycleEvent {
  workflowRunId: string;
  stepId: string;
}

export interface WorkflowRuntimeBindings {
  agentStep: (input: AgentStepInput) => Promise<StepResult>;
  notificationStep: (input: NotificationStepInput) => Promise<StepResult>;
  capabilityStep: (input: CapabilityStepInput) => Promise<StepResult>;
  waitStep: (input: WaitStepInput) => Promise<StepResult>;
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
