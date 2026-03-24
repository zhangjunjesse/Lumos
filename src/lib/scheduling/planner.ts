import { z } from 'zod';
import { getSession, getSetting } from '@/lib/db/sessions';
import { getAllProviders, getProvider } from '@/lib/db/providers';
import {
  listPublishedCodeCapabilities,
  listPublishedPromptCapabilities,
  type PublishedCodeCapabilitySummary,
  type PublishedPromptCapabilitySummary,
} from '@/lib/db/capabilities';
import { getProviderModelOptions } from '@/lib/model-metadata';
import { generateObjectWithClaudeSdk } from '@/lib/claude/structured-output';
import type { Task } from '@/lib/task-management/types';
import { getSchedulingPlannerConfig } from '@/lib/workflow/agent-config';
import { validateWorkflowDsl } from '@/lib/workflow/dsl';
import type { WorkflowDSL, WorkflowStep } from '@/lib/workflow/types';
import type { ApiProvider } from '@/types';

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

interface SearchTarget {
  engine: 'baidu' | 'google' | 'bing' | 'duckduckgo';
  engineLabel: string;
  query: string;
  url: string;
}

interface PromptCapabilityPlanningContext {
  available: PublishedPromptCapabilitySummary[];
  explicitlyMatchedIds: string[];
}

interface CodeCapabilityPlanningContext {
  available: PublishedCodeCapabilitySummary[];
  explicitlyMatchedId?: string;
  explicitInput?: Record<string, unknown>;
}

interface StructuredDeliverableCapability {
  capabilityId: string;
  capabilityName: string;
  targetFormat: 'pdf' | 'docx' | 'html' | 'epub';
  contentInputKey: string;
  formatInputKey: string;
}

