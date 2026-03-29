import type { Task } from '@/lib/task-management/types';
import type { WorkflowDSL } from '@/lib/workflow/types';
import {
  AGENT_STEP_TIMEOUT_MS,
  LONG_AGENT_STEP_TIMEOUT_MS,
  NOTIFICATION_STEP_TIMEOUT_MS,
} from './planner-types';
import { buildTaskPrompt } from './planner-prompt';
import { createStepPolicy, buildWorkflowWithCapabilities } from './planner-dsl-utils';

// ---------------------------------------------------------------------------
// Agent workflow builders
// ---------------------------------------------------------------------------

export function buildAgentWorkflowDsl(
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
            '不要写"我已分析""以下是总结""可交接说明如下"这类元描述。',
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

  return buildWorkflowWithCapabilities(
    task.id, steps, options.promptCapabilityIds || [],
  );
}

export function buildImplementationWorkflowDsl(
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

  return buildWorkflowWithCapabilities(
    task.id, steps, options.promptCapabilityIds || [],
  );
}

export function buildCodeCapabilityWorkflowDsl(
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
