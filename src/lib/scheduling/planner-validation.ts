import type { WorkflowDSLV3, WorkflowNode, AgentNode } from '@/lib/workflow/types-v3';
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

export function validatePlannerWorkflowSemantics(spec: WorkflowDSLV3): string[] {
  const errors: string[] = [];

  for (const node of spec.nodes) {
    if (node.type === 'agent') {
      const input = isRecord(node.input) ? node.input : {};
      const timeoutMs = node.policy?.timeoutMs;
      const role = typeof input.role === 'string' ? input.role.trim().toLowerCase() : '';
      const presetRole = typeof input.preset === 'string' ? resolvePresetRole(input.preset) : undefined;
      const effectiveRole = role || presetRole || '';
      const prompt = typeof input.prompt === 'string' ? input.prompt : '';

      if (typeof timeoutMs === 'number' && timeoutMs < AGENT_STEP_TIMEOUT_MS) {
        errors.push(`nodes.${node.id}.policy.timeoutMs: agent nodes must use timeoutMs >= ${AGENT_STEP_TIMEOUT_MS} or omit timeoutMs`);
      }

      if (typeof timeoutMs === 'number' && isLongFormSynthesisAgentNode(node, input) && timeoutMs < REPORT_SYNTHESIS_TIMEOUT_MS) {
        errors.push(`nodes.${node.id}.policy.timeoutMs: long-form plain-text report synthesis agent nodes must use timeoutMs >= ${REPORT_SYNTHESIS_TIMEOUT_MS} or omit timeoutMs`);
      }

      if (effectiveRole === 'researcher' && promptRequestsFileWrite(prompt)) {
        errors.push(`nodes.${node.id}.input.prompt: researcher nodes are read-only and must not be instructed to write files; return the report text in output.summary instead`);
      }
    }
  }

  return errors;
}

export function isLongFormSynthesisAgentNode(
  node: AgentNode,
  input: Record<string, unknown>,
): boolean {
  if (input.outputMode !== 'plain-text') {
    return false;
  }

  const prompt = typeof input.prompt === 'string' ? input.prompt.toLowerCase() : '';
  const nodeId = node.id.toLowerCase();

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
  ]) || matchesAny(nodeId, [
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

export function dependsOnPlainTextAgentNode(
  node: WorkflowNode,
  nodeById: ReadonlyMap<string, WorkflowNode>,
  edges: readonly { from: string; to: string; kind: string }[],
): boolean {
  const predecessors = edges
    .filter((edge) => edge.to === node.id && edge.kind === 'next')
    .map((edge) => nodeById.get(edge.from));

  return predecessors.some((pred) => {
    if (!pred || pred.type !== 'agent' || !isRecord(pred.input)) return false;
    return pred.input.outputMode === 'plain-text';
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
  _workflowDsl: WorkflowDSLV3,
  _analysis: SchedulingPlanAnalysis,
): number {
  void _workflowDsl;
  void _analysis;
  return WORKFLOW_ESTIMATED_DURATION_SECONDS;
}
