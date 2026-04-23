import type { Workflow } from 'openworkflow';
import type { AgentStepCodeConfig } from './code-handler-types';
import type { WorkflowDSLV3 } from './types-v3';

export type { WorkflowDSLV3 } from './types-v3';

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type WorkflowStepType = 'agent' | 'notification' | 'capability' | 'if-else' | 'for-each' | 'while' | 'wait';
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

export interface WorkflowKnowledgeConfig {
  /** 是否启用知识库工具（默认 false） */
  enabled: boolean;
  /** 默认标签名列表（kb_tags.name，UNIQUE） */
  defaultTagNames: string[];
  /** 是否允许 agent 自行选择/覆盖标签 */
  allowAgentTagSelection: boolean;
  /** 每次检索返回的最大条数（默认 5，最多 10） */
  topK?: number;
}

/** Inline agent definition for portable DSL (used when preset ID is not available locally) */
export interface InlineAgentDef {
  name: string;
  expertise: string;
  role?: WorkflowAgentRole;
  systemPrompt?: string;
  model?: string;
  allowedTools?: ('workspace.read' | 'workspace.write' | 'shell.exec')[];
  outputMode?: 'structured' | 'plain-text';
  capabilityTags?: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
}

export interface AgentStepInput extends WorkflowStepRuntimeCarrier {
  prompt: string;
  preset?: string;
  role?: WorkflowAgentRole;
  model?: string;
  tools?: string[];
  context?: Record<string, unknown>;
  outputMode?: 'structured' | 'plain-text';
  /** JSON Schema 描述期望的输出结构，注入到 agent prompt 中引导结构化输出 */
  outputSchema?: Record<string, unknown>;
  /** 代码模式配置：优先执行固定代码，失败可回退到 agent */
  code?: AgentStepCodeConfig;
  /** 知识库访问配置（步骤级别，默认禁用） */
  knowledge?: WorkflowKnowledgeConfig;
  /** Inline agent definition — fallback when preset ID doesn't exist locally (e.g. imported workflow) */
  agentDef?: InlineAgentDef;
  /**
   * 用户写的"验收说明"(natural language)——Phase 2 判分老师的唯一信息源。
   * 留空 → 跳过 Phase 2，直接信任 Phase 1 outcome。
   * 非空 → classifier 只读这个字段 + agent 输出 + 工具调用事实，不再读 prompt。
   */
  expectedOutput?: string;
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

export interface WaitStepInput extends WorkflowStepRuntimeCarrier {
  durationMs: number;
}

export interface ApprovalStepInput extends WorkflowStepRuntimeCarrier {
  prompt: string;
  approvers: {
    mode: 'any' | 'all' | 'quorum';
    users: string[];
    quorum?: number;
  };
  formSchema?: Record<string, unknown>;
  timeout?: {
    duration: string;
    onTimeout: 'approve' | 'reject' | 'goto';
    target?: string;
  };
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

export type AnyWorkflowDSL = WorkflowDSLV3;

export interface CompiledWorkflowManifest {
  dslVersion: 'v3';
  artifactKind: 'workflow-factory-module';
  exportedSymbol: 'buildWorkflow';
  workflowName: string;
  workflowVersion: string;
  stepIds: string[];
  stepTypes: (WorkflowStepType | 'parallel' | 'join' | 'approval')[];
  stepTimeoutsMs?: number[];
  /** Max total workflow execution time from DSL (milliseconds) */
  maxDurationMs?: number;
  warnings: string[];
}

export interface WorkflowStepLifecycleEvent {
  workflowRunId: string;
  stepId: string;
  /** 1-based attempt number within a retry loop; only set by `__executeStep`. */
  attempt?: number;
  /** Total attempts allowed (retryPolicy.maximumAttempts ?? 1). */
  maxAttempts?: number;
}

export interface WorkflowStepOutputEvent extends WorkflowStepLifecycleEvent {
  /** Synthetic aggregated output the container emitter wrote to stepOutputs. */
  output: unknown;
  /** Step type that produced the output — emitters set this to 'if-else' / 'for-each' / 'while'. */
  stepType: WorkflowStepType;
}

export interface WorkflowRuntimeBindings {
  agentStep: (input: AgentStepInput) => Promise<StepResult>;
  notificationStep: (input: NotificationStepInput) => Promise<StepResult>;
  capabilityStep: (input: CapabilityStepInput) => Promise<StepResult>;
  waitStep: (input: WaitStepInput) => Promise<StepResult>;
  approvalStep?: (input: ApprovalStepInput) => Promise<StepResult>;
  onStepStarted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepCompleted?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  onStepSkipped?: (event: WorkflowStepLifecycleEvent) => Promise<void> | void;
  /**
   * Fires after container nodes (if-else / for-each / while) emit their
   * aggregated output. Regular nodes persist via agentStep/etc. wrappers,
   * so this hook only fires for container emitters in compiler-v3.
   */
  onStepOutput?: (event: WorkflowStepOutputEvent) => Promise<void> | void;
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
  /** Optional schedule/debug run-history row used by the run detail UI. */
  runHistoryId?: string;
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
