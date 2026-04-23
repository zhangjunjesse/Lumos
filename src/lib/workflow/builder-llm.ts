import type { ChatMessage } from '@/lib/text-generator';
import { validateDsl, type UnifiedValidationReport } from './validate-dsl-v3';

const AUTO_REPAIR_WARNING_CODES = new Set([
  'W_CONTEXT_SUMMARY_REF',
  'W_NON_STRUCTURED_FIELD_REF',
  'W_CODE_ABSOLUTE_PATH_LITERAL',
  'W_CODE_RELATIVE_PATH_CHECK',
]);

export function parseWorkflowDslFromText(raw: string): { dsl?: unknown; error?: string } {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { error: 'LLM 未返回有效 JSON，请重试或手动编辑 DSL' };
  }

  try {
    return { dsl: JSON.parse(jsonMatch[0]) };
  } catch {
    return { error: 'LLM 返回的 JSON 无法解析，请重试' };
  }
}

export function validateWorkflowBuilderDsl(dsl: unknown): UnifiedValidationReport {
  return validateDsl(dsl);
}

export function summarizeValidation(report: UnifiedValidationReport): { valid: boolean; errors: string[] } {
  return {
    valid: report.valid,
    errors: report.issues
      .filter((issue) => issue.severity === 'error')
      .map((issue) => `${issue.jsonPath || 'spec'}: ${issue.message}`),
  };
}

export function shouldAutoRepair(report: UnifiedValidationReport): boolean {
  return report.issues.some((issue) => (
    issue.severity === 'error' || AUTO_REPAIR_WARNING_CODES.has(issue.code)
  ));
}

export function buildRepairTurn(
  originalRequest: string,
  currentDsl: unknown,
  issuesMarkdown: string,
): ChatMessage[] {
  return [
    { role: 'user', content: originalRequest },
    { role: 'assistant', content: JSON.stringify(currentDsl, null, 2) },
    {
      role: 'user',
      content: [
        '上面那份 DSL 还不够稳定。请根据下面的正式校验结果修复它，并返回完整的 Workflow DSL v3 JSON。',
        issuesMarkdown,
        '修复重点：优先解决 error，其次消除会导致工作流脆弱的 warning。不要输出解释，只返回完整 JSON。',
      ].join('\n\n'),
    },
  ];
}

export function hasInsufficientAgentsSignal(dsl: unknown): dsl is { insufficient_agents: boolean; suggestion?: string } {
  return Boolean(dsl && typeof dsl === 'object' && 'insufficient_agents' in dsl);
}
