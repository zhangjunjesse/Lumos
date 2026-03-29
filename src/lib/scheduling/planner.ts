import { z } from 'zod';
import { getSession, getSetting } from '@/lib/db/sessions';
import { providerSupportsCapability } from '@/lib/provider-config';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getProviderModelOptions } from '@/lib/model-metadata';
import { generateObjectFromProvider } from '@/lib/text-generator';
import type { Task } from '@/lib/task-management/types';
import { getSchedulingPlannerConfig } from '@/lib/workflow/agent-config';
import { validateWorkflowDsl } from '@/lib/workflow/dsl';
import type { WorkflowDSL } from '@/lib/workflow/types';
import type { ApiProvider } from '@/types';
import {
  type SchedulingPlanAnalysis,
  type SchedulingTaskComplexity,
  WORKFLOW_ESTIMATED_DURATION_SECONDS,
  BROWSER_WORKFLOW_ESTIMATED_DURATION_SECONDS,
  IMPLEMENTATION_INTENT_PATTERNS,
  REPORT_INTENT_PATTERNS,
  EXPORT_INTENT_PATTERNS,
} from './planner-types';
import {
  collectTaskText,
  buildPromptCapabilityPlanningContext,
  buildCodeCapabilityPlanningContext,
  findStructuredDeliverableCapability,
} from './planner-capabilities';
import {
  matchesAny,
  matchesIntent,
  shouldPreferEvidenceSearchFlow,
  extractUrls,
  inferSearchTarget,
} from './planner-intent';
import {
  normalizeAnalysis,
  validatePlannerWorkflowSemantics,
  estimateDurationSeconds,
} from './planner-validation';
import {
  sleep,
  getPlannerRetryDelayMs,
  normalizePlannerError,
  buildAgentWorkflowDsl,
  buildImplementationWorkflowDsl,
  buildReportWorkflowDsl,
  buildSearchWorkflowDsl,
  buildCodeCapabilityWorkflowDsl,
  buildBrowserWorkflowDsl,
  buildParallelBrowserWorkflowDsl,
  buildHybridParallelBrowserWorkflowDsl,
} from './planner-dsl';
import { buildPlannerUserPrompt } from './planner-prompt';

export type SchedulingStrategy = 'workflow' | 'simple';
export type SchedulingPlanSource = 'heuristic' | 'llm';
export type { SchedulingTaskComplexity, SchedulingPlanAnalysis };

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

const SIMPLE_ESTIMATED_DURATION_SECONDS = 45;
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
      const parsed = await generateObjectFromProvider({
        providerId: llmContext.provider.id,
        model: llmContext.model,
        system: plannerConfig.systemPrompt,
        prompt: buildPlannerUserPrompt(task, promptCapabilityContext, codeCapabilityContext, previousAttemptError),
        schema: plannerResponseSchema,
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
  provider: ApiProvider;
  model: string;
  workingDirectory?: string;
}

type PlannerProviderRow = Pick<
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

function isUsablePlannerProvider(provider: PlannerProviderRow | null | undefined): provider is PlannerProviderRow {
  return Boolean(
    provider
    && providerSupportsCapability(provider, 'text-gen')
    && (
      provider.auth_mode === 'local_auth'
      || (typeof provider.api_key === 'string' && provider.api_key.trim().length > 0)
    ),
  );
}

function resolvePlannerProvider(preferredProviderId?: string): PlannerProviderRow | undefined {
  const provider = resolveProviderForCapability({
    moduleKey: 'workflow',
    capability: 'text-gen',
    preferredProviderId,
  }) as PlannerProviderRow | undefined;
  return isUsablePlannerProvider(provider) ? provider : undefined;
}

function resolvePlannerModelContext(task: Task): PlannerModelContext | null {
  const session = getSession(task.sessionId);
  const provider = resolvePlannerProvider(session?.provider_id);
  if (!provider) {
    return null;
  }
  const configuredModel = (
    session?.requested_model
    || session?.model
    || getSetting('model_override:workflow')
    || getSetting('default_model')
    || ''
  ).trim();
  const fallbackModel = getProviderModelOptions(provider)[0]?.value?.trim() || '';
  const model = configuredModel || fallbackModel;

  if (!model) {
    return null;
  }

  return {
    provider: provider as ApiProvider,
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
