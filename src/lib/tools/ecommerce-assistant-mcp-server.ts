import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  getEcommerceStore,
  listInputs,
  listJobs,
  type ImageJobRow,
  type ProductInputRow,
} from '@/lib/ecommerce-assistant/storage';
import {
  cancelJob as cancelImageJob,
  retryJob as retryImageJob,
  startJob as startImageJob,
} from '@/lib/ecommerce-assistant/job-runner';
import {
  listResearchReports,
  getResearchReport,
  getResearchStore,
  readReportMarkdown,
  type ResearchReportRow,
} from '@/lib/ecommerce-assistant/research-storage';
import { startReport, cancelReport } from '@/lib/ecommerce-assistant/research-runner';
import type { ImageJobRecord, ResearchReportRecord, ResearchReportStatus } from '@/lib/ecommerce-assistant/types';

export {
  ECOMMERCE_ASSISTANT_MCP_SERVER_NAME,
  ECOMMERCE_ASSISTANT_MCP_SYSTEM_HINT,
} from './ecommerce-assistant-mcp-hint';
import { ECOMMERCE_ASSISTANT_MCP_SERVER_NAME } from './ecommerce-assistant-mcp-hint';

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export function createEcommerceAssistantMcpServer() {
  return createSdkMcpServer({
    name: ECOMMERCE_ASSISTANT_MCP_SERVER_NAME,
    tools: [
      createGetEcommerceStatusTool(),
      createListProductInputsTool(),
      createResolveProductInputTool(),
      createListImageJobsTool(),
      createStartImageJobTool(),
      createCancelImageJobTool(),
      createRetryImageJobTool(),
      createStartResearchReportTool(),
      createListResearchReportsTool(),
      createGetResearchReportTool(),
      createCancelResearchReportTool(),
    ],
  });
}

