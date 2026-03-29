import type { Task } from '@/lib/task-management/types';
import type { WorkflowDSL } from '@/lib/workflow/types';
import {
  AGENT_STEP_TIMEOUT_MS,
  BROWSER_STEP_TIMEOUT_MS,
  NOTIFICATION_STEP_TIMEOUT_MS,
} from './planner-types';
import { buildTaskPrompt } from './planner-prompt';
import { createStepPolicy, buildWorkflowWithCapabilities } from './planner-dsl-utils';

// ---------------------------------------------------------------------------
// Browser workflow builders
// ---------------------------------------------------------------------------

export function buildBrowserWorkflowDsl(
  task: Task,
  options: {
    detectedUrl: string;
    includeScreenshot: boolean;
    includeNotification: boolean;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const steps: WorkflowDSL['steps'] = [
    {
      id: 'draft',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(task, '请输出一段简短执行说明，说明接下来要完成的浏览器任务。'),
        role: 'worker',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'browse',
      type: 'browser',
      dependsOn: ['draft'],
      input: {
        action: 'navigate',
        url: options.detectedUrl,
        createPage: true,
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    },
  ];

  let finalStepId = 'browse';

  if (options.includeScreenshot) {
    steps.push({
      id: 'capture',
      type: 'browser',
      dependsOn: ['browse'],
      when: {
        op: 'exists',
        ref: 'steps.browse.output.pageId',
      },
      input: {
        action: 'screenshot',
        pageId: 'steps.browse.output.pageId',
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    });
    finalStepId = 'capture';
  }

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: [finalStepId],
      input: {
        message: `任务已完成：${task.summary}`,
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

export function buildParallelBrowserWorkflowDsl(
  task: Task,
  options: {
    detectedUrls: string[];
    includeScreenshot: boolean;
    includeNotification: boolean;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const steps: WorkflowDSL['steps'] = [
    {
      id: 'draft',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(task, '请输出一段简短执行说明，说明接下来要分别完成的浏览器任务。'),
        role: 'worker',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
  ];

  const browseStepIds: string[] = [];
  const terminalStepIds: string[] = [];

  for (const [index, url] of options.detectedUrls.entries()) {
    const branchIndex = index + 1;
    const browseStepId = `browse_${branchIndex}`;
    browseStepIds.push(browseStepId);

    steps.push({
      id: browseStepId,
      type: 'browser',
      dependsOn: ['draft'],
      input: {
        action: 'navigate',
        url,
        createPage: true,
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    });
  }

  if (options.includeScreenshot) {
    for (const [index, browseStepId] of browseStepIds.entries()) {
      const captureStepId = `capture_${index + 1}`;
      steps.push({
        id: captureStepId,
        type: 'browser',
        dependsOn: [browseStepId],
        when: {
          op: 'exists',
          ref: `steps.${browseStepId}.output.pageId`,
        },
        input: {
          action: 'screenshot',
          pageId: `steps.${browseStepId}.output.pageId`,
        },
        policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
      });
      terminalStepIds.push(captureStepId);
    }
  } else {
    terminalStepIds.push(...browseStepIds);
  }

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: terminalStepIds,
      input: {
        message: `并行浏览器任务已完成：${task.summary}`,
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

export function buildHybridParallelBrowserWorkflowDsl(
  task: Task,
  options: {
    detectedUrls: string[];
    includeScreenshot: boolean;
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
          '请先整理本次多页面并行任务的核对重点、比较维度和最终汇总要求，输出一段供后续步骤直接消费的简洁说明。',
        ),
        role: 'researcher',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
  ];

  const browseStepIds: string[] = [];
  const terminalStepIds: string[] = [];
  const aggregateContext: Record<string, unknown> = {
    analysis: 'steps.analyze.output.summary',
  };

  for (const [index, url] of options.detectedUrls.entries()) {
    const branchIndex = index + 1;
    const browseStepId = `browse_${branchIndex}`;
    browseStepIds.push(browseStepId);

    steps.push({
      id: browseStepId,
      type: 'browser',
      dependsOn: ['analyze'],
      input: {
        action: 'navigate',
        url,
        createPage: true,
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    });
  }

  if (options.includeScreenshot) {
    for (const [index, browseStepId] of browseStepIds.entries()) {
      const branchIndex = index + 1;
      const captureStepId = `capture_${branchIndex}`;
      steps.push({
        id: captureStepId,
        type: 'browser',
        dependsOn: [browseStepId],
        when: {
          op: 'exists',
          ref: `steps.${browseStepId}.output.pageId`,
        },
        input: {
          action: 'screenshot',
          pageId: `steps.${browseStepId}.output.pageId`,
        },
        policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
      });
      terminalStepIds.push(captureStepId);
      aggregateContext[`branch_${branchIndex}`] = {
        url: `steps.${browseStepId}.output.url`,
        title: `steps.${browseStepId}.output.title`,
        screenshotPath: `steps.${captureStepId}.output.screenshotPath`,
      };
    }
  } else {
    terminalStepIds.push(...browseStepIds);
    for (const [index, browseStepId] of browseStepIds.entries()) {
      const branchIndex = index + 1;
      aggregateContext[`branch_${branchIndex}`] = {
        url: `steps.${browseStepId}.output.url`,
        title: `steps.${browseStepId}.output.title`,
      };
    }
  }

  steps.push({
    id: 'aggregate',
    type: 'agent',
    dependsOn: terminalStepIds,
    input: {
      prompt: buildTaskPrompt(
        task,
        '请基于提供的各分支结果输出统一结论。逐项说明每个页面的状态、标题和截图结果，再给出最终综合结论。禁止编造缺失结果。',
      ),
      role: 'integration',
      context: aggregateContext,
    },
    policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
  });

  if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: ['aggregate'],
      input: {
        message: 'steps.aggregate.output.summary',
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
