/**
 * In-process SDK tool: run a single agent step in the workflow editor chat.
 *
 * Calls the real executeWorkflowAgentStep pipeline (preset → StageWorker → Claude SDK)
 * so the editor assistant can test a full agent step including LLM reasoning, MCP tools,
 * system prompt, and knowledge base — not just code snippets.
 */
import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { executeWorkflowAgentStep } from '@/lib/workflow/subagent';
import type { AgentStepInput, WorkflowStepRuntimeContext } from '@/lib/workflow/types';

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

const MAX_EXECUTION_MS = 10 * 60 * 1000; // 10 min, same as default agent step timeout
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min for test runs

const inputSchema = {
  preset: z.string().min(1).describe(
    'Agent preset id（从 list_workflow_agents 获取）。决定 systemPrompt、角色、MCP 工具等。',
  ),
  prompt: z.string().min(1).describe(
    '本步骤的任务描述（即 agent 步骤的 prompt 字段）。',
  ),
  context: z.record(z.string(), z.unknown()).optional().describe(
    '模拟的上游步骤输出，作为 input.context 传入。键是变量名，值是模拟数据。'
    + '例如 { "report": "上游步骤的摘要输出..." }。',
  ),
  model: z.string().optional().describe(
    '指定模型（如 "claude-sonnet-4-20250514"）。不传则使用 preset 或系统默认。',
  ),
  outputMode: z.enum(['structured', 'plain-text']).optional().describe(
    '输出模式。默认由 preset 决定。',
  ),
  knowledge: z.object({
    enabled: z.literal(true),
    defaultTagNames: z.array(z.string()).default([]),
    allowAgentTagSelection: z.boolean().default(true),
    topK: z.number().int().min(1).max(10).optional(),
  }).strict().optional().describe(
    '知识库访问配置。不传则不启用。',
  ),
  timeoutMs: z.number().int().min(10_000).max(MAX_EXECUTION_MS).optional().describe(
    `执行超时（毫秒），默认 ${DEFAULT_TIMEOUT_MS / 1000}s，最长 ${MAX_EXECUTION_MS / 1000}s。`,
  ),
  stepId: z.string().optional().describe(
    '自定义步骤 ID（调试标识）。不传则自动生成。',
  ),
};

export function createWorkflowAgentStepRunTool() {
  return tool(
    'run_workflow_agent_step',
    '运行一个完整的 Agent 步骤（走真实 Claude SDK + preset 的 systemPrompt + MCP 工具 + 知识库）。'
    + '与 run_workflow_code 不同：这是完整的 LLM Agent 执行，不是纯代码。'
    + '用于在编辑工作流时测试某个 agent 步骤是否能正确完成任务。'
    + '执行时间较长（通常 30s~5min），请耐心等待。',
    inputSchema,
    async (args): Promise<CallToolResult> => {
      const timeoutMs = Math.min(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_EXECUTION_MS);
      const stepId = args.stepId?.trim() || `debug-${randomUUID().slice(0, 8)}`;
      const workflowRunId = `debug-run-${randomUUID().slice(0, 8)}`;

      const runtime: WorkflowStepRuntimeContext = {
        workflowRunId,
        stepId,
        stepType: 'agent',
        timeoutMs,
      };

      const stepInput: AgentStepInput = {
        prompt: args.prompt,
        preset: args.preset,
        ...(args.context ? { context: args.context } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.outputMode ? { outputMode: args.outputMode } : {}),
        ...(args.knowledge ? { knowledge: args.knowledge } : {}),
        __runtime: runtime,
      };

      // Workspace dir created by executeWorkflowAgentStep — clean up after debug run
      const baseDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
      const debugWorkspaceDir = path.join(baseDir, 'workflow-agent-runs', workflowRunId);

      const startMs = Date.now();

      try {
        const result = await executeWorkflowAgentStep(stepInput);
        const durationMs = Date.now() - startMs;

        const output = result.output as Record<string, unknown> | null;
        const body = {
          success: result.success,
          summary: output?.summary ?? null,
          outcome: output?.outcome ?? null,
          error: result.error ?? null,
          durationMs,
          stepId,
          workflowRunId,
          executedVia: (result.metadata as Record<string, unknown>)?.executedVia ?? 'agent',
          ...(output?.artifacts ? { artifacts: output.artifacts } : {}),
        };

        return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
      } catch (error) {
        const durationMs = Date.now() - startMs;
        const message = error instanceof Error ? error.message : String(error);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: message,
              durationMs,
              stepId,
              workflowRunId,
            }, null, 2),
          }],
          isError: true,
        };
      } finally {
        rm(debugWorkspaceDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );
}
