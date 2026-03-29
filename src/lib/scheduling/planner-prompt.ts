import type { Task } from '@/lib/task-management/types';
import type {
  PromptCapabilityPlanningContext,
  CodeCapabilityPlanningContext,
} from './planner-types';

const REPORT_SYNTHESIS_TIMEOUT_MS = 240_000;

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
): string {
  const payload = {
    taskId: task.id,
    summary: task.summary,
    requirements: task.requirements,
    relevantMessages: Array.isArray(task.metadata?.relevantMessages) ? task.metadata.relevantMessages : [],
    publishedPromptCapabilities: (capabilityContext?.available || []).map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      summary: capability.summary,
      usageExamples: capability.usageExamples,
    })),
    publishedCodeCapabilities: (codeCapabilityContext?.available || []).map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      summary: capability.summary,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      usageExamples: capability.usageExamples,
    })),
    plannerRules: {
      researchPlanning: [
        'If the task asks for research, security issues, remediation plans, or report/export output based on external facts and no source material is already provided, prefer browser-based search/evidence collection before synthesis.',
        'Prefer search/evidence -> summarize -> export over pure multi-agent report drafting for those tasks.',
      ],
      promptCapabilityUsage: [
        'If a published prompt capability matches the task, you may attach it to an agent step using input.tools.',
        'Only attach published prompt capability IDs from the list above.',
        'Do not invent capability IDs.',
        'Prefer adding capabilities to agent steps that execute or finalize the actual task.',
      ],
      codeCapabilityUsage: [
        'If a published code capability matches the task and the task contains enough structured input, you may use a capability step.',
        'Only use published code capability IDs from the list above.',
        'Capability step input must be a concrete object, not a natural-language paragraph.',
      ],
      workflowDslConstraints: [
        'Workflow DSL v1 only supports step types: agent, browser, notification, capability.',
        'Agent step input only supports: prompt, role, model, tools, outputMode, context.',
        'Browser step input only supports: action, url, selector, value, pageId, createPage.',
        'Browser action only supports: navigate, click, fill, screenshot.',
        'To express web search, build a concrete static search-engine URL first, then use browser.navigate with input.url.',
        'Do not use unsupported browser fields such as query or prompt.',
        'Researcher steps are read-only; do not instruct them to write files.',
        'Prefer passing generated markdown/text through steps.someStep.output.summary instead of asking an agent step to write a temp file.',
        'If a capability such as md-converter needs markdown content, pass the upstream markdown text via input.mdContent from a step output reference.',
        `If an agent step generates a long-form plain-text report or synthesis, omit timeoutMs or use at least ${REPORT_SYNTHESIS_TIMEOUT_MS}.`,
        'Notification step input only supports: message, level, channel, sessionId.',
        'Capability step input only supports: capabilityId and input.',
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
            type: 'agent | browser | notification | capability',
            dependsOn: ['string'],
            input: {
              prompt: 'string',
              role: 'optional worker | researcher | coder | integration',
              tools: ['optional published prompt capability ids'],
              context: 'optional object',
              capabilityId: 'required for capability step',
              input: 'required object for capability step',
            },
            policy: {
              timeoutMs: 10000,
              retry: {
                maximumAttempts: 2,
              },
            },
          },
        ],
      },
    },
    workflowExamples: {
      browserSearchSynthesis: {
        version: 'v1',
        name: 'task-example',
        steps: [
          {
            id: 'analyze',
            type: 'agent',
            input: {
              prompt: 'Analyze the research task and define evidence collection scope.',
              role: 'researcher',
            },
          },
          {
            id: 'search',
            type: 'browser',
            dependsOn: ['analyze'],
            input: {
              action: 'navigate',
              url: 'https://www.bing.com/search?q=openclaw%20security%20risk',
              createPage: true,
            },
          },
          {
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
          },
          {
            id: 'summarize',
            type: 'agent',
            dependsOn: ['capture'],
            input: {
              prompt: 'Summarize only from the provided search evidence.',
              role: 'integration',
              outputMode: 'plain-text',
              context: {
                searchResult: {
                  url: 'steps.search.output.url',
                  title: 'steps.search.output.title',
                  lines: 'steps.search.output.lines',
                  screenshotPath: 'steps.capture.output.screenshotPath',
                },
              },
            },
          },
        ],
      },
      reportExportWithCapability: {
        version: 'v1',
        name: 'task-report-export-example',
        steps: [
          {
            id: 'search',
            type: 'browser',
            input: {
              action: 'navigate',
              url: 'https://www.bing.com/search?q=openclaw%20security%20risk',
              createPage: true,
            },
          },
          {
            id: 'synthesize-report',
            type: 'agent',
            dependsOn: ['search'],
            policy: {
              timeoutMs: REPORT_SYNTHESIS_TIMEOUT_MS,
              retry: {
                maximumAttempts: 2,
              },
            },
            input: {
              prompt: 'Write the final Markdown report using only the provided evidence.',
              role: 'integration',
              outputMode: 'plain-text',
              context: {
                searchResult: {
                  url: 'steps.search.output.url',
                  title: 'steps.search.output.title',
                  lines: 'steps.search.output.lines',
                },
              },
            },
          },
          {
            id: 'export-pdf',
            type: 'capability',
            dependsOn: ['synthesize-report'],
            input: {
              capabilityId: 'md-converter',
              input: {
                mdContent: 'steps.synthesize-report.output.summary',
                targetFormat: 'pdf',
              },
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
            instruction: 'Correct the previous error and return a fresh full JSON response that strictly matches the supported DSL contracts. Do not reuse unsupported step fields or unsupported browser actions.',
          },
        }
      : {}),
  };

  return JSON.stringify(payload, null, 2);
}
