import type { WorkflowDSL, WorkflowStep } from '@/lib/workflow/types';
import { getWorkflowAgentPreset } from '@/lib/db/workflow-agent-presets';
import {
  type SchedulingPlanAnalysis,
  WORKFLOW_ESTIMATED_DURATION_SECONDS,
  AGENT_STEP_TIMEOUT_MS,
  REPORT_SYNTHESIS_TIMEOUT_MS,
} from './planner-types';

/** Shape matching plannerResponseSchema['analysis'] so we don't import zod here. */
interface PlannerAnalysisInput {
  complexity?: 'simple' | 'moderate' | 'complex';
  needsBrowser?: boolean;
  needsNotification?: boolean;
  needsMultipleSteps?: boolean;
  needsParallel?: boolean;
  detectedUrl?: string;
  detectedUrls?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesAny(source: string, patterns: string[]): boolean {
  return patterns.some((pattern) => source.includes(pattern.toLowerCase()));
}

function resolvePresetRole(presetId: string): string | undefined {
  try {
    return getWorkflowAgentPreset(presetId)?.config.role;
  } catch {
    return undefined;
  }
}

export function normalizeAnalysis(
  analysis?: PlannerAnalysisInput,
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

export function validatePlannerWorkflowSemantics(spec: WorkflowDSL): string[] {
  const errors: string[] = [];
  const stepById = new Map(spec.steps.map((step) => [step.id, step] as const));

  for (const step of spec.steps) {
    if (step.type === 'agent') {
      const input = isRecord(step.input) ? step.input : {};
      const timeoutMs = step.policy?.timeoutMs;
      const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
      const presetRole = typeof input.preset === 'string' ? resolvePresetRole(input.preset) : undefined;
      const effectiveRole = role || presetRole || '';
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';

      if (typeof timeoutMs === 'number' && timeoutMs < AGENT_STEP_TIMEOUT_MS) {
        errors.push(`steps.${step.id}.policy.timeoutMs: agent steps must use timeoutMs >= ${AGENT_STEP_TIMEOUT_MS} or omit timeoutMs`);
      }

      if (typeof timeoutMs === 'number' && isLongFormSynthesisAgentStep(step, input) && timeoutMs < REPORT_SYNTHESIS_TIMEOUT_MS) {
        errors.push(`steps.${step.id}.policy.timeoutMs: long-form plain-text report synthesis agent steps must use timeoutMs >= ${REPORT_SYNTHESIS_TIMEOUT_MS} or omit timeoutMs`);
      }

      if (effectiveRole === 'researcher' && promptRequestsFileWrite(prompt)) {
        errors.push(`steps.${step.id}.input.prompt: researcher steps are read-only and must not be instructed to write files; return the report text in output.summary instead`);
      }
    }

  }

  return errors;
}

export function isLongFormSynthesisAgentStep(
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

export function promptRequestsFileWrite(prompt: string): boolean {
  return /write(?:\s+the)?(?:\s+full)?(?:\s+markdown)?(?:\s+report)?(?:\s+content)?\s+to\s+file|save(?:\s+the)?(?:\s+report)?\s+to\s+file|write\s+.+\/tmp\/|写入文件|保存到文件|写到文件|落盘|输出到文件|写入\s*\/tmp\//iu.test(prompt);
}

export function isAbsolutePathLike(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed);
}

export function dependsOnPlainTextAgentStep(
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

export function extractJsonObject(raw: string): string | null {
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

export function estimateDurationSeconds(
  workflowDsl: WorkflowDSL,
  analysis: SchedulingPlanAnalysis,
): number {
  return WORKFLOW_ESTIMATED_DURATION_SECONDS;
}
