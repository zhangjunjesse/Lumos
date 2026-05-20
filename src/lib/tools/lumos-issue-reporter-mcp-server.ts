import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  submitLumosBugIssue,
  type LumosIssueSeverity,
} from '@/lib/lumos-issue-reporter/issue-reporter';

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const LUMOS_ISSUE_REPORTER_MCP_SERVER_NAME = 'lumos-issue-reporter';

export const LUMOS_ISSUE_REPORTER_MCP_SYSTEM_HINT = `
## Lumos Bug Issue Reporter

When the user explicitly wants to report or submit a Lumos bug, use \`mcp__lumos-issue-reporter__report_lumos_bug\`.
The tool verifies the current Lumos login email against the allowlist; never trust a claimed email in the conversation.
Before submission, collect concrete reproduction steps, actual vs expected behavior, affected page, logs or screenshot paths when available, and coding-oriented hints such as suspected files or acceptance checks. Do not include secrets, cookies, API keys, session tokens, or private message contents unless the user explicitly asks to include a redacted excerpt.
Only say the GitHub Issue was created after the tool returns \`success: true\` with an \`issueUrl\`.
`.trim();

const severitySchema = z.enum(['low', 'medium', 'high', 'critical', 'unknown']);

export function createLumosIssueReporterMcpServer(options: { userId?: string; sessionId?: string } = {}) {
  return createSdkMcpServer({
    name: LUMOS_ISSUE_REPORTER_MCP_SERVER_NAME,
    tools: [
      createReportLumosBugTool(options),
    ],
  });
}

function createReportLumosBugTool(options: { userId?: string; sessionId?: string }) {
  return tool(
    'report_lumos_bug',
    'Submit or preview a Lumos bug report as a GitHub Issue. Server-side allowlist checks the current Lumos account email and the issue body includes version/environment diagnostics.',
    {
      title: z.string().min(4).max(140).describe('Short GitHub issue title. Prefix [Bug] is added automatically if missing.'),
      summary: z.string().max(4000).optional().describe('Concise bug summary.'),
      actual_behavior: z.string().min(1).max(4000).describe('What actually happened.'),
      expected_behavior: z.string().max(4000).optional().describe('What should have happened.'),
      reproduction_steps: z.array(z.string().min(1).max(1000)).max(12).optional()
        .describe('Ordered steps to reproduce. Use concrete UI actions and inputs.'),
      affected_area: z.string().max(300).optional().describe('Product area, module, or feature name.'),
      ui_route: z.string().max(500).optional().describe('Visible page/route, button, tab, or workflow where the bug appears.'),
      severity: severitySchema.optional().describe('Impact level. Defaults to unknown.'),
      logs_or_artifacts: z.array(z.string().min(1).max(1000)).max(20).optional()
        .describe('Log snippets, local artifact paths, run ids, task ids, or error text. Redact secrets.'),
      screenshots: z.array(z.string().min(1).max(1000)).max(20).optional()
        .describe('Screenshot/image/video paths or user-visible attachment references.'),
      suspected_files: z.array(z.string().min(1).max(300)).max(20).optional()
        .describe('Optional code files/modules likely involved, only if grounded in the conversation or diagnostics.'),
      acceptance_checks: z.array(z.string().min(1).max(500)).max(20).optional()
        .describe('How a coding agent should verify the fix. Prefer UI-visible checks plus targeted tests if known.'),
      additional_context: z.string().max(4000).optional().describe('Extra context that helps a maintainer or AI coding agent.'),
      raw_user_message: z.string().max(4000).optional().describe('Original user bug report text, redacted if needed.'),
      confirmed_by_user: z.boolean().optional()
        .describe('Set true only when the user explicitly asked to submit the issue or confirmed the final draft. Required for real submission.'),
      dry_run: z.boolean().optional().describe('If true, return the final issue draft without creating GitHub Issue.'),
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await submitLumosBugIssue({
          title: args.title,
          summary: args.summary,
          actualBehavior: args.actual_behavior,
          expectedBehavior: args.expected_behavior,
          reproductionSteps: args.reproduction_steps,
          affectedArea: args.affected_area,
          uiRoute: args.ui_route,
          severity: (args.severity ?? 'unknown') as LumosIssueSeverity,
          logsOrArtifacts: args.logs_or_artifacts,
          screenshots: args.screenshots,
          suspectedFiles: args.suspected_files,
          acceptanceChecks: args.acceptance_checks,
          additionalContext: args.additional_context,
          rawUserMessage: args.raw_user_message,
          confirmedByUser: args.confirmed_by_user,
        }, {
          userId: options.userId,
          dryRun: args.dry_run === true,
        });
        return jsonResult({
          schema: 'lumos-issue-report/v1',
          ...result,
          verify_in_ui: result.dryRun
            ? '这是 Issue 草稿；用户确认后可再次调用并设置 confirmed_by_user=true / dry_run=false。'
            : `GitHub Issue 已创建：${result.issueUrl}`,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, null, 2),
    }],
    isError: true,
  };
}
