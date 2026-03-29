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
export type SchedulingPlanSource = 'heuristic' | 'llm';
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
  fallbackUsed?: 'heuristic-preview';
  fallbackReason?: string;
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
// Internal interfaces (exported for sibling planner-*.ts modules)
// ---------------------------------------------------------------------------

export interface SearchTarget {
  engine: 'baidu' | 'google' | 'bing' | 'duckduckgo';
  engineLabel: string;
  query: string;
  url: string;
}

export interface PromptCapabilityPlanningContext {
  available: PublishedPromptCapabilitySummary[];
  explicitlyMatchedIds: string[];
}

export interface CodeCapabilityPlanningContext {
  available: PublishedCodeCapabilitySummary[];
  explicitlyMatchedId?: string;
  explicitInput?: Record<string, unknown>;
}

export interface StructuredDeliverableCapability {
  capabilityId: string;
  capabilityName: string;
  targetFormat: 'pdf' | 'docx' | 'html' | 'epub';
  contentInputKey: string;
  formatInputKey: string;
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
// Intent / pattern constants
// ---------------------------------------------------------------------------

export const IMPLEMENTATION_INTENT_PATTERNS = [
  '实现',
  '开发',
  '搭建',
  '重构',
  '修复',
  '改造',
  '接入',
  'build',
  'implement',
  'develop',
  'refactor',
  'fix',
];
export const REPORT_INTENT_PATTERNS = [
  '调研',
  '研究',
  '报告',
  '分析',
  '汇总',
  '总结',
  '对比',
  '比较',
  'report',
  'research',
  'analysis',
  'summary',
];
export const EXPORT_INTENT_PATTERNS = [
  'pdf',
  '导出',
  '导成',
  '转成',
  '保存为',
  'export',
];
export const EXTERNAL_SEARCH_INTENT_PATTERNS = [
  '搜索',
  '搜一下',
  '搜一搜',
  '查一下',
  '查询',
  '检索',
  'search',
];
export const SECURITY_RESEARCH_PATTERNS = [
  '安全',
  '安全问题',
  '漏洞',
  '威胁',
  '攻击',
  '攻击面',
  'cve',
];
export const REMEDIATION_INTENT_PATTERNS = [
  '方案',
  '整改',
  '修复建议',
  '加固',
  '缓解',
  '对策',
  '治理建议',
  '防护建议',
  '建议',
];
export const LOCAL_SEARCH_NEGATION_PATTERNS = [
  '搜索代码',
  '搜代码',
  '查代码',
  '检索代码',
  '搜仓库',
  '搜索仓库',
  '搜本地',
  '搜索本地',
  '搜索文件',
  '搜文件',
  '搜索知识库',
  '搜知识库',
  '搜索记忆',
  '搜记忆',
  'grep',
  'rg ',
];
export const DELIVERABLE_FORMAT_ALIASES: Array<{
  format: StructuredDeliverableCapability['targetFormat'];
  patterns: string[];
}> = [
  { format: 'pdf', patterns: ['pdf'] },
  { format: 'docx', patterns: ['docx', 'word', 'word文档'] },
  { format: 'html', patterns: ['html'] },
  { format: 'epub', patterns: ['epub'] },
];
export const CAPABILITY_CONTENT_INPUT_CANDIDATES = [
  'mdcontent',
  'markdowncontent',
  'markdown',
  'content',
  'text',
  'body',
  'sourcecontent',
  'source',
  'input',
  'inputcontent',
];
export const CAPABILITY_FORMAT_INPUT_CANDIDATES = [
  'targetformat',
  'format',
  'outputformat',
  'exportformat',
  'toformat',
];

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
  role: z.enum(['worker', 'researcher', 'coder', 'integration', 'general']).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  outputMode: z.enum(['structured', 'plain-text']).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const plannerBrowserStepInputSchema = z.object({
  action: z.enum(['navigate', 'click', 'fill', 'screenshot']),
  url: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  createPage: z.boolean().optional(),
}).strict();

export const plannerNotificationStepInputSchema = z.object({
  message: z.string().min(1),
  level: z.enum(['info', 'warning', 'error']).optional(),
  channel: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
}).strict();

export const plannerCapabilityStepInputSchema = z.object({
  capabilityId: z.string().min(1),
  input: z.unknown(),
}).strict();

export const plannerWorkflowBaseStepSchema = z.object({
  id: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).optional(),
  when: plannerConditionExprSchema.optional(),
  policy: plannerStepPolicySchema,
});

export const plannerWorkflowStepSchema = z.discriminatedUnion('type', [
  plannerWorkflowBaseStepSchema.extend({
    type: z.literal('agent'),
    input: plannerAgentStepInputSchema,
  }),
  plannerWorkflowBaseStepSchema.extend({
    type: z.literal('browser'),
    input: plannerBrowserStepInputSchema,
  }),
  plannerWorkflowBaseStepSchema.extend({
    type: z.literal('notification'),
    input: plannerNotificationStepInputSchema,
  }),
  plannerWorkflowBaseStepSchema.extend({
    type: z.literal('capability'),
    input: plannerCapabilityStepInputSchema,
  }),
]);

export const plannerWorkflowDslSchema = z.object({
  version: z.literal('v1'),
  name: z.string().min(1),
  steps: z.array(plannerWorkflowStepSchema).min(1).max(20),
}).strict();

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