function createGetEcommerceStatusTool() {
  return tool(
    'get_ecommerce_status',
    'Read counts of ready product inputs and image jobs by status, plus a summary of the most recent job.',
    {},
    async (): Promise<CallToolResult> => {
      try {
        const store = getEcommerceStore();
        const inputs = listInputs(store, { status: 'ready' });
        const jobs = listJobs(store);
        const byStatus = jobs.reduce<Record<string, number>>((acc, job) => {
          acc[job.status] = (acc[job.status] ?? 0) + 1;
          return acc;
        }, {});
        const latest = jobs[0];
        return jsonResult({
          schema: 'ecommerce-assistant-status/v1',
          inputs: {
            ready_count: inputs.length,
          },
          jobs: {
            total: jobs.length,
            by_status: byStatus,
            latest: latest ? summarizeJob(latest) : null,
          },
          verify_in_ui: '电商助手 > 工坊 / 任务',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createListProductInputsTool() {
  return tool(
    'list_product_inputs',
    'List product inputs visible in 工坊. Defaults to status=ready and limit=10.',
    {
      status: z.enum(['ready', 'archived']).optional()
        .describe('Filter by visible status. Default ready.'),
      limit: z.number().int().min(1).max(50).optional()
        .describe('Max rows to return. Default 10.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const store = getEcommerceStore();
        const inputs = listInputs(store, { status: args.status ?? 'ready' });
        const limit = args.limit ?? 10;
        return jsonResult({
          schema: 'ecommerce-assistant-inputs/v1',
          count: Math.min(inputs.length, limit),
          total: inputs.length,
          inputs: inputs.slice(0, limit).map(summarizeInput),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createResolveProductInputTool() {
  return tool(
    'resolve_product_input',
    'Resolve a user-visible product title or note to candidate input ids. Always call before any tool that takes an input_id when the user named the input by title.',
    {
      query: z.string().min(1).describe('Visible title, category hint, or phrase mentioned by the user.'),
      limit: z.number().int().min(1).max(10).optional()
        .describe('Max candidates. Default 5.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const store = getEcommerceStore();
        const needle = args.query.trim().toLowerCase();
        if (!needle) return jsonResult({ candidates: [] });
        const inputs = listInputs(store);
        const scored = inputs
          .map((input) => ({ input, score: scoreInputMatch(input, needle) }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, args.limit ?? 5)
          .map((row) => summarizeInput(row.input));
        return jsonResult({
          schema: 'ecommerce-assistant-resolve-input/v1',
          query: args.query,
          count: scored.length,
          candidates: scored,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createListImageJobsTool() {
  return tool(
    'list_image_jobs',
    'List recent image generation jobs from the 任务 tab. Optionally filter by status.',
    {
      status: z.enum([
        'queued', 'preprocessing', 'identifying', 'cutting', 'planning',
        'generating', 'scoring', 'refining', 'qc', 'completed', 'failed', 'cancelled',
      ]).optional().describe('Optional status filter.'),
      limit: z.number().int().min(1).max(50).optional().describe('Max rows. Default 10.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const store = getEcommerceStore();
        const filter = args.status ? { status: args.status } : undefined;
        const jobs = listJobs(store, filter);
        const limit = args.limit ?? 10;
        return jsonResult({
          schema: 'ecommerce-assistant-jobs/v1',
          count: Math.min(jobs.length, limit),
          total: jobs.length,
          jobs: jobs.slice(0, limit).map(summarizeJob),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createStartImageJobTool() {
  return tool(
    'start_image_job',
    'Queue a full SOP image-generation run for an existing product input. Consumes image quota.',
    {
      input_id: z.string().min(1).describe('Product input id (from list_product_inputs or resolve_product_input).'),
      preset_id: z.string().min(1).optional().describe('Optional style preset id.'),
      aspect_ratio: z.string().min(1).optional().describe('Optional aspect ratio override, e.g. 1:1, 3:4.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const job = await startImageJob({
          inputId: args.input_id,
          presetId: args.preset_id,
          aspectRatio: args.aspect_ratio,
        });
        return jsonResult({
          schema: 'ecommerce-assistant-job-started/v1',
          success: true,
          job: summarizeJob(job),
          verify_in_ui: '电商助手 > 任务',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createCancelImageJobTool() {
  return tool(
    'cancel_image_job',
    'Request cancellation of a running image job. Returns success=false if the job is not currently running.',
    {
      job_id: z.string().min(1).describe('Image job id.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const ok = cancelImageJob(args.job_id);
        return jsonResult({
          schema: 'ecommerce-assistant-job-cancel/v1',
          success: ok,
          job_id: args.job_id,
          note: ok
            ? '已发送取消信号，任务会在当前 SOP 步骤的中断点退出。'
            : '该任务当前未在运行（可能已完成、失败、取消，或服务进程刚重启）。',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createRetryImageJobTool() {
  return tool(
    'retry_image_job',
    'Retry a finished/failed image job by queueing a new job with the same input, preset, and aspect ratio.',
    {
      job_id: z.string().min(1).describe('Image job id to retry.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const job = await retryImageJob(args.job_id);
        return jsonResult({
          schema: 'ecommerce-assistant-job-retry/v1',
          success: true,
          new_job: summarizeJob(job),
          retried_from: args.job_id,
          verify_in_ui: '电商助手 > 任务',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function summarizeInput(input: ProductInputRow) {
  return {
    id: input.id,
    title: input.title,
    category_hint: input.category_hint ?? null,
    status: input.status,
    has_main_image: Boolean(input.main_image_path),
    updated_at: input.updated_at ?? null,
  };
}

function summarizeJob(job: ImageJobRow | ImageJobRecord) {
  return {
    id: (job as ImageJobRow).id ?? null,
    input_id: job.input_id,
    status: job.status,
    stage: job.stage ?? null,
    preset_id: job.preset_id ?? null,
    aspect_ratio: job.aspect_ratio ?? null,
    failure_reason: job.failure_reason ?? null,
    updated_at: (job as ImageJobRow).updated_at ?? null,
  };
}

function scoreInputMatch(input: ProductInputRow, needle: string): number {
  const title = String(input.title || '').toLowerCase();
  const hint = String(input.category_hint || '').toLowerCase();
  const note = String(input.note || '').toLowerCase();
  if (title === needle) return 100;
  let score = 0;
  if (title.includes(needle)) score += 60;
  if (hint.includes(needle)) score += 25;
  if (note.includes(needle)) score += 10;
  return score;
}

function createStartResearchReportTool() {
  return tool(
    'start_research_report',
    'Start a research report job. Runs data sources in parallel; report markdown is persisted to disk and listed in the 调研 tab. Multiple reports can run concurrently.',
    {
      platform: z.string().min(1).describe('Target platform key (etsy/amazon/taobao/goofish/douyin/general).'),
      query: z.string().min(1).describe('User-facing research question / instruction.'),
      instruction: z.string().optional().describe('Optional extra constraints or hints.'),
      sources: z.array(z.string()).optional().describe('Override data sources to use (default: web + deepsearch).'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const report = await startReport({
          platform: args.platform,
          query: args.query,
          instruction: args.instruction ?? null,
          sources: args.sources,
        });
        return jsonResult({
          schema: 'ecommerce-assistant-research-started/v1',
          success: true,
          report: summarizeReport(report),
          verify_in_ui: '电商助手 > 调研',
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createListResearchReportsTool() {
  return tool(
    'list_research_reports',
    'List recent research reports from the 调研 tab. Filter by status or platform if needed.',
    {
      status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
      platform: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(50).optional().describe('Default 10.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const reports = listResearchReports(getResearchStore(), {
          status: args.status as ResearchReportStatus | undefined,
          platform: args.platform,
        });
        const limit = args.limit ?? 10;
        return jsonResult({
          schema: 'ecommerce-assistant-research-list/v1',
          count: Math.min(reports.length, limit),
          total: reports.length,
          reports: reports.slice(0, limit).map(summarizeReport),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createGetResearchReportTool() {
  return tool(
    'get_research_report',
    'Fetch a single research report including the rendered markdown body.',
    {
      report_id: z.string().min(1).describe('Research report id.'),
      include_body: z.boolean().optional().describe('Include the full markdown body (default true).'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const store = getResearchStore();
        const report = getResearchReport(store, args.report_id);
        if (!report) {
          return errorResult(new Error(`报告 ${args.report_id} 不存在`));
        }
        const includeBody = args.include_body !== false;
        const markdown = includeBody ? readReportMarkdown(args.report_id) : null;
        return jsonResult({
          schema: 'ecommerce-assistant-research-get/v1',
          report: summarizeReport(report),
          markdown,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function createCancelResearchReportTool() {
  return tool(
    'cancel_research_report',
    'Cancel a running research report. Returns success=false if the report is not currently running.',
    {
      report_id: z.string().min(1),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const ok = cancelReport(args.report_id);
        return jsonResult({
          schema: 'ecommerce-assistant-research-cancel/v1',
          success: ok,
          report_id: args.report_id,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function summarizeReport(report: ResearchReportRow | ResearchReportRecord) {
  const sources = typeof report.sources === 'string' ? safeJsonParse(report.sources) : report.sources;
  return {
    id: (report as ResearchReportRow).id ?? null,
    platform: report.platform,
    query: report.query,
    status: report.status,
    stage: report.stage ?? null,
    progress: report.progress ?? null,
    sources,
    summary: report.summary ?? null,
    word_count: report.word_count ?? null,
    report_path: report.report_path ?? null,
    error: report.error ?? null,
    updated_at: (report as ResearchReportRow).updated_at ?? null,
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}
