import { getSession, getSetting } from '@/lib/db/sessions';
import { providerSupportsCapability } from '@/lib/provider-config';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getProviderModelOptions } from '@/lib/model-metadata';
import { generateObjectWithFallback } from '@/lib/text-generator';
import type { Task } from '@/lib/task-management/types';
import { getSchedulingPlannerConfig } from '@/lib/workflow/agent-config';
import { validateWorkflowDsl } from '@/lib/workflow/dsl';
import type { WorkflowDSL } from '@/lib/workflow/types';
import type { ApiProvider } from '@/types';
import {
  type SchedulingPlanAnalysis,
  type SchedulingTaskComplexity,
  type PlannerModelContext,
  type PlannerProviderRow,
  SIMPLE_ESTIMATED_DURATION_SECONDS,
  plannerResponseSchema,
} from './planner-types';
import {
  buildPromptCapabilityPlanningContext,
  buildCodeCapabilityPlanningContext,
  buildWorkflowAgentPlanningContext,
} from './planner-capabilities';
import {
  normalizeAnalysis,
  validatePlannerWorkflowSemantics,
  estimateDurationSeconds,
} from './planner-validation';
import { buildPlannerUserPrompt } from './planner-prompt';

export type SchedulingStrategy = 'workflow' | 'simple';
export type SchedulingPlanSource = 'llm';
export type { SchedulingTaskComplexity, SchedulingPlanAnalysis };
export { plannerResponseSchema };

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

export async function resolveSchedulingPlan(task: Task): Promise<SchedulingPlan> {
  const plannerConfig = getSchedulingPlannerConfig();
  const llmContext = resolvePlannerModelContext(task);
  const promptCapabilityContext = buildPromptCapabilityPlanningContext(task);
  const codeCapabilityContext = buildCodeCapabilityPlanningContext(task);
  const agentPlanningContext = buildWorkflowAgentPlanningContext();

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
      const parsed = await generateObjectWithFallback({
        providerId: llmContext.provider.id,
        model: llmContext.model,
        system: plannerConfig.systemPrompt,
        prompt: buildPlannerUserPrompt(task, promptCapabilityContext, codeCapabilityContext, previousAttemptError, agentPlanningContext),
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

// ---------------------------------------------------------------------------
// Provider / model resolution
// ---------------------------------------------------------------------------

function isUsablePlannerProvider(
  provider: PlannerProviderRow | null | undefined,
): provider is PlannerProviderRow {
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
  const plannerConfig = getSchedulingPlannerConfig();

  // Prefer the scheduling agent's configured provider/model over session defaults
  const provider = resolvePlannerProvider(plannerConfig.preferredProviderId || session?.provider_id);
  if (!provider) {
    return null;
  }

  const configuredModel = (
    plannerConfig.preferredModel
    || session?.requested_model
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

// ---------------------------------------------------------------------------
// Retry utilities (inlined from deleted planner-dsl-utils)
// ---------------------------------------------------------------------------

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
  return value.replace(/\s+/g, ' ').trim();
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
      const responseBodyText = getPlannerResponseBodyExcerpt(error);
      const details = [
        statusCode ? `status ${statusCode}` : '',
        responseBodyText ? `body: ${responseBodyText}` : '',
      ].filter(Boolean).join(', ');

      return details
        ? `Invalid JSON response from planner provider (${details})`
        : error.message;
    }

    return error.message || 'Unknown planner error';
  }

  return String(error);
}
