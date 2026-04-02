import {
  listPublishedCodeCapabilities,
  listPublishedPromptCapabilities,
} from '@/lib/db/capabilities';
import { listPublishedWorkflowAgentPresets } from '@/lib/db/workflow-agent-presets';
import type { Task } from '@/lib/task-management/types';
import type {
  PromptCapabilityPlanningContext,
  CodeCapabilityPlanningContext,
  WorkflowAgentPlanningContext,
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

/**
 * Extract the outermost JSON object from a raw text string.
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

export function buildWorkflowAgentPlanningContext(): WorkflowAgentPlanningContext {
  const presets = listPublishedWorkflowAgentPresets();
  return {
    available: presets.map((p) => ({
      id: p.id,
      name: p.name,
      expertise: p.config.expertise,
      category: p.category,
    })),
  };
}

// Keep these exports for backward compatibility with planner-prompt
export { findSchemaFieldName, collectSchemaFieldNames };
