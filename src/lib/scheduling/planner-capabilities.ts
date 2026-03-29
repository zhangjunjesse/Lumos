import {
  listPublishedCodeCapabilities,
  listPublishedPromptCapabilities,
  type PublishedCodeCapabilitySummary,
} from '@/lib/db/capabilities';
import type { Task } from '@/lib/task-management/types';
import type { WorkflowDSL, WorkflowStep } from '@/lib/workflow/types';
import {
  type StructuredDeliverableCapability,
  type PromptCapabilityPlanningContext,
  type CodeCapabilityPlanningContext,
  DELIVERABLE_FORMAT_ALIASES,
  CAPABILITY_CONTENT_INPUT_CANDIDATES,
  CAPABILITY_FORMAT_INPUT_CANDIDATES,
} from './planner-types';

export function collectTaskText(task: Task): string {
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

export function normalizeCapabilityMatchText(value: string): string {
  return value.trim().toLowerCase();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function collectSchemaFieldNames(schema: Record<string, unknown>): string[] {
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

export function findSchemaFieldName(
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

export function inferRequestedDeliverableFormat(
  normalizedText: string,
): StructuredDeliverableCapability['targetFormat'] | undefined {
  for (const alias of DELIVERABLE_FORMAT_ALIASES) {
    if (alias.patterns.some((pattern) => normalizedText.includes(pattern))) {
      return alias.format;
    }
  }
  return undefined;
}

export function stringifyCapabilitySummary(capability: PublishedCodeCapabilitySummary): string {
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

export function findStructuredDeliverableCapability(
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

export function buildPromptCapabilityPlanningContext(task: Task): PromptCapabilityPlanningContext {
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

export function buildCodeCapabilityPlanningContext(task: Task): CodeCapabilityPlanningContext {
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

export function extractExplicitCapabilityInput(task: Task): Record<string, unknown> | undefined {
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

export function withPromptCapabilityTools(
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

export function applyPromptCapabilitiesToWorkflow(
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

/**
 * Extract the outermost JSON object from a raw text string.
 * Searches backwards from the last `{` to find a valid JSON object.
 */
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
