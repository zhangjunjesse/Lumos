import type { ValidationIssue } from './validate';

/**
 * 将 ValidationIssue 序列化成 LLM 可读的修复说明 (Markdown)。
 * 每条包含:code / nodeId / jsonPath / expected / actual / hint,供 refine 接口
 * 丢给 LLM 让它定位并修复 DSL。
 */
export function formatIssuesForLlm(issues: ValidationIssue[]): string {
  if (issues.length === 0) return '';
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const lines: string[] = [];
  lines.push('## 校验错误 (请修复以下错误,不要引入新问题)');
  if (errors.length > 0) {
    lines.push('', '### Error');
    for (const i of errors) lines.push(formatIssueLine(i));
  }
  if (warnings.length > 0) {
    lines.push('', '### Warning');
    for (const i of warnings) lines.push(formatIssueLine(i));
  }
  lines.push('', '修复要求:');
  lines.push('1. 只动必要的字段,保持其余步骤不变');
  lines.push('2. 不要改变 DSL version');
  lines.push('3. 如果 expected 列出了合法值,从中挑一个');
  lines.push('4. 返回完整的工作流 JSON,而不是 patch');
  return lines.join('\n');
}

function formatIssueLine(i: ValidationIssue): string {
  const parts: string[] = [`- \`${i.code}\``];
  if (i.nodeId) parts.push(`节点 \`${i.nodeId}\``);
  if (i.jsonPath) parts.push(`路径 \`${i.jsonPath}\``);
  parts.push(`: ${i.message}`);
  if (i.expected !== undefined) parts.push(`(expected: ${formatValue(i.expected)})`);
  if (i.actual !== undefined) parts.push(`(actual: ${formatValue(i.actual)})`);
  if (i.hint) parts.push(`— ${i.hint}`);
  return parts.join(' ');
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => JSON.stringify(x)).join(' | ');
  return JSON.stringify(v);
}
