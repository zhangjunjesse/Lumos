import type { WorkflowEdge } from './types-v3';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  nodeId?: string;
  edgeId?: string;
  jsonPath: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  hint?: string;
}

export interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
}

export type IssueEmit = (issue: ValidationIssue) => void;

/** 供多个 check 共用的边标识 (用于 edgeId 字段)。 */
export function edgeLabel(e: WorkflowEdge): string {
  return `${e.kind}:${e.from}->${e.to}`;
}
