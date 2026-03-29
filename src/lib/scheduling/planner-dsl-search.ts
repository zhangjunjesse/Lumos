import type { Task } from '@/lib/task-management/types';
import type { WorkflowDSL } from '@/lib/workflow/types';
import {
  AGENT_STEP_TIMEOUT_MS,
  REPORT_WRITING_TIMEOUT_MS,
  REPORT_SYNTHESIS_TIMEOUT_MS,
  BROWSER_STEP_TIMEOUT_MS,
  NOTIFICATION_STEP_TIMEOUT_MS,
  SECURITY_RESEARCH_PATTERNS,
  REMEDIATION_INTENT_PATTERNS,
} from './planner-types';
import type {
  SearchTarget,
  StructuredDeliverableCapability,
} from './planner-types';
import { collectTaskText } from './planner-capabilities';
import { matchesAny } from './planner-intent';
import { buildTaskPrompt } from './planner-prompt';
import {
  createStepPolicy,
  appendStructuredDeliverableSteps,
  buildWorkflowWithCapabilities,
} from './planner-dsl-utils';

// ---------------------------------------------------------------------------
// Report workflow builder
// ---------------------------------------------------------------------------

export function buildReportWorkflowDsl(
  task: Task,
  options: {
    includeNotification: boolean;
    includeFormattedDeliverable: boolean;
    exportCapability?: StructuredDeliverableCapability;
    promptCapabilityIds?: string[];
  },
): WorkflowDSL {
  const finalInstruction = options.exportCapability
    ? '请基于已提供的分析和写作提纲，一次性输出可直接用于后续导出的完整 Markdown 正文。优先高信息密度内容，避免空话和重复，不要写"PDF 需求已记录"之类的占位说明。正文要结构清晰，便于转换成最终文件。'
    : options.includeFormattedDeliverable
      ? '请基于已提供的分析和写作提纲，一次性输出可直接交付的简洁正文结果，控制篇幅，优先给出高信息密度内容；如果用户要求 PDF，请在结果中明确说明 PDF 导出需求已记录，并先提供完整正文内容。'
    : '请基于已提供的分析和写作提纲，输出面向用户的最终报告或结论，结构清晰，控制篇幅，禁止编造未给出的事实。';

  const steps: WorkflowDSL['steps'] = [
    {
      id: 'analyze',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(
          task,
          [
            '请先拆出报告任务的目标、读者对象、重点问题和输出结构。',
            '输出一段可直接交给后续步骤使用的执行说明，不要写元描述。',
          ].join(' '),
        ),
        role: 'researcher',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'draft',
      type: 'agent',
      dependsOn: ['analyze'],
      input: {
        prompt: buildTaskPrompt(
          task,
          [
            '请基于已提供的分析说明，产出一份供最终成稿直接使用的精简 Markdown 提纲。',
            '只输出标题建议、章节结构、每节关键要点、必须回答的问题和不要编造的边界。',
            '不要直接展开成长篇报告，不要输出面向用户的最终正文。',
            '提纲必须足够清晰，让下游步骤据此一次性写出最终报告。',
          ].join(' '),
        ),
        role: 'researcher',
        context: {
          analysis: 'steps.analyze.output.summary',
        },
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'finalize',
      type: 'agent',
      dependsOn: ['draft'],
      input: {
        prompt: buildTaskPrompt(task, finalInstruction),
        role: 'integration',
        outputMode: 'plain-text',
        context: {
          analysis: 'steps.analyze.output.summary',
          outline: 'steps.draft.output.summary',
        },
      },
      policy: createStepPolicy(REPORT_WRITING_TIMEOUT_MS, 2),
    },
  ];

  appendStructuredDeliverableSteps(task, steps, {
    baseStepId: 'finalize',
    baseOutputRef: 'steps.finalize.output.summary',
    includeNotification: options.includeNotification,
    exportCapability: options.exportCapability,
  });

  return buildWorkflowWithCapabilities(
    task.id, steps, options.promptCapabilityIds || [],
  );
}

// ---------------------------------------------------------------------------
// Search synthesis instruction
// ---------------------------------------------------------------------------

export function buildSearchSynthesisInstruction(
  task: Task,
  options: {
    includeFormattedDeliverable: boolean;
    exportCapability?: StructuredDeliverableCapability;
    preferEvidenceCollection?: boolean;
  },
): string {
  if (!options.preferEvidenceCollection) {
    return options.exportCapability
      ? '请基于搜索结果页面信息输出完整 Markdown 正文，供后续导出能力直接转换成目标文件。只保留最有价值的技巧、做法和注意事项，不要输出"PDF 需求已记录"之类占位说明，也不要编造额外事实。'
      : options.includeFormattedDeliverable
        ? '请基于搜索结果页面信息输出简洁、可直接交付的正文。只保留最有价值的技巧、做法和注意事项，控制篇幅；如果用户要求 PDF，请明确说明 PDF 导出需求已记录，并先给出完整正文内容。只能使用已提供的页面标题、URL、摘录和截图信息，不要编造额外事实。'
        : '请基于搜索结果页面信息输出简洁最终结论或报告。优先使用页面标题、URL、摘录和截图信息，只保留最关键内容，禁止编造未出现的事实。';
  }

  const normalized = collectTaskText(task).toLowerCase();
  const focusesSecurity = matchesAny(normalized, SECURITY_RESEARCH_PATTERNS);
  const needsRemediationPlan = matchesAny(normalized, REMEDIATION_INTENT_PATTERNS);

  const evidenceLead = focusesSecurity
    ? '请基于搜索结果页面信息，先整理可核验的安全问题、风险线索和外部证据。'
    : '请基于搜索结果页面信息，先整理可核验的外部事实和证据。';
  const solutionLead = needsRemediationPlan
    ? (focusesSecurity
      ? '在证据之后，给出针对性的安全整改、缓解和防护方案。'
      : '在证据之后，给出针对性的解决方案和后续建议。')
    : '在证据之后，再给出明确结论。';
  const evidenceBoundary = focusesSecurity
    ? '只能使用已提供的页面标题、URL、摘录和截图信息，不要编造漏洞细节、版本号、CVE 或厂商声明。'
    : '只能使用已提供的页面标题、URL、摘录和截图信息，不要编造额外事实。';

  if (options.exportCapability) {
    return `${evidenceLead} ${solutionLead} 输出完整 Markdown 正文，供后续导出能力直接转换成目标文件。不要输出"PDF 需求已记录"之类占位说明。${evidenceBoundary}`;
  }

  if (options.includeFormattedDeliverable) {
    return `${evidenceLead} ${solutionLead} 输出简洁、可直接交付的正文；如果用户要求 PDF，请明确说明 PDF 导出需求已记录，并先给出完整正文内容。${evidenceBoundary}`;
  }

  return `${evidenceLead} ${solutionLead} 输出简洁最终结论或报告。${evidenceBoundary}`;
}

// ---------------------------------------------------------------------------
// Search workflow builder
// ---------------------------------------------------------------------------

export function buildSearchWorkflowDsl(
  task: Task,
  options: {
    searchTarget: SearchTarget;
    includeScreenshot: boolean;
    includeNotification: boolean;
    includeSynthesis: boolean;
    includeFormattedDeliverable: boolean;
    exportCapability?: StructuredDeliverableCapability;
    promptCapabilityIds?: string[];
    preferEvidenceCollection?: boolean;
  },
): WorkflowDSL {
  const searchAnalyzePrompt = options.preferEvidenceCollection
    ? [
        '请先提炼本次外部搜索与取证任务的目标、关键词、核对重点、需要收集的证据，以及最终交付要求。',
        '输出一段供后续步骤直接消费的执行说明，不要写元话术。',
      ].join(' ')
    : [
        '请先提炼本次网页搜索任务的目标、关键词、核对重点和最终交付要求。',
        '输出一段供后续步骤直接消费的执行说明，不要写元话术。',
      ].join(' ');

  const steps: WorkflowDSL['steps'] = [
    {
      id: 'analyze',
      type: 'agent',
      input: {
        prompt: buildTaskPrompt(task, searchAnalyzePrompt),
        role: 'researcher',
      },
      policy: createStepPolicy(AGENT_STEP_TIMEOUT_MS),
    },
    {
      id: 'search',
      type: 'browser',
      dependsOn: ['analyze'],
      input: {
        action: 'navigate',
        url: options.searchTarget.url,
        createPage: true,
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    },
  ];

  let finalStepId = 'search';

  if (options.includeScreenshot) {
    steps.push({
      id: 'capture',
      type: 'browser',
      dependsOn: ['search'],
      when: {
        op: 'exists',
        ref: 'steps.search.output.pageId',
      },
      input: {
        action: 'screenshot',
        pageId: 'steps.search.output.pageId',
      },
      policy: createStepPolicy(BROWSER_STEP_TIMEOUT_MS),
    });
    finalStepId = 'capture';
  }

  if (options.includeSynthesis) {
    const finalInstruction = buildSearchSynthesisInstruction(task, options);

    steps.push({
      id: 'summarize',
      type: 'agent',
      dependsOn: [finalStepId],
      input: {
        prompt: buildTaskPrompt(task, finalInstruction),
        role: 'integration',
        outputMode: 'plain-text',
        context: {
          analysis: 'steps.analyze.output.summary',
          searchPlan: {
            engine: options.searchTarget.engineLabel,
            query: options.searchTarget.query,
            plannedUrl: options.searchTarget.url,
          },
          searchResult: {
            url: 'steps.search.output.url',
            title: 'steps.search.output.title',
            lines: 'steps.search.output.lines',
            ...(options.includeScreenshot
              ? { screenshotPath: 'steps.capture.output.screenshotPath' }
              : {}),
          },
        },
      },
      policy: createStepPolicy(REPORT_SYNTHESIS_TIMEOUT_MS, 2),
    });
    finalStepId = 'summarize';
  }

  if (finalStepId === 'summarize') {
    appendStructuredDeliverableSteps(task, steps, {
      baseStepId: 'summarize',
      baseOutputRef: 'steps.summarize.output.summary',
      includeNotification: options.includeNotification,
      exportCapability: options.exportCapability,
    });
  } else if (options.includeNotification) {
    steps.push({
      id: 'notify',
      type: 'notification',
      dependsOn: [finalStepId],
      input: {
        message: `搜索任务已完成：${task.summary}`,
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
