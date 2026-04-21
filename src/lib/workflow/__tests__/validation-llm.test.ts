import { formatIssuesForLlm } from '../validation-llm';
import type { ValidationIssue } from '../validate';

describe('formatIssuesForLlm', () => {
  it('returns empty string for no issues', () => {
    expect(formatIssuesForLlm([])).toBe('');
  });

  it('renders error + warning with code, path, message', () => {
    const issues: ValidationIssue[] = [
      {
        severity: 'error',
        code: 'INVALID_STEP_TYPE',
        nodeId: 's1',
        jsonPath: '$.steps[0].type',
        message: 'unknown step type',
        expected: ['agent', 'wait', 'if-else'],
        actual: 'think',
        hint: '用 agent',
      },
      {
        severity: 'warning',
        code: 'UNUSED_OUTPUT',
        nodeId: 's2',
        jsonPath: '$.steps[1].output',
        message: 'output never referenced',
      },
    ];
    const out = formatIssuesForLlm(issues);
    expect(out).toContain('## 校验错误');
    expect(out).toContain('### Error');
    expect(out).toContain('`INVALID_STEP_TYPE`');
    expect(out).toContain('节点 `s1`');
    expect(out).toContain('路径 `$.steps[0].type`');
    expect(out).toContain('unknown step type');
    expect(out).toContain('expected: "agent" | "wait" | "if-else"');
    expect(out).toContain('actual: "think"');
    expect(out).toContain('用 agent');
    expect(out).toContain('### Warning');
    expect(out).toContain('`UNUSED_OUTPUT`');
  });

  it('omits optional fields when absent', () => {
    const issues: ValidationIssue[] = [
      {
        severity: 'error',
        code: 'MISSING_FIELD',
        jsonPath: '$.name',
        message: 'name is required',
      },
    ];
    const out = formatIssuesForLlm(issues);
    expect(out).toContain('`MISSING_FIELD`');
    expect(out).toContain('name is required');
    expect(out).not.toContain('节点');
    expect(out).not.toContain('expected:');
    expect(out).not.toContain('actual:');
  });

  it('includes fix-requirement footer', () => {
    const out = formatIssuesForLlm([
      { severity: 'error', code: 'X', jsonPath: '$', message: 'm' },
    ]);
    expect(out).toContain('修复要求');
    expect(out).toContain('不要改变 DSL version');
    expect(out).toContain('返回完整的工作流 JSON');
  });

  it('skips Error section when only warnings exist', () => {
    const out = formatIssuesForLlm([
      { severity: 'warning', code: 'W1', jsonPath: '$', message: 'm' },
    ]);
    expect(out).not.toContain('### Error');
    expect(out).toContain('### Warning');
  });
});