const SIMPLE_ESTIMATED_DURATION_SECONDS = 45;
const WORKFLOW_ESTIMATED_DURATION_SECONDS = 120;
const BROWSER_WORKFLOW_ESTIMATED_DURATION_SECONDS = 180;
const AGENT_STEP_TIMEOUT_MS = 90_000;
const LONG_AGENT_STEP_TIMEOUT_MS = 180_000;
const REPORT_WRITING_TIMEOUT_MS = 420_000;
const REPORT_SYNTHESIS_TIMEOUT_MS = 240_000;
const BROWSER_STEP_TIMEOUT_MS = 45_000;
const NOTIFICATION_STEP_TIMEOUT_MS = 15_000;
const IMPLEMENTATION_INTENT_PATTERNS = [
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
const REPORT_INTENT_PATTERNS = [
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
const EXPORT_INTENT_PATTERNS = [
  'pdf',
  '导出',
  '导成',
  '转成',
  '保存为',
  'export',
];
const EXTERNAL_SEARCH_INTENT_PATTERNS = [
  '搜索',
  '搜一下',
  '搜一搜',
  '查一下',
  '查询',
  '检索',
  'search',
];
const SECURITY_RESEARCH_PATTERNS = [
  '安全',
  '安全问题',
  '漏洞',
  '威胁',
  '攻击',
  '攻击面',
  'cve',
];
const REMEDIATION_INTENT_PATTERNS = [
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
const LOCAL_SEARCH_NEGATION_PATTERNS = [
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
const DELIVERABLE_FORMAT_ALIASES: Array<{
  format: StructuredDeliverableCapability['targetFormat'];
  patterns: string[];
}> = [
  { format: 'pdf', patterns: ['pdf'] },
  { format: 'docx', patterns: ['docx', 'word', 'word文档'] },
  { format: 'html', patterns: ['html'] },
  { format: 'epub', patterns: ['epub'] },
];
const CAPABILITY_CONTENT_INPUT_CANDIDATES = [
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
const CAPABILITY_FORMAT_INPUT_CANDIDATES = [
  'targetformat',
  'format',
  'outputformat',
  'exportformat',
  'toformat',
];
const optionalPlannerUrlSchema = z.preprocess((value) => {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim();
  return normalized || undefined;
}, z.string().url().optional());

const optionalPlannerUrlArraySchema = z.preprocess((value) => {
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

const plannerStepPolicySchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  retry: z.object({
    maximumAttempts: z.number().int().positive().optional(),
  }).strict().optional(),
}).strict().optional();

const plannerConditionExprSchema = z.union([
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

const plannerAgentStepInputSchema = z.object({
  prompt: z.string().min(1),
  role: z.enum(['worker', 'researcher', 'coder', 'integration', 'general']).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  outputMode: z.enum(['structured', 'plain-text']).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

const plannerBrowserStepInputSchema = z.object({
  action: z.enum(['navigate', 'click', 'fill', 'screenshot']),
  url: z.string().min(1).optional(),
  selector: z.string().min(1).optional(),
  value: z.string().min(1).optional(),
  pageId: z.string().min(1).optional(),
  createPage: z.boolean().optional(),
}).strict();

const plannerNotificationStepInputSchema = z.object({
  message: z.string().min(1),
  level: z.enum(['info', 'warning', 'error']).optional(),
  channel: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
}).strict();

const plannerCapabilityStepInputSchema = z.object({
  capabilityId: z.string().min(1),
  input: z.unknown(),
}).strict();

const plannerWorkflowBaseStepSchema = z.object({
  id: z.string().min(1),
  dependsOn: z.array(z.string().min(1)).optional(),
  when: plannerConditionExprSchema.optional(),
  policy: plannerStepPolicySchema,
});

const plannerWorkflowStepSchema = z.discriminatedUnion('type', [
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

const plannerWorkflowDslSchema = z.object({
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

export function buildPreviewSchedulingPlan(task: Task): SchedulingPlan {
  return buildHeuristicSchedulingPlan(task);
}

export async function resolveSchedulingPlan(
  task: Task,
  previewPlan: SchedulingPlan = buildPreviewSchedulingPlan(task),
): Promise<SchedulingPlan> {
  void previewPlan;
  const plannerConfig = getSchedulingPlannerConfig();
  const llmContext = resolvePlannerModelContext(task);
  const promptCapabilityContext = buildPromptCapabilityPlanningContext(task);
  const codeCapabilityContext = buildCodeCapabilityPlanningContext(task);
  if (!llmContext) {
    throw new SchedulingPlannerError(
      'Scheduling planner requires a usable provider/model configuration before any task can be planned.',
      {
        llmAttempted: false,
        llmAttempts: 0,
        llmErrors: [],
        llmSkippedReason: 'Scheduling planner skipped model analysis because no usable provider/model configuration could be resolved.',
      },
    );
  }

  const llmErrors: string[] = [];
  let previousAttemptError: string | undefined;

  for (let attempt = 0; attempt <= plannerConfig.plannerMaxRetries; attempt += 1) {
    try {
      const parsed = await generateObjectWithClaudeSdk({
        model: llmContext.model,
        system: plannerConfig.systemPrompt,
        prompt: buildPlannerUserPrompt(task, promptCapabilityContext, codeCapabilityContext, previousAttemptError),
        schema: plannerResponseSchema,
        sessionId: task.sessionId,
        workingDirectory: llmContext.workingDirectory,
        abortSignal: AbortSignal.timeout(plannerConfig.plannerTimeoutMs),
      });
      const normalizedAnalysis = normalizeAnalysis(parsed.analysis);
      if (parsed.strategy === 'workflow') {
        if (!parsed.workflowDsl) {
          throw new Error('Planner selected workflow but did not provide workflowDsl');
        }

        const validation = validateWorkflowDsl(parsed.workflowDsl);
        if (!validation.valid) {
          throw new Error(`Planner returned invalid workflow DSL: ${validation.errors.join('; ')}`);
        }

        const semanticErrors = validatePlannerWorkflowSemantics(parsed.workflowDsl);
        if (semanticErrors.length > 0) {
          throw new Error(`Planner returned semantically invalid workflow DSL: ${semanticErrors.join('; ')}`);
        }

        return {
          strategy: 'workflow',
          source: 'llm',
          reason: parsed.reason,
          estimatedDurationSeconds: estimateDurationSeconds(parsed.workflowDsl, normalizedAnalysis),
          workflowDsl: parsed.workflowDsl,
          analysis: normalizedAnalysis,
          model: llmContext.model,
          diagnostics: {
            llmAttempted: true,
            llmAttempts: attempt + 1,
            llmErrors,
            llmTimeoutMs: plannerConfig.plannerTimeoutMs,
          },
        };
      }

      return {
        strategy: 'simple',
        source: 'llm',
        reason: parsed.reason,
        estimatedDurationSeconds: SIMPLE_ESTIMATED_DURATION_SECONDS,
        analysis: normalizedAnalysis,
        model: llmContext.model,
        diagnostics: {
          llmAttempted: true,
          llmAttempts: attempt + 1,
          llmErrors,
          llmTimeoutMs: plannerConfig.plannerTimeoutMs,
        },
      };
    } catch (error) {
      const normalizedError = normalizePlannerError(error, plannerConfig.plannerTimeoutMs);
      llmErrors.push(normalizedError);
      previousAttemptError = normalizedError;

      if (attempt < plannerConfig.plannerMaxRetries) {
        await sleep(getPlannerRetryDelayMs(attempt));
      }
    }
  }

  throw new SchedulingPlannerError(
    `Scheduling planner failed after ${plannerConfig.plannerMaxRetries + 1} attempt(s): ${llmErrors.join(' | ')}`,
    {
      llmAttempted: true,
      llmAttempts: plannerConfig.plannerMaxRetries + 1,
      llmErrors,
      llmTimeoutMs: plannerConfig.plannerTimeoutMs,
    },
  );
}

interface PlannerModelContext {
  providerId: string;
  model: string;
  workingDirectory?: string;
}

type PlannerProviderRow = Pick<
  ApiProvider,
  'id' | 'provider_type' | 'api_key' | 'model_catalog' | 'model_catalog_source' | 'model_catalog_updated_at'
>;

function isUsablePlannerProvider(provider: PlannerProviderRow | null | undefined): provider is PlannerProviderRow {
  return Boolean(
    provider
    && provider.provider_type !== 'gemini-image'
    && typeof provider.api_key === 'string'
    && provider.api_key.trim().length > 0,
  );
}

function resolvePlannerProvider(preferredProviderId?: string): PlannerProviderRow | undefined {
  const providerId = preferredProviderId?.trim() || '';
  if (providerId) {
    const preferred = getProvider(providerId) as PlannerProviderRow | undefined;
    if (isUsablePlannerProvider(preferred)) {
      return preferred;
    }
  }

  const defaultProviderId = (getSetting('default_provider_id') || '').trim();
  if (defaultProviderId && defaultProviderId !== providerId) {
    const fallback = getProvider(defaultProviderId) as PlannerProviderRow | undefined;
    if (isUsablePlannerProvider(fallback)) {
      return fallback;
    }
  }

  return (getAllProviders() as PlannerProviderRow[]).find((provider) => isUsablePlannerProvider(provider));
}

function resolvePlannerModelContext(task: Task): PlannerModelContext | null {
  const session = getSession(task.sessionId);
  const provider = resolvePlannerProvider(session?.provider_id);
  const configuredModel = (
    session?.requested_model
    || session?.model
    || getSetting('default_model')
    || ''
  ).trim();
  const fallbackModel = provider
    ? (getProviderModelOptions(provider)[0]?.value?.trim() || '')
    : '';
  const model = configuredModel || fallbackModel;

  if (!model) {
    return null;
  }

  return {
    providerId: provider?.id || (session?.provider_id || '').trim(),
    model,
    workingDirectory: session?.sdk_cwd || session?.working_directory || undefined,
  };
}

function buildHeuristicSchedulingPlan(task: Task): SchedulingPlan {
  const promptCapabilityContext = buildPromptCapabilityPlanningContext(task);
  const codeCapabilityContext = buildCodeCapabilityPlanningContext(task);
  const text = collectTaskText(task);
  const normalized = text.toLowerCase();
  const detectedUrls = extractUrls(text);
  const detectedUrl = detectedUrls[0];
  const includeScreenshot = matchesAny(normalized, ['截图', 'screenshot', 'capture']);
  const needsImplementation = matchesAny(normalized, IMPLEMENTATION_INTENT_PATTERNS);
  const needsReport = matchesAny(normalized, REPORT_INTENT_PATTERNS);
  const needsFormattedDeliverable = matchesAny(normalized, EXPORT_INTENT_PATTERNS);
  const structuredDeliverableCapability = findStructuredDeliverableCapability(
    normalized,
    needsFormattedDeliverable,
    codeCapabilityContext,
  );
  const prefersEvidenceSearch = shouldPreferEvidenceSearchFlow(normalized, needsImplementation);
  const inferredSearchTarget = detectedUrl ? null : inferSearchTarget(task, text, normalized, prefersEvidenceSearch);
  const needsBrowser = matchesIntent(normalized, {
    genericPatterns: [
      'browser',
      '网页',
      '页面',
      '网站',
      '截图',
      'screenshot',
      'click',
      'navigate',
      'form',
      '表单',
      'url',
      '链接',
      '百度',
      'baidu',
      '谷歌',
      'google',
      '必应',
      'bing',
    ],
    negatedPatterns: [
      '不需要浏览器',
      '无需浏览器',
      '不用浏览器',
      '不要浏览器',
      '不需要网页',
      '无需网页',
      '不用网页',
      '不要网页',
      '不需要页面',
      '无需页面',
      '不用页面',
      '不要页面',
      '不需要截图',
      '无需截图',
      '不用截图',
      '不要截图',
    ],
  }) || Boolean(inferredSearchTarget);
  const needsNotification = matchesIntent(normalized, {
    genericPatterns: [
      'notify',
      'notification',
      '通知',
      '提醒',
      '告知',
      '完成后告诉',
      '发送消息',
      '发消息',
    ],
    explicitPositivePatterns: [
      '完成后通知我',
      '完成后告诉我',
      '然后通知我',
      '通知我结果',
      '通知结果',
      '提醒我',
      '告知我',
      '发消息给我',
      '发送消息给我',
    ],
    negatedPatterns: [
      '不需要通知',
      '无需通知',
      '不用通知',
      '不要通知',
      '不必通知',
      '不需要提醒',
      '无需提醒',
      '不用提醒',
      '不要提醒',
      '不必提醒',
      '不需要告知',
      '无需告知',
      '不用告知',
      '不要告知',
    ],
  });
  const needsMultipleSteps = needsBrowser
    || needsNotification
    || needsImplementation
    || needsReport
    || needsFormattedDeliverable
    || promptCapabilityContext.explicitlyMatchedIds.length > 0
    || task.requirements.length >= 2
    || matchesAny(normalized, [
      '调研',
      '研究',
      '报告',
      '整理',
      '汇总',
      '分析',
      '先',
      '然后',
      '最后',
      '步骤',
      '流程',
      '同时',
      '并行',
    ]);
  const prefersSequential = matchesAny(normalized, ['依次', '先后', '逐个', '一个一个']);
  const needsParallel = !prefersSequential && (
    matchesAny(normalized, ['并行', '同时', '分别', '各自', '对比', '比较', 'compare'])
    || (needsBrowser && detectedUrls.length > 1)
  );
  const needsParallelSynthesis = needsBrowser
    && detectedUrls.length > 1
    && needsParallel
    && matchesAny(normalized, ['汇总', '总结', '结论', '比较', '对比', '分析', '报告']);

  const complexity: SchedulingTaskComplexity = needsBrowser || needsImplementation
    ? 'complex'
    : needsMultipleSteps
      ? 'moderate'
      : 'simple';

  const analysis: SchedulingPlanAnalysis = {
    complexity,
    needsBrowser,
    needsNotification,
    needsMultipleSteps,
    needsParallel,
    ...(detectedUrl ? { detectedUrl } : {}),
    ...(detectedUrls.length > 0 ? { detectedUrls } : {}),
  };

  if (codeCapabilityContext.explicitlyMatchedId && codeCapabilityContext.explicitInput) {
    const workflowDsl = buildCodeCapabilityWorkflowDsl(task, {
      capabilityId: codeCapabilityContext.explicitlyMatchedId,
      capabilityInput: codeCapabilityContext.explicitInput,
      includeNotification: needsNotification,
    });

    return {
      strategy: 'workflow',
      source: 'heuristic',
      reason: `Task explicitly references published code capability ${codeCapabilityContext.explicitlyMatchedId} with structured input, so it should run as a capability workflow.`,
      estimatedDurationSeconds: WORKFLOW_ESTIMATED_DURATION_SECONDS,
      workflowDsl,
      analysis,
    };
  }

  if (needsParallelSynthesis) {
    const workflowDsl = buildHybridParallelBrowserWorkflowDsl(task, {
      detectedUrls,
      includeScreenshot,
      includeNotification: needsNotification,
      promptCapabilityIds: promptCapabilityContext.explicitlyMatchedIds,
    });

    return {
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Task needs parallel browser branches plus a downstream synthesis step, so it should run as a mixed workflow.',
      estimatedDurationSeconds: estimateDurationSeconds(workflowDsl, analysis),
      workflowDsl,
      analysis,
    };
  }

  if (needsBrowser && detectedUrls.length > 1 && needsParallel) {
    const workflowDsl = buildParallelBrowserWorkflowDsl(task, {
      detectedUrls,
      includeScreenshot,
      includeNotification: needsNotification,
      promptCapabilityIds: promptCapabilityContext.explicitlyMatchedIds,
    });

    return {
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Task contains multiple independent browser targets that can run in parallel within Workflow DSL v1.',
      estimatedDurationSeconds: estimateDurationSeconds(workflowDsl, analysis),
      workflowDsl,
      analysis,
    };
  }

  if (needsBrowser && detectedUrl) {
    const workflowDsl = buildBrowserWorkflowDsl(task, {
      detectedUrl,
      includeScreenshot,
      includeNotification: needsNotification,
      promptCapabilityIds: promptCapabilityContext.explicitlyMatchedIds,
    });

    return {
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Task includes browser-visible actions with a concrete URL, so workflow orchestration is required.',
      estimatedDurationSeconds: BROWSER_WORKFLOW_ESTIMATED_DURATION_SECONDS,
      workflowDsl,
      analysis,
    };
  }

  if (inferredSearchTarget) {
    const workflowDsl = buildSearchWorkflowDsl(task, {
      searchTarget: inferredSearchTarget,
      includeScreenshot: includeScreenshot || prefersEvidenceSearch,
      includeNotification: needsNotification,
      includeSynthesis: needsReport || needsFormattedDeliverable || task.requirements.length >= 2,
      includeFormattedDeliverable: needsFormattedDeliverable,
      exportCapability: structuredDeliverableCapability,
      promptCapabilityIds: promptCapabilityContext.explicitlyMatchedIds,
      preferEvidenceCollection: prefersEvidenceSearch,
    });

    return {
      strategy: 'workflow',
      source: 'heuristic',
      reason: prefersEvidenceSearch
        ? 'Task needs browser search/evidence collection plus downstream synthesis, so it should run as a workflow.'
        : needsReport || needsFormattedDeliverable
          ? 'Task needs browser search plus downstream synthesis, so it should run as a workflow.'
          : 'Task needs a browser search path with visible outputs, so it should run as a workflow.',
      estimatedDurationSeconds: estimateDurationSeconds(workflowDsl, analysis),
      workflowDsl,
      analysis,
    };
  }

  if (needsImplementation) {
    const workflowDsl = buildImplementationWorkflowDsl(task, {
      includeNotification: needsNotification,
      promptCapabilityIds: promptCapabilityContext.explicitlyMatchedIds,
    });
    return {
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Implementation work should be staged across analysis, execution, and final delivery.',
      estimatedDurationSeconds: WORKFLOW_ESTIMATED_DURATION_SECONDS,
      workflowDsl,
      analysis,
    };
  }

  if (needsMultipleSteps) {
    const workflowDsl = needsReport || needsFormattedDeliverable
      ? buildReportWorkflowDsl(task, {
          includeNotification: needsNotification,
          includeFormattedDeliverable: needsFormattedDeliverable,
          exportCapability: structuredDeliverableCapability,
          promptCapabilityIds: promptCapabilityContext.explicitlyMatchedIds,
        })
      : buildAgentWorkflowDsl(task, {
          includeNotification: needsNotification,
          promptCapabilityIds: promptCapabilityContext.explicitlyMatchedIds,
        });
    return {
      strategy: 'workflow',
      source: 'heuristic',
      reason: promptCapabilityContext.explicitlyMatchedIds.length > 0
        ? `Task explicitly references published prompt capabilities (${promptCapabilityContext.explicitlyMatchedIds.join(', ')}), so it should run as a workflow with agent capability injection.`
        : 'Task requires staged execution or post-processing, so it should run as a workflow.',
      estimatedDurationSeconds: WORKFLOW_ESTIMATED_DURATION_SECONDS,
      workflowDsl,
      analysis,
    };
  }

  return {
    strategy: 'simple',
    source: 'heuristic',
    reason: 'Task is narrow enough for a single direct execution.',
    estimatedDurationSeconds: SIMPLE_ESTIMATED_DURATION_SECONDS,
    analysis,
  };
}

function collectTaskText(task: Task): string {
  const relevantMessages = Array.isArray(task.metadata?.relevantMessages)
    ? (task.metadata.relevantMessages as unknown[])
        .filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
    : [];

  return [
    task.summary,
    ...task.requirements,
    ...relevantMessages,
  ].join('\n');
}

function normalizeCapabilityMatchText(value: string): string {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectSchemaFieldNames(schema: Record<string, unknown>): string[] {
  const topLevelKeys = Object.keys(schema).filter((key) => ![
    '$schema',
    'type',
    'title',
    'description',
    'required',
    'properties',
    'additionalProperties',
  ].includes(key));

  const propertyKeys = isRecord(schema.properties)
    ? Object.keys(schema.properties)
    : [];

  return Array.from(new Set([...topLevelKeys, ...propertyKeys]));
}

function findSchemaFieldName(
  schema: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const fieldNames = collectSchemaFieldNames(schema);
  for (const candidate of candidates) {
    const matched = fieldNames.find((fieldName) => normalizeCapabilityMatchText(fieldName) === candidate);
    if (matched) {
      return matched;
    }
  }
  return undefined;
}

function inferRequestedDeliverableFormat(
  normalizedText: string,
): StructuredDeliverableCapability['targetFormat'] | undefined {
  for (const alias of DELIVERABLE_FORMAT_ALIASES) {
    if (alias.patterns.some((pattern) => normalizedText.includes(pattern))) {
      return alias.format;
    }
  }
  return undefined;
}

function stringifyCapabilitySummary(capability: PublishedCodeCapabilitySummary): string {
  return normalizeCapabilityMatchText([
    capability.id,
    capability.name,
    capability.description,
    capability.summary,
    ...capability.usageExamples,
    JSON.stringify(capability.inputSchema || {}),
    JSON.stringify(capability.outputSchema || {}),
  ].join('\n'));
}

function findStructuredDeliverableCapability(
  normalizedText: string,
  needsFormattedDeliverable: boolean,
  context: CodeCapabilityPlanningContext,
): StructuredDeliverableCapability | undefined {
  if (!needsFormattedDeliverable) {
    return undefined;
  }

  const targetFormat = inferRequestedDeliverableFormat(normalizedText);
  if (!targetFormat) {
    return undefined;
  }

  const candidates = context.available.flatMap((capability) => {
    const contentInputKey = findSchemaFieldName(capability.inputSchema, CAPABILITY_CONTENT_INPUT_CANDIDATES);
    const formatInputKey = findSchemaFieldName(capability.inputSchema, CAPABILITY_FORMAT_INPUT_CANDIDATES);
    if (!contentInputKey || !formatInputKey) {
      return [];
    }

    const haystack = stringifyCapabilitySummary(capability);
    const mentionsConversion = ['导出', '转换', 'export', 'convert']
      .some((pattern) => haystack.includes(normalizeCapabilityMatchText(pattern)));
    const mentionsMarkdown = haystack.includes('markdown') || haystack.includes('md');
    const mentionsTargetFormat = haystack.includes(targetFormat)
      || (targetFormat === 'docx' && haystack.includes('word'));

    let score = 0;
    if (context.explicitlyMatchedId === capability.id) {
      score += 100;
    }
    if (mentionsConversion) {
      score += 10;
    }
    if (mentionsMarkdown) {
      score += 6;
    }
    if (mentionsTargetFormat) {
      score += 8;
    }

    if (score === 0) {
      return [];
    }

    return [{
      capabilityId: capability.id,
      capabilityName: capability.name,
      targetFormat,
      contentInputKey,
      formatInputKey,
      score,
    }];
  });

  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if (!best) {
    return undefined;
  }

  return {
    capabilityId: best.capabilityId,
    capabilityName: best.capabilityName,
    targetFormat: best.targetFormat,
    contentInputKey: best.contentInputKey,
    formatInputKey: best.formatInputKey,
  };
}

function buildPromptCapabilityPlanningContext(task: Task): PromptCapabilityPlanningContext {
  const available = listPublishedPromptCapabilities();
  if (available.length === 0) {
    return {
      available: [],
      explicitlyMatchedIds: [],
    };
  }

  const haystack = normalizeCapabilityMatchText(collectTaskText(task));
  const explicitlyMatchedIds = available
    .filter((capability) => {
      const idMatch = haystack.includes(normalizeCapabilityMatchText(capability.id));
      const nameMatch = haystack.includes(normalizeCapabilityMatchText(capability.name));
      return idMatch || nameMatch;
    })
    .map((capability) => capability.id);

  return {
    available,
    explicitlyMatchedIds,
  };
}

function buildCodeCapabilityPlanningContext(task: Task): CodeCapabilityPlanningContext {
  const available = listPublishedCodeCapabilities();
  if (available.length === 0) {
    return {
      available: [],
    };
  }

  const haystack = normalizeCapabilityMatchText(collectTaskText(task));
  const explicitlyMatched = available.find((capability) => {
    const idMatch = haystack.includes(normalizeCapabilityMatchText(capability.id));
    const nameMatch = haystack.includes(normalizeCapabilityMatchText(capability.name));
    return idMatch || nameMatch;
  });
  const explicitInput = extractExplicitCapabilityInput(task);

  return {
    available,
    ...(explicitlyMatched ? { explicitlyMatchedId: explicitlyMatched.id } : {}),
    ...(explicitInput ? { explicitInput } : {}),
  };
}

function extractExplicitCapabilityInput(task: Task): Record<string, unknown> | undefined {
  const text = collectTaskText(task);
  const fencedJsonMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (fencedJsonMatch?.[1]) {
    try {
      const parsed = JSON.parse(fencedJsonMatch[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }

  const parameterMatch = text.match(/(?:参数|input|args?)\s*[:：]\s*(\{[\s\S]*\})/i);
  if (parameterMatch?.[1]) {
    try {
      const parsed = JSON.parse(parameterMatch[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }

  const inlineJson = extractJsonObject(text);
  if (!inlineJson) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(inlineJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }

  return undefined;
}

function withPromptCapabilityTools(
  step: WorkflowStep,
  promptCapabilityIds: string[],
): WorkflowStep {
  if (step.type !== 'agent' || promptCapabilityIds.length === 0) {
    return step;
  }

  const currentInput = step.input && typeof step.input === 'object' ? step.input : {};
  const currentTools = Array.isArray((currentInput as Record<string, unknown>).tools)
    ? ((currentInput as Record<string, unknown>).tools as unknown[])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  return {
    ...step,
    input: {
      ...currentInput,
      tools: Array.from(new Set([...currentTools, ...promptCapabilityIds])),
    },
  };
}

function applyPromptCapabilitiesToWorkflow(
  workflowDsl: WorkflowDSL,
  promptCapabilityIds: string[],
): WorkflowDSL {
  if (promptCapabilityIds.length === 0) {
    return workflowDsl;
  }

  return {
    ...workflowDsl,
    steps: workflowDsl.steps.map((step) => withPromptCapabilityTools(step, promptCapabilityIds)),
  };
}

function matchesAny(source: string, patterns: string[]): boolean {
  return patterns.some((pattern) => source.includes(pattern.toLowerCase()));
}

function matchesIntent(
  source: string,
  options: {
    genericPatterns: string[];
    explicitPositivePatterns?: string[];
    negatedPatterns?: string[];
  },
): boolean {
  if (matchesAny(source, options.explicitPositivePatterns ?? [])) {
    return true;
  }

  if (matchesAny(source, options.negatedPatterns ?? [])) {
    return false;
  }

  return matchesAny(source, options.genericPatterns);
}

function shouldPreferEvidenceSearchFlow(normalized: string, needsImplementation: boolean): boolean {
  if (needsImplementation) {
    return false;
  }

  const hasResearchIntent = matchesAny(normalized, REPORT_INTENT_PATTERNS);
  const hasSecurityTopic = matchesAny(normalized, SECURITY_RESEARCH_PATTERNS);
  const hasRemediationIntent = matchesAny(normalized, REMEDIATION_INTENT_PATTERNS);

  return (hasResearchIntent && hasSecurityTopic) || (hasSecurityTopic && hasRemediationIntent);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getPlannerRetryDelayMs(attempt: number): number {
  return 1000 * (attempt + 1);
}

function extractPlannerErrorText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\s+/g, ' ')
    .trim();
}

function getPlannerResponseBodyExcerpt(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const candidate = 'responseBody' in error
    ? (error as { responseBody?: unknown }).responseBody
    : 'cause' in error && error.cause && typeof error.cause === 'object' && 'responseBody' in error.cause
      ? (error.cause as { responseBody?: unknown }).responseBody
      : undefined;

  const excerpt = extractPlannerErrorText(candidate);
  if (!excerpt) {
    return '';
  }

  return excerpt.length > 240
    ? `${excerpt.slice(0, 240)}...`
    : excerpt;
}

function normalizePlannerError(error: unknown, timeoutMs: number): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `LLM planning timed out after ${timeoutMs}ms`;
    }

    if (error.message === 'Claude Code process aborted by user') {
      return `LLM planning timed out after ${timeoutMs}ms`;
    }

    if (error.message === 'Invalid JSON response') {
      const statusCode = 'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
      const responseBody = getPlannerResponseBodyExcerpt(error);
      const details = [
        statusCode ? `status ${statusCode}` : '',
        responseBody ? `body: ${responseBody}` : '',
      ].filter(Boolean).join(', ');

      return details
        ? `Invalid JSON response from planner provider (${details})`
        : error.message;
    }

    return error.message || 'Unknown planner error';
  }

  return String(error);
}

function extractUrls(source: string): string[] {
  const matches = source.match(/https?:\/\/[^\s<>"'`，。；：！？、）】》」』]+/giu) ?? [];
  const sanitized = matches
    .map((match) => match.replace(/[),.;!?，。；：！？、）】》」』]+$/u, ''))
    .filter((match) => match.length > 0);
  return Array.from(new Set(sanitized));
}

function hasCjkCharacters(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function cleanSearchQuery(value: string): string {
  return value
    .replace(/^[:：\s]+/u, '')
    .replace(/^(?:在|去|到)\s*/u, '')
    .replace(/^(?:百度|baidu|谷歌|google|必应|bing|duckduckgo)\s*/iu, '')
    .replace(/^(?:搜索|搜一下|搜一搜|查一下|查询|检索|search(?:\s+for)?)\s*/iu, '')
    .replace(/\s*(?:然后|接着|再|并且|并|最后).*/u, '')
    .replace(/\s*(?:截图|截个图|保存截图|通知我|告诉我|发给我|导出(?:成)?\s*pdf|导出|变成\s*pdf|生成\s*pdf).*/iu, '')
    .replace(/[“"'‘’]+/gu, '')
    .trim();
}

function extractExplicitSearchQuery(source: string): string | undefined {
  const clauses = source
    .replace(/[。！？!?]/gu, '\n')
    .replace(/[；;]/gu, '\n')
    .split('\n')
    .flatMap((part) => part.split(/[，,]/u))
    .map((part) => part.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const match = clause.match(/(?:搜索|搜一下|搜一搜|查一下|查询|检索|search(?:\s+for)?)\s*[:：]?\s*(.+)$/iu);
    if (!match) {
      continue;
    }

    const query = cleanSearchQuery(match[1] ?? '');
    if (query.length >= 2) {
      return query;
    }
  }

  return undefined;
}

function deriveTopicQuery(summary: string): string | undefined {
  const query = summary
    .replace(/^(?:(?:请|麻烦)\s*)?(?:帮我|给我)?\s*(?:做|整理|写|生成|提供|来)?\s*一份\s*/u, '')
    .replace(/^(?:请|麻烦|帮我|给我)\s*/u, '')
    .replace(/^(?:调研(?:一下)?|研究(?:一下)?|分析(?:一下)?|整理(?:一下)?|汇总(?:一下)?|总结(?:一下)?|看一下|看看)\s*/u, '')
    .replace(/^(?:关于|有关)\s*/u, '')
    .replace(/[，,。；;].*$/u, '')
    .replace(/\s*(?:并.*|然后.*|最后.*)$/u, '')
    .replace(/\s*(?:的)?(?:调研|研究|报告|分析|总结|汇总)\s*$/u, '')
    .trim();

  const cleaned = cleanSearchQuery(query)
    .replace(/^(?:调研(?:一下)?|研究(?:一下)?|分析(?:一下)?|整理(?:一下)?|汇总(?:一下)?|总结(?:一下)?|看一下|看看)\s*/u, '')
    .trim();

  return cleaned.length >= 2 ? cleaned : undefined;
}

function resolveSearchTarget(normalized: string, query: string): SearchTarget {
  if (matchesAny(normalized, ['百度', 'baidu'])) {
    return {
      engine: 'baidu',
      engineLabel: '百度',
      query,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
    };
  }

  if (matchesAny(normalized, ['谷歌', 'google'])) {
    return {
      engine: 'google',
      engineLabel: 'Google',
      query,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    };
  }

  if (matchesAny(normalized, ['必应', 'bing'])) {
    return {
      engine: 'bing',
      engineLabel: 'Bing',
      query,
      url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    };
  }

  if (matchesAny(normalized, ['duckduckgo', 'duck duck go', 'ddg'])) {
    return {
      engine: 'duckduckgo',
      engineLabel: 'DuckDuckGo',
      query,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    };
  }

  if (hasCjkCharacters(query)) {
    return {
      engine: 'baidu',
      engineLabel: '百度',
      query,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
    };
  }

  return {
    engine: 'bing',
    engineLabel: 'Bing',
    query,
    url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  };
}

function inferSearchTarget(
  task: Task,
  text: string,
  normalized: string,
  preferEvidenceSearch: boolean = false,
): SearchTarget | null {
  if (!matchesAny(normalized, EXTERNAL_SEARCH_INTENT_PATTERNS) && !preferEvidenceSearch) {
    return null;
  }

  if (matchesAny(normalized, LOCAL_SEARCH_NEGATION_PATTERNS)) {
    return null;
  }

  const query = extractExplicitSearchQuery(text) ?? deriveTopicQuery(task.summary);
  if (!query) {
    return null;
  }

  return resolveSearchTarget(normalized, query);
}

function createStepPolicy(timeoutMs: number, maximumAttempts: number = 1) {
  return {
    timeoutMs,
    retry: {
      maximumAttempts,
    },
  };
}

function buildAgentWorkflowDsl(
  task: Task,
  options: {
    includeNotification: boolean;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const steps: WorkflowDSL['steps'] = [
    {
      id: 'analyze',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(
          task,
          [
            '请先分析任务。',
            '你的输出必须是一段可直接交给执行代理继续执行的完整任务说明，而不是介绍你自己做了什么。',
            '请在这段说明里完整重述目标、硬性约束、期望输出和执行重点，让下游代理只读这一段也能直接完成任务。',
            '不要写“我已分析”“以下是总结”“可交接说明如下”这类元描述。',
          ].join(' '),
        ),
        role: 'researcher',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'main',
      type: 'agent',
      dependsOn: ['analyze'],
      input: {
        prompt: 'steps.analyze.output.summary',
        role: 'worker',
      },
      policy: createStepPolicy(LONG_AGENT_STEP_TIMEOUT_MS),
    },
  ];

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: ['main'],
      input: {
        message: 'steps.main.output.summary',
        level: 'info',
        channel: 'system',
        sessionId: task.sessionId,
      },
      policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
    });
  }

  return {
    version: 'v1',
    name: `task-${task.id}`,
    steps: applyPromptCapabilitiesToWorkflow({
      version: 'v1',
      name: `task-${task.id}`,
      steps,
    }, options.promptCapabilityIds || []).steps,
  };
}

function buildImplementationWorkflowDsl(
  task: Task,
  options: {
    includeNotification: boolean;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const steps: WorkflowDSL['steps'] = [
    {
      id: 'analyze',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(
          task,
          [
            '请先把这项实现任务整理成可执行说明。',
            '明确目标、约束、验收点、风险和优先级。',
            '输出要能直接交给代码执行代理继续完成，不要写元话术。',
          ].join(' '),
        ),
        role: 'researcher',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'implement',
      type: 'agent',
      dependsOn: ['analyze'],
      input: {
        prompt: 'steps.analyze.output.summary',
        role: 'coder',
      },
      policy: createStepPolicy(LONG_AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'finalize',
      type: 'agent',
      dependsOn: ['implement'],
      input: {
        prompt: buildTaskPrompt(
          task,
          [
            '请基于实现结果输出最终交付说明。',
            '必须说明已完成内容、剩余风险、验证建议，以及用户当前能直接验收的结果。',
            '禁止编造未完成项。',
          ].join(' '),
        ),
        role: 'integration',
        context: {
          implementation: 'steps.implement.output.summary',
        },
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
  ];

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: ['finalize'],
      input: {
        message: 'steps.finalize.output.summary',
        level: 'info',
        channel: 'system',
        sessionId: task.sessionId,
      },
      policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
    });
  }

  return {
    version: 'v1',
    name: `task-${task.id}`,
    steps: applyPromptCapabilitiesToWorkflow({
      version: 'v1',
      name: `task-${task.id}`,
      steps,
    }, options.promptCapabilityIds || []).steps,
  };
}

function appendStructuredDeliverableSteps(
  task: Task,
  steps: WorkflowDSL['steps'],
  options: {
    baseStepId: string;
    baseOutputRef: string;
    includeNotification: boolean;
    exportCapability?: StructuredDeliverableCapability;
  },
): void {
  if (!options.exportCapability) {
    if (options.includeNotification) {
      steps.push({
        id: 'notify',
        type: 'notification',
        dependsOn: [options.baseStepId],
        input: {
          message: `${options.baseOutputRef}`,
          level: 'info',
          channel: 'system',
          sessionId: task.sessionId,
        },
        policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
      });
    }
    return;
  }

  steps.push({
    id: 'export_file',
    type: 'capability',
    dependsOn: [options.baseStepId],
    input: {
      capabilityId: options.exportCapability.capabilityId,
      input: {
        [options.exportCapability.contentInputKey]: options.baseOutputRef,
        [options.exportCapability.formatInputKey]: options.exportCapability.targetFormat,
      },
    },
    policy: createStepPolicy(LONG_AGENT_STEP_TIMEOUT_MS),
  });

  steps.push({
    id: 'deliver_export',
    type: 'agent',
    dependsOn: ['export_file'],
    input: {
      prompt: buildTaskPrompt(
        task,
        [
          '请基于正文结果和导出能力输出，给用户一段正式交付说明。',
          '如果导出成功，必须明确说明输出格式和文件路径。',
          '如果导出失败，必须明确失败原因，不要假装文件已生成。',
        ].join(' '),
      ),
      role: 'integration',
      context: {
        deliverableContent: options.baseOutputRef,
        exportCapabilityId: options.exportCapability.capabilityId,
        exportResult: 'steps.export_file.output',
      },
    },
    policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
  });

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: ['deliver_export'],
      input: {
        message: 'steps.deliver_export.output.summary',
        level: 'info',
        channel: 'system',
        sessionId: task.sessionId,
      },
      policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
    });
  }
}

function buildReportWorkflowDsl(
  task: Task,
  options: {
    includeNotification: boolean;
    includeFormattedDeliverable: boolean;
    exportCapability?: StructuredDeliverableCapability;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const finalInstruction = options.exportCapability
    ? '请基于已提供的分析和写作提纲，一次性输出可直接用于后续导出的完整 Markdown 正文。优先高信息密度内容，避免空话和重复，不要写“PDF 需求已记录”之类的占位说明。正文要结构清晰，便于转换成最终文件。'
    : options.includeFormattedDeliverable
      ? '请基于已提供的分析和写作提纲，一次性输出可直接交付的简洁正文结果，控制篇幅，优先给出高信息密度内容；如果用户要求 PDF，请在结果中明确说明 PDF 导出需求已记录，并先提供完整正文内容。'
    : '请基于已提供的分析和写作提纲，输出面向用户的最终报告或结论，结构清晰，控制篇幅，禁止编造未给出的事实。';

  const steps: WorkflowDSL['steps'] = [
    {
      id: 'analyze',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(
          task,
          [
            '请先拆出报告任务的目标、读者对象、重点问题和输出结构。',
            '输出一段可直接交给后续步骤使用的执行说明，不要写元描述。',
          ].join(' '),
        ),
        role: 'researcher',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'draft',
      type: 'agent',
      dependsOn: ['analyze'],
      input: {
        prompt: buildTaskPrompt(
          task,
          [
            '请基于已提供的分析说明，产出一份供最终成稿直接使用的精简 Markdown 提纲。',
            '只输出标题建议、章节结构、每节关键要点、必须回答的问题和不要编造的边界。',
            '不要直接展开成长篇报告，不要输出面向用户的最终正文。',
            '提纲必须足够清晰，让下游步骤据此一次性写出最终报告。',
          ].join(' '),
        ),
        role: 'researcher',
        context: {
          analysis: 'steps.analyze.output.summary',
        },
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'finalize',
      type: 'agent',
      dependsOn: ['draft'],
      input: {
        prompt: buildTaskPrompt(task, finalInstruction),
        role: 'integration',
        outputMode: 'plain-text',
        context: {
          analysis: 'steps.analyze.output.summary',
          outline: 'steps.draft.output.summary',
        },
      },
      policy: createStepPolicy(REPORT_WRITING_TIMEOUT_MS, 2),
    },
  ];

  appendStructuredDeliverableSteps(task, steps, {
    baseStepId: 'finalize',
    baseOutputRef: 'steps.finalize.output.summary',
    includeNotification: options.includeNotification,
    exportCapability: options.exportCapability,
  });

  return {
    version: 'v1',
    name: `task-${task.id}`,
    steps: applyPromptCapabilitiesToWorkflow({
      version: 'v1',
      name: `task-${task.id}`,
      steps,
    }, options.promptCapabilityIds || []).steps,
  };
}

function buildSearchWorkflowDsl(
  task: Task,
  options: {
    searchTarget: SearchTarget;
    includeScreenshot: boolean;
    includeNotification: boolean;
    includeSynthesis: boolean;
    includeFormattedDeliverable: boolean;
    exportCapability?: StructuredDeliverableCapability;
    promptCapabilityIds?: string[];
    preferEvidenceCollection?: boolean;
  },
): WorkflowDSL {
  const searchAnalyzePrompt = options.preferEvidenceCollection
    ? [
        '请先提炼本次外部搜索与取证任务的目标、关键词、核对重点、需要收集的证据，以及最终交付要求。',
        '输出一段供后续步骤直接消费的执行说明，不要写元话术。',
      ].join(' ')
    : [
        '请先提炼本次网页搜索任务的目标、关键词、核对重点和最终交付要求。',
        '输出一段供后续步骤直接消费的执行说明，不要写元话术。',
      ].join(' ');

  const steps: WorkflowDSL['steps'] = [
    {
      id: 'analyze',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(task, searchAnalyzePrompt),
        role: 'researcher',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'search',
      type: 'browser',
      dependsOn: ['analyze'],
      input: {
        action: 'navigate',
        url: options.searchTarget.url,
        createPage: true,
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    },
  ];

  let finalStepId = 'search';

  if (options.includeScreenshot) {
    steps.push({
      id: 'capture',
      type: 'browser',
      dependsOn: ['search'],
      when: {
        op: 'exists',
        ref: 'steps.search.output.pageId',
      },
      input: {
        action: 'screenshot',
        pageId: 'steps.search.output.pageId',
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    });
    finalStepId = 'capture';
  }

  if (options.includeSynthesis) {
    const finalInstruction = buildSearchSynthesisInstruction(task, options);

    steps.push({
      id: 'summarize',
      type: 'agent',
      dependsOn: [finalStepId],
      input: {
        prompt: buildTaskPrompt(task, finalInstruction),
        role: 'integration',
        outputMode: 'plain-text',
        context: {
          analysis: 'steps.analyze.output.summary',
          searchPlan: {
            engine: options.searchTarget.engineLabel,
            query: options.searchTarget.query,
            plannedUrl: options.searchTarget.url,
          },
          searchResult: {
            url: 'steps.search.output.url',
            title: 'steps.search.output.title',
            lines: 'steps.search.output.lines',
            ...(options.includeScreenshot
              ? { screenshotPath: 'steps.capture.output.screenshotPath' }
              : {}),
          },
        },
      },
      policy: createStepPolicy(REPORT_SYNTHESIS_TIMEOUT_MS, 2),
    });
    finalStepId = 'summarize';
  }

  if (finalStepId === 'summarize') {
    appendStructuredDeliverableSteps(task, steps, {
      baseStepId: 'summarize',
      baseOutputRef: 'steps.summarize.output.summary',
      includeNotification: options.includeNotification,
      exportCapability: options.exportCapability,
    });
  } else if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: [finalStepId],
      input: {
        message: `搜索任务已完成：${task.summary}`,
        level: 'info',
        channel: 'system',
        sessionId: task.sessionId,
      },
      policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
    });
  }

  return {
    version: 'v1',
    name: `task-${task.id}`,
    steps: applyPromptCapabilitiesToWorkflow({
      version: 'v1',
      name: `task-${task.id}`,
      steps,
    }, options.promptCapabilityIds || []).steps,
  };
}

function buildSearchSynthesisInstruction(
  task: Task,
  options: {
    includeFormattedDeliverable: boolean;
    exportCapability?: StructuredDeliverableCapability;
    preferEvidenceCollection?: boolean;
  },
): string {
  if (!options.preferEvidenceCollection) {
    return options.exportCapability
      ? '请基于搜索结果页面信息输出完整 Markdown 正文，供后续导出能力直接转换成目标文件。只保留最有价值的技巧、做法和注意事项，不要输出“PDF 需求已记录”之类占位说明，也不要编造额外事实。'
      : options.includeFormattedDeliverable
        ? '请基于搜索结果页面信息输出简洁、可直接交付的正文。只保留最有价值的技巧、做法和注意事项，控制篇幅；如果用户要求 PDF，请明确说明 PDF 导出需求已记录，并先给出完整正文内容。只能使用已提供的页面标题、URL、摘录和截图信息，不要编造额外事实。'
        : '请基于搜索结果页面信息输出简洁最终结论或报告。优先使用页面标题、URL、摘录和截图信息，只保留最关键内容，禁止编造未出现的事实。';
  }

  const normalized = collectTaskText(task).toLowerCase();
  const focusesSecurity = matchesAny(normalized, SECURITY_RESEARCH_PATTERNS);
  const needsRemediationPlan = matchesAny(normalized, REMEDIATION_INTENT_PATTERNS);

  const evidenceLead = focusesSecurity
    ? '请基于搜索结果页面信息，先整理可核验的安全问题、风险线索和外部证据。'
    : '请基于搜索结果页面信息，先整理可核验的外部事实和证据。';
  const solutionLead = needsRemediationPlan
    ? (focusesSecurity
      ? '在证据之后，给出针对性的安全整改、缓解和防护方案。'
      : '在证据之后，给出针对性的解决方案和后续建议。')
    : '在证据之后，再给出明确结论。';
  const evidenceBoundary = focusesSecurity
    ? '只能使用已提供的页面标题、URL、摘录和截图信息，不要编造漏洞细节、版本号、CVE 或厂商声明。'
    : '只能使用已提供的页面标题、URL、摘录和截图信息，不要编造额外事实。';

  if (options.exportCapability) {
    return `${evidenceLead} ${solutionLead} 输出完整 Markdown 正文，供后续导出能力直接转换成目标文件。不要输出“PDF 需求已记录”之类占位说明。${evidenceBoundary}`;
  }

  if (options.includeFormattedDeliverable) {
    return `${evidenceLead} ${solutionLead} 输出简洁、可直接交付的正文；如果用户要求 PDF，请明确说明 PDF 导出需求已记录，并先给出完整正文内容。${evidenceBoundary}`;
  }

  return `${evidenceLead} ${solutionLead} 输出简洁最终结论或报告。${evidenceBoundary}`;
}

function buildCodeCapabilityWorkflowDsl(
  task: Task,
  options: {
    capabilityId: string;
    capabilityInput: Record<string, unknown>;
    includeNotification: boolean;
  },
): WorkflowDSL {
  const steps: WorkflowDSL['steps'] = [
    {
      id: 'run_capability',
      type: 'capability',
      input: {
        capabilityId: options.capabilityId,
        input: options.capabilityInput,
      },
      policy: createStepPolicy(LONG_AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'finalize',
      type: 'agent',
      dependsOn: ['run_capability'],
      input: {
        prompt: buildTaskPrompt(
          task,
          [
            '请基于代码节点输出，生成一段用户可直接理解的结果说明。',
            '如果代码节点已经返回 summary、artifactId、downloadName、contentType 等字段，请完整转述这些正式结果。',
            '禁止编造代码节点没有返回的内容。',
          ].join(' '),
        ),
        role: 'integration',
        context: {
          capabilityId: options.capabilityId,
          capabilityOutput: 'steps.run_capability.output',
        },
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
  ];

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: ['finalize'],
      input: {
        message: 'steps.finalize.output.summary',
        level: 'info',
        channel: 'system',
        sessionId: task.sessionId,
      },
      policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
    });
  }

  return {
    version: 'v1',
    name: `task-${task.id}`,
    steps,
  };
}

function buildBrowserWorkflowDsl(
  task: Task,
  options: {
    detectedUrl: string;
    includeScreenshot: boolean;
    includeNotification: boolean;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const steps: WorkflowDSL['steps'] = [
    {
      id: 'draft',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(task, '请输出一段简短执行说明，说明接下来要完成的浏览器任务。'),
        role: 'worker',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'browse',
      type: 'browser',
      dependsOn: ['draft'],
      input: {
        action: 'navigate',
        url: options.detectedUrl,
        createPage: true,
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    },
  ];

  let finalStepId = 'browse';

  if (options.includeScreenshot) {
    steps.push({
      id: 'capture',
      type: 'browser',
      dependsOn: ['browse'],
      when: {
        op: 'exists',
        ref: 'steps.browse.output.pageId',
      },
      input: {
        action: 'screenshot',
        pageId: 'steps.browse.output.pageId',
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    });
    finalStepId = 'capture';
  }

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: [finalStepId],
      input: {
        message: `任务已完成：${task.summary}`,
        level: 'info',
        channel: 'system',
        sessionId: task.sessionId,
      },
      policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
    });
  }

  return {
    version: 'v1',
    name: `task-${task.id}`,
    steps: applyPromptCapabilitiesToWorkflow({
      version: 'v1',
      name: `task-${task.id}`,
      steps,
    }, options.promptCapabilityIds || []).steps,
  };
}

function buildParallelBrowserWorkflowDsl(
  task: Task,
  options: {
    detectedUrls: string[];
    includeScreenshot: boolean;
    includeNotification: boolean;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const steps: WorkflowDSL['steps'] = [
    {
      id: 'draft',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(task, '请输出一段简短执行说明，说明接下来要分别完成的浏览器任务。'),
        role: 'worker',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
  ];

  const browseStepIds: string[] = [];
  const terminalStepIds: string[] = [];

  for (const [index, url] of options.detectedUrls.entries()) {
    const branchIndex = index + 1;
    const browseStepId = `browse_${branchIndex}`;
    browseStepIds.push(browseStepId);

    steps.push({
      id: browseStepId,
      type: 'browser',
      dependsOn: ['draft'],
      input: {
        action: 'navigate',
        url,
        createPage: true,
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    });
  }

  if (options.includeScreenshot) {
    for (const [index, browseStepId] of browseStepIds.entries()) {
      const captureStepId = `capture_${index + 1}`;
      steps.push({
        id: captureStepId,
        type: 'browser',
        dependsOn: [browseStepId],
        when: {
          op: 'exists',
          ref: `steps.${browseStepId}.output.pageId`,
        },
        input: {
          action: 'screenshot',
          pageId: `steps.${browseStepId}.output.pageId`,
        },
        policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
      });
      terminalStepIds.push(captureStepId);
    }
  } else {
    terminalStepIds.push(...browseStepIds);
  }

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: terminalStepIds,
      input: {
        message: `并行浏览器任务已完成：${task.summary}`,
        level: 'info',
        channel: 'system',
        sessionId: task.sessionId,
      },
      policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
    });
  }

  return {
    version: 'v1',
    name: `task-${task.id}`,
    steps: applyPromptCapabilitiesToWorkflow({
      version: 'v1',
      name: `task-${task.id}`,
      steps,
    }, options.promptCapabilityIds || []).steps,
  };
}

function buildHybridParallelBrowserWorkflowDsl(
  task: Task,
  options: {
    detectedUrls: string[];
    includeScreenshot: boolean;
    includeNotification: boolean;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const steps: WorkflowDSL['steps'] = [
    {
      id: 'analyze',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(
          task,
          '请先整理本次多页面并行任务的核对重点、比较维度和最终汇总要求，输出一段供后续步骤直接消费的简洁说明。',
        ),
        role: 'researcher',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
  ];

  const browseStepIds: string[] = [];
  const terminalStepIds: string[] = [];
  const aggregateContext: Record<string, unknown> = {
    analysis: 'steps.analyze.output.summary',
  };

  for (const [index, url] of options.detectedUrls.entries()) {
    const branchIndex = index + 1;
    const browseStepId = `browse_${branchIndex}`;
    browseStepIds.push(browseStepId);

    steps.push({
      id: browseStepId,
      type: 'browser',
      dependsOn: ['analyze'],
      input: {
        action: 'navigate',
        url,
        createPage: true,
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    });
  }

  if (options.includeScreenshot) {
    for (const [index, browseStepId] of browseStepIds.entries()) {
      const branchIndex = index + 1;
      const captureStepId = `capture_${branchIndex}`;
      steps.push({
        id: captureStepId,
        type: 'browser',
        dependsOn: [browseStepId],
        when: {
          op: 'exists',
          ref: `steps.${browseStepId}.output.pageId`,
        },
        input: {
          action: 'screenshot',
          pageId: `steps.${browseStepId}.output.pageId`,
        },
        policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
      });
      terminalStepIds.push(captureStepId);
      aggregateContext[`branch_${branchIndex}`] = {
        url: `steps.${browseStepId}.output.url`,
        title: `steps.${browseStepId}.output.title`,
        screenshotPath: `steps.${captureStepId}.output.screenshotPath`,
      };
    }
  } else {
    terminalStepIds.push(...browseStepIds);
    for (const [index, browseStepId] of browseStepIds.entries()) {
      const branchIndex = index + 1;
      aggregateContext[`branch_${branchIndex}`] = {
        url: `steps.${browseStepId}.output.url`,
        title: `steps.${browseStepId}.output.title`,
      };
    }
  }

  steps.push({
    id: 'aggregate',
    type: 'agent',
    dependsOn: terminalStepIds,
    input: {
      prompt: buildTaskPrompt(
        task,
        '请基于提供的各分支结果输出统一结论。逐项说明每个页面的状态、标题和截图结果，再给出最终综合结论。禁止编造缺失结果。',
      ),
      role: 'integration',
      context: aggregateContext,
    },
    policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
  });

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: ['aggregate'],
      input: {
        message: 'steps.aggregate.output.summary',
        level: 'info',
        channel: 'system',
        sessionId: task.sessionId,
      },
      policy: createStepPolicy(NOTIFICATION_STEP_TIMEOUT_MS),
    });
  }

  return {
    version: 'v1',
    name: `task-${task.id}`,
    steps: applyPromptCapabilitiesToWorkflow({
      version: 'v1',
      name: `task-${task.id}`,
      steps,
    }, options.promptCapabilityIds || []).steps,
  };
}

function buildTaskPrompt(task: Task, closingInstruction: string): string {
  const lines: string[] = [
    `任务: ${task.summary}`,
  ];

  if (task.requirements.length > 0) {
    lines.push('要求:');
    for (const requirement of task.requirements) {
      lines.push(`- ${requirement}`);
    }
  }

  const relevantMessages = Array.isArray(task.metadata?.relevantMessages)
    ? (task.metadata.relevantMessages as unknown[])
        .filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
    : [];

  if (relevantMessages.length > 0) {
    lines.push('相关上下文:');
    for (const message of relevantMessages) {
      lines.push(`- ${message}`);
    }
  }

  lines.push(closingInstruction);
  return lines.join('\n');
}

function buildPlannerUserPrompt(
  task: Task,
  capabilityContext?: PromptCapabilityPlanningContext,
  codeCapabilityContext?: CodeCapabilityPlanningContext,
  previousAttemptError?: string,
): string {
  const payload = {
    taskId: task.id,
    summary: task.summary,
    requirements: task.requirements,
    relevantMessages: Array.isArray(task.metadata?.relevantMessages) ? task.metadata.relevantMessages : [],
    publishedPromptCapabilities: (capabilityContext?.available || []).map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      summary: capability.summary,
      usageExamples: capability.usageExamples,
    })),
    publishedCodeCapabilities: (codeCapabilityContext?.available || []).map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      summary: capability.summary,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      usageExamples: capability.usageExamples,
    })),
    plannerRules: {
      researchPlanning: [
        'If the task asks for research, security issues, remediation plans, or report/export output based on external facts and no source material is already provided, prefer browser-based search/evidence collection before synthesis.',
        'Prefer search/evidence -> summarize -> export over pure multi-agent report drafting for those tasks.',
      ],
      promptCapabilityUsage: [
        'If a published prompt capability matches the task, you may attach it to an agent step using input.tools.',
        'Only attach published prompt capability IDs from the list above.',
        'Do not invent capability IDs.',
        'Prefer adding capabilities to agent steps that execute or finalize the actual task.',
      ],
      codeCapabilityUsage: [
        'If a published code capability matches the task and the task contains enough structured input, you may use a capability step.',
        'Only use published code capability IDs from the list above.',
        'Capability step input must be a concrete object, not a natural-language paragraph.',
      ],
      workflowDslConstraints: [
        'Workflow DSL v1 only supports step types: agent, browser, notification, capability.',
        'Agent step input only supports: prompt, role, model, tools, outputMode, context.',
        'Browser step input only supports: action, url, selector, value, pageId, createPage.',
        'Browser action only supports: navigate, click, fill, screenshot.',
        'To express web search, build a concrete static search-engine URL first, then use browser.navigate with input.url.',
        'Do not use unsupported browser fields such as query or prompt.',
        'Researcher steps are read-only; do not instruct them to write files.',
        'Prefer passing generated markdown/text through steps.someStep.output.summary instead of asking an agent step to write a temp file.',
        'If a capability such as md-converter needs markdown content, pass the upstream markdown text via input.mdContent from a step output reference.',
        `If an agent step generates a long-form plain-text report or synthesis, omit timeoutMs or use at least ${REPORT_SYNTHESIS_TIMEOUT_MS}.`,
        'Notification step input only supports: message, level, channel, sessionId.',
        'Capability step input only supports: capabilityId and input.',
      ],
    },
    responseSchema: {
      strategy: 'workflow | simple',
      reason: 'string',
      analysis: {
        complexity: 'simple | moderate | complex',
        needsBrowser: 'boolean',
        needsNotification: 'boolean',
        needsMultipleSteps: 'boolean',
        needsParallel: 'boolean',
        detectedUrl: 'optional string url; omit the field when no concrete url is detected, do not use null',
        detectedUrls: 'optional string[] of urls; omit the field when there are no urls, do not use [] or null',
      },
      workflowDsl: {
        version: 'v1',
        name: 'string',
        steps: [
          {
            id: 'string',
            type: 'agent | browser | notification | capability',
            dependsOn: ['string'],
            input: {
              prompt: 'string',
              role: 'optional worker | researcher | coder | integration',
              tools: ['optional published prompt capability ids'],
              context: 'optional object',
              capabilityId: 'required for capability step',
              input: 'required object for capability step',
            },
            policy: {
              timeoutMs: 10000,
              retry: {
                maximumAttempts: 2,
              },
            },
          },
        ],
      },
    },
    workflowExamples: {
      browserSearchSynthesis: {
        version: 'v1',
        name: 'task-example',
        steps: [
          {
            id: 'analyze',
            type: 'agent',
            input: {
              prompt: 'Analyze the research task and define evidence collection scope.',
              role: 'researcher',
            },
          },
          {
            id: 'search',
            type: 'browser',
            dependsOn: ['analyze'],
            input: {
              action: 'navigate',
              url: 'https://www.bing.com/search?q=openclaw%20security%20risk',
              createPage: true,
            },
          },
          {
            id: 'capture',
            type: 'browser',
            dependsOn: ['search'],
            when: {
              op: 'exists',
              ref: 'steps.search.output.pageId',
            },
            input: {
              action: 'screenshot',
              pageId: 'steps.search.output.pageId',
            },
          },
          {
            id: 'summarize',
            type: 'agent',
            dependsOn: ['capture'],
            input: {
              prompt: 'Summarize only from the provided search evidence.',
              role: 'integration',
              outputMode: 'plain-text',
              context: {
                searchResult: {
                  url: 'steps.search.output.url',
                  title: 'steps.search.output.title',
                  lines: 'steps.search.output.lines',
                  screenshotPath: 'steps.capture.output.screenshotPath',
                },
              },
            },
          },
        ],
      },
      reportExportWithCapability: {
        version: 'v1',
        name: 'task-report-export-example',
        steps: [
          {
            id: 'search',
            type: 'browser',
            input: {
              action: 'navigate',
              url: 'https://www.bing.com/search?q=openclaw%20security%20risk',
              createPage: true,
            },
          },
          {
            id: 'synthesize-report',
            type: 'agent',
            dependsOn: ['search'],
            policy: {
              timeoutMs: REPORT_SYNTHESIS_TIMEOUT_MS,
              retry: {
                maximumAttempts: 2,
              },
            },
            input: {
              prompt: 'Write the final Markdown report using only the provided evidence.',
              role: 'integration',
              outputMode: 'plain-text',
              context: {
                searchResult: {
                  url: 'steps.search.output.url',
                  title: 'steps.search.output.title',
                  lines: 'steps.search.output.lines',
                },
              },
            },
          },
          {
            id: 'export-pdf',
            type: 'capability',
            dependsOn: ['synthesize-report'],
            input: {
              capabilityId: 'md-converter',
              input: {
                mdContent: 'steps.synthesize-report.output.summary',
                targetFormat: 'pdf',
              },
            },
          },
        ],
      },
    },
    ...(previousAttemptError
      ? {
          previousAttemptFeedback: {
            previousAttemptFailed: true,
            error: previousAttemptError,
            instruction: 'Correct the previous error and return a fresh full JSON response that strictly matches the supported DSL contracts. Do not reuse unsupported step fields or unsupported browser actions.',
          },
        }
      : {}),
  };

  return JSON.stringify(payload, null, 2);
}

function normalizeAnalysis(
  analysis?: z.infer<typeof plannerResponseSchema>['analysis'],
): SchedulingPlanAnalysis {
  return {
    complexity: analysis?.complexity ?? 'moderate',
    needsBrowser: analysis?.needsBrowser ?? false,
    needsNotification: analysis?.needsNotification ?? false,
    needsMultipleSteps: analysis?.needsMultipleSteps ?? false,
    needsParallel: analysis?.needsParallel ?? false,
    ...(analysis?.detectedUrl ? { detectedUrl: analysis.detectedUrl } : {}),
    ...(analysis?.detectedUrls?.length ? { detectedUrls: analysis.detectedUrls } : {}),
  };
}

function validatePlannerWorkflowSemantics(spec: WorkflowDSL): string[] {
  const errors: string[] = [];
  const stepById = new Map(spec.steps.map((step) => [step.id, step] as const));

  for (const step of spec.steps) {
    if (step.type === 'agent') {
      const input = isRecord(step.input) ? step.input : {};
      const timeoutMs = step.policy?.timeoutMs;
      const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';

      if (typeof timeoutMs === 'number' && timeoutMs < AGENT_STEP_TIMEOUT_MS) {
        errors.push(`steps.${step.id}.policy.timeoutMs: agent steps must use timeoutMs >= ${AGENT_STEP_TIMEOUT_MS} or omit timeoutMs`);
      }

      if (typeof timeoutMs === 'number' && isLongFormSynthesisAgentStep(step, input) && timeoutMs < REPORT_SYNTHESIS_TIMEOUT_MS) {
        errors.push(`steps.${step.id}.policy.timeoutMs: long-form plain-text report synthesis agent steps must use timeoutMs >= ${REPORT_SYNTHESIS_TIMEOUT_MS} or omit timeoutMs`);
      }

      if (role === 'researcher' && promptRequestsFileWrite(prompt)) {
        errors.push(`steps.${step.id}.input.prompt: researcher steps are read-only and must not be instructed to write files; return the report text in output.summary instead`);
      }
    }

    if (step.type === 'capability') {
      const input = isRecord(step.input) ? step.input : {};
      const capabilityId = typeof input.capabilityId === 'string' ? input.capabilityId.trim() : '';
      const capabilityInput = isRecord(input.input) ? input.input : null;
      if (!capabilityInput) {
        continue;
      }

      if (capabilityId === 'md-converter') {
        const mdContent = capabilityInput.mdContent;
        if (
          typeof mdContent === 'string'
          && isAbsolutePathLike(mdContent)
          && dependsOnPlainTextAgentStep(step, stepById)
        ) {
          errors.push(`steps.${step.id}.input.input.mdContent: md-converter should consume markdown text from an upstream step output reference (for example steps.someStep.output.summary) instead of a hardcoded absolute path`);
        }
      }
    }
  }

  return errors;
}

function isLongFormSynthesisAgentStep(
  step: WorkflowStep,
  input: Record<string, unknown>,
): boolean {
  if (input.outputMode !== 'plain-text') {
    return false;
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt.toLowerCase() : '';
  const stepId = step.id.toLowerCase();

  return matchesAny(prompt, [
    'report',
    'markdown',
    'pdf',
    'security risk',
    'research report',
    '风险',
    '研究报告',
    '报告',
    '总结',
    '汇总',
    '整改',
    '缓解',
  ]) || matchesAny(stepId, [
    'report',
    'synth',
    'summarize',
    'summary',
    'finalize',
    'draft',
  ]);
}

function promptRequestsFileWrite(prompt: string): boolean {
  return /write(?:\s+the)?(?:\s+full)?(?:\s+markdown)?(?:\s+report)?(?:\s+content)?\s+to\s+file|save(?:\s+the)?(?:\s+report)?\s+to\s+file|write\s+.+\/tmp\/|写入文件|保存到文件|写到文件|落盘|输出到文件|写入\s*\/tmp\//iu.test(prompt);
}

function isAbsolutePathLike(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed);
}

function dependsOnPlainTextAgentStep(
  step: WorkflowStep,
  stepById: ReadonlyMap<string, WorkflowStep>,
): boolean {
  return (step.dependsOn ?? []).some((dependencyId) => {
    const dependency = stepById.get(dependencyId);
    if (!dependency || dependency.type !== 'agent' || !isRecord(dependency.input)) {
      return false;
    }

    return dependency.input.outputMode === 'plain-text';
  });
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateText = codeFenceMatch?.[1]?.trim() || trimmed;

  for (let index = candidateText.lastIndexOf('{'); index >= 0; index = candidateText.lastIndexOf('{', index - 1)) {
    const candidate = candidateText.slice(index);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function estimateDurationSeconds(
  workflowDsl: WorkflowDSL,
  analysis: SchedulingPlanAnalysis,
): number {
  if (analysis.needsBrowser || workflowDsl.steps.some((step) => step.type === 'browser')) {
    if (analysis.needsParallel || (analysis.detectedUrls?.length ?? 0) > 1) {
      return Math.max(BROWSER_WORKFLOW_ESTIMATED_DURATION_SECONDS, 120 + ((analysis.detectedUrls?.length ?? 0) * 30));
    }
    return BROWSER_WORKFLOW_ESTIMATED_DURATION_SECONDS;
  }
  return WORKFLOW_ESTIMATED_DURATION_SECONDS;
}
