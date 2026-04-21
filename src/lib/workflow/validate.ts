import { validateDsl as validateV3, type UnifiedValidationReport } from './validate-dsl-v3';
import type { ValidationIssue } from './dsl-validator';

export type { ValidationIssue } from './dsl-validator';
export type ValidationSummary = {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
  issuesByNodeId: Record<string, ValidationIssue[]>;
  /** 工作流可以运行吗？= error 数为 0. */
  canRun: boolean;
};

// ── Public API ────────────────────────────────────────────────────────────

/**
 * 统一校验入口:委托到 V3 校验器。非 V3 输入返回空报告(上游在运行前会再挡一次)。
 * 编辑器和运行前闸门共用一套报告结构。
 */
export function validateWorkflowDsl(spec: unknown): ValidationSummary {
  if (!spec || typeof spec !== 'object') return empty();
  const shape = spec as { version?: string };
  if (shape.version !== 'v3') return empty();
  const report: UnifiedValidationReport = validateV3(spec);
  return summarize(report.issues);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function summarize(issues: ValidationIssue[]): ValidationSummary {
  const issuesByNodeId: Record<string, ValidationIssue[]> = {};
  let errorCount = 0;
  let warningCount = 0;
  for (const issue of issues) {
    if (issue.severity === 'error') errorCount++;
    else if (issue.severity === 'warning') warningCount++;
    const id = issue.nodeId ?? '';
    if (!id) continue;
    (issuesByNodeId[id] ??= []).push(issue);
  }
  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
    issuesByNodeId,
    canRun: errorCount === 0,
  };
}

function empty(): ValidationSummary {
  return { valid: true, errorCount: 0, warningCount: 0, issues: [], issuesByNodeId: {}, canRun: true };
}
