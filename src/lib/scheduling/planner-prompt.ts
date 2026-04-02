import type { Task } from '@/lib/task-management/types';
import type {
  PromptCapabilityPlanningContext,
  CodeCapabilityPlanningContext,
  WorkflowAgentPlanningContext,
} from './planner-types';

export function buildTaskPrompt(task: Task, closingInstruction: string): string {
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

export function buildPlannerUserPrompt(
  task: Task,
  capabilityContext?: PromptCapabilityPlanningContext,
  codeCapabilityContext?: CodeCapabilityPlanningContext,
  previousAttemptError?: string,
  agentContext?: WorkflowAgentPlanningContext,
): string {
  const payload = {
    taskId: task.id,
    summary: task.summary,
    requirements: task.requirements,
    relevantMessages: Array.isArray(task.metadata?.relevantMessages) ? task.metadata.relevantMessages : [],
    availableWorkflowAgents: (agentContext?.available ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      expertise: a.expertise,
    })),
    publishedPromptCapabilities: (capabilityContext?.available || []).map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      summary: capability.summary,
      usageExamples: capability.usageExamples,
    })),
    plannerRules: {
      agentUsage: [
        '工作流只包含 agent 步骤，每个步骤必须使用 availableWorkflowAgents 中的 preset id。',
        '如果某步骤没有完全匹配的 preset，选择能力最接近的 agent，并在 prompt 中说明具体任务。',
        '不要使用 role 字段；不要引用不在 availableWorkflowAgents 列表中的 preset id。',
      ],
      promptCapabilityUsage: [
        '如果已发布的提示词能力与任务匹配，可以通过 input.tools 附加到 agent 步骤。',
        '只使用上方列表中的 capability id，不要创造不存在的 id。',
      ],
      workflowDslConstraints: [
        '工作流 DSL v1 只支持 agent 步骤类型。',
        'agent 步骤 input 只支持：prompt、preset、model、tools、outputMode、context。',
        '步骤 ID 用 kebab-case；dependsOn 引用其他步骤 ID；无共同依赖的步骤自动并行。',
        'agent 的 prompt 只能是字面字符串或精确引用，如 steps.someStep.output.summary。',
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
            type: 'agent',
            dependsOn: ['string'],
            input: {
              preset: 'preset id from availableWorkflowAgents',
              prompt: 'string',
              tools: ['optional published prompt capability ids'],
              context: 'optional object',
            },
            policy: {
              timeoutMs: 90000,
              retry: { maximumAttempts: 2 },
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
            instruction: '修正上次错误，返回符合约束的完整 JSON，不得使用不支持的步骤字段。',
          },
        }
      : {}),
  };

  return JSON.stringify(payload, null, 2);
}
