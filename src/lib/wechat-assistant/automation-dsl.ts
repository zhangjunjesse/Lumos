/**
 * 由 Automation 构建可执行的调度 workflow DSL（dsl-build 层）。
 *
 * 总结类 → 「总结 agent → 通知」DSL，params 全由生效 SummarySpec 派生
 * （单一真源，automation-summary-spec）；非总结 → 单 notification 提醒。
 *
 * 从 automations.ts 拆出（CLAUDE.md 单文件 ≤300 行；dsl-build 自成一层）。
 */
import type { Automation } from '@/components/apps/builtin/wechat/relations-types';
import type { WorkflowDSLV3 } from '@/lib/workflow/types-v3';

import { effectiveSummarySpec, isWeChatSummaryAutomation } from './automation-summary-spec';

export function buildAutomationWorkflowDsl(automation: Automation): WorkflowDSLV3 {
  if (isWeChatSummaryAutomation(automation)) {
    return buildSummaryWorkflowDsl(automation);
  }

  return {
    version: 'v3',
    name: `微信助手自动化 · ${automation.name}`,
    description: '由微信助手自动化规则创建的提醒工作流。',
    nodes: [{
      id: 'notify',
      type: 'notification',
      input: {
        channel: 'im:wechat',
        level: 'info',
        targetSessionRef: 'main-agent',
        message: buildNotificationMessage(automation),
      },
      policy: { timeoutMs: 30_000 },
    }],
    edges: [],
    maxDurationMs: 60_000,
  };
}

function buildSummaryWorkflowDsl(automation: Automation): WorkflowDSLV3 {
  return {
    version: 'v3',
    name: `微信助手自动化 · ${automation.name}`,
    description: '由微信助手自动化规则创建的微信消息总结工作流。',
    nodes: [
      {
        id: 'generate_report',
        type: 'agent',
        input: {
          prompt: '读取本机微信同步镜像，生成微信消息总结报告。',
          outputMode: 'plain-text',
          code: {
            handler: 'wechat-assistant.daily-summary',
            strategy: 'code-only',
            params: buildSummaryParams(automation),
          },
        },
        outputContract: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            notification: {
              type: 'string',
              description: '与报告正文同源的通知内容；每日总结成功时应直接使用完整 reportMarkdown。',
            },
            reportPath: { type: 'string' },
            reportMarkdown: { type: 'string' },
          },
        },
        policy: { timeoutMs: 180_000 },
      },
      {
        id: 'notify',
        type: 'notification',
        input: {
          channel: 'im:wechat',
          level: 'info',
          targetSessionRef: 'main-agent',
          message: '{{ steps.generate_report.output.notification }}',
        },
        policy: { timeoutMs: 30_000 },
      },
    ],
    edges: [{ from: 'generate_report', to: 'notify', kind: 'next' }],
    maxDurationMs: 240_000,
  };
}

/** 总结 handler 的入参，全部由生效 spec 派生（单一真源）。 */
function buildSummaryParams(automation: Automation): Record<string, unknown> {
  const spec = effectiveSummarySpec(automation);
  return {
    automationId: automation.id,
    automationName: automation.name,
    messageTemplate: spec?.extraInstruction ?? automation.action.messageTemplate,
    ...(spec?.scope.kind === 'group_tag' ? { groupTagId: spec.scope.tagId } : {}),
    ...(spec?.emptyMessage ? { emptyMessage: spec.emptyMessage } : {}),
  };
}

function buildNotificationMessage(automation: Automation): string {
  const template = automation.action.messageTemplate.trim();
  return [
    `微信助手提醒：${automation.name}`,
    template,
    automation.followupId ? `关联跟进：${automation.followupId}` : '',
  ].filter(Boolean).join('\n\n');
}
