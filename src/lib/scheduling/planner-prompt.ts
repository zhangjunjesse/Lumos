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
        '工作流只包含 agent 节点，每个节点必须使用 availableWorkflowAgents 中的 preset id。',
        '如果某节点没有完全匹配的 preset，选择能力最接近的 agent，并在 prompt 中说明具体任务。',
        '不要使用 role 字段；不要引用不在 availableWorkflowAgents 列表中的 preset id。',
      ],
      promptCapabilityUsage: [
        '如果已发布的提示词能力与任务匹配，可以通过 input.tools 附加到 agent 节点。',
        '只使用上方列表中的 capability id，不要创造不存在的 id。',
      ],
      workflowDslConstraints: [
        '工作流 DSL v3 — planner 只输出 agent 节点和 kind="next" 的边；控制流（if-else/for-each/while/parallel/join/approval）由高级编辑器产出，planner 不使用。',
        'agent 节点 input 只支持：prompt、preset、model、tools、outputMode、context。',
        '节点 ID 用 kebab-case。按执行顺序在 nodes[] 列出，并在 edges[] 用 kind="next" 将前一个节点连到下一个节点（线性链，不产出分叉/并发）。',
        '最后一个 agent 节点不需要出边。只有一个 agent 时 edges 为空数组。',
        'agent 的 prompt 只能是字面字符串或精确引用，如 steps.someNode.output.summary。',
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
        version: 'v3',
        name: 'string',
        nodes: [
          {
            id: 'string',
            type: 'agent',
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
        edges: [
          { from: 'previousNodeId', to: 'nextNodeId', kind: 'next' },
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
