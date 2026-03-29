import type { Task } from '@/lib/task-management/types';
import type { WorkflowDSL } from '@/lib/workflow/types';
import {
  LONG_AGENT_STEP_TIMEOUT_MS,
  AGENT_STEP_TIMEOUT_MS,
  NOTIFICATION_STEP_TIMEOUT_MS,
} from './planner-types';
import type { StructuredDeliverableCapability } from './planner-types';
import { applyPromptCapabilitiesToWorkflow } from './planner-capabilities';
import { buildTaskPrompt } from './planner-prompt';

// ---------------------------------------------------------------------------
// Utility helpers for planner DSL
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getPlannerRetryDelayMs(attempt: number): number {
  return 1000 * (attempt + 1);
}

export function extractPlannerErrorText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\s+/g, ' ')
    .trim();
}

export function getPlannerResponseBodyExcerpt(error: unknown): string {
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

export function normalizePlannerError(error: unknown, timeoutMs: number): string {
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

// ---------------------------------------------------------------------------
// Step policy helper
// ---------------------------------------------------------------------------

export function createStepPolicy(timeoutMs: number, maximumAttempts: number = 1) {
  return {
    timeoutMs,
    retry: {
      maximumAttempts,
    },
  };
}

// ---------------------------------------------------------------------------
// Workflow wrapper helper
// ---------------------------------------------------------------------------

export function buildWorkflowWithCapabilities(
  taskId: string,
  steps: WorkflowDSL['steps'],
  promptCapabilityIds: string[],
): WorkflowDSL {
  return {
    version: 'v1',
    name: `task-${taskId}`,
    steps: applyPromptCapabilitiesToWorkflow({
      version: 'v1',
      name: `task-${taskId}`,
      steps,
    }, promptCapabilityIds).steps,
  };
}

// ---------------------------------------------------------------------------
// Structured deliverable steps (shared by search & report)
// ---------------------------------------------------------------------------

export function appendStructuredDeliverableSteps(
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
