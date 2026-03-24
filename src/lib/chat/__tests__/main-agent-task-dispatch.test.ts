import { planMainAgentTaskDispatch } from '../main-agent-task-dispatch';

describe('planMainAgentTaskDispatch', () => {
  test('returns a dispatch plan for multi-step research requests', () => {
    const result = planMainAgentTaskDispatch({
      sessionId: 'session-main-agent-001',
      userInput: '帮我做一个关于 AI 医疗发展的深度调研，重点关注落地案例，并给出对比结论。',
    });

    expect(result).not.toBeNull();
    expect(result?.taskSummary).toContain('AI 医疗发展');
    expect(result?.requirements.length).toBeGreaterThan(0);
  });

  test('returns a dispatch plan for implementation requests even when wording is short', () => {
    const result = planMainAgentTaskDispatch({
      sessionId: 'session-main-agent-002',
      userInput: '实现用户管理系统',
    });

    expect(result).not.toBeNull();
    expect(result?.taskSummary).toBe('实现用户管理系统');
  });

  test('splits chinese sentence punctuation into actionable task requirements', () => {
    const result = planMainAgentTaskDispatch({
      sessionId: 'session-main-agent-005',
      userInput: '给我一份 Claude 使用高级技巧的报告。要先网上搜索。整理成结果给我。最后导出 PDF。',
    });

    expect(result).not.toBeNull();
    expect(result?.requirements).toEqual([
      '要先网上搜索',
      '整理成结果给我',
      '最后导出 PDF',
    ]);
  });

  test('does not dispatch task status follow-up questions', () => {
    const result = planMainAgentTaskDispatch({
      sessionId: 'session-main-agent-003',
      userInput: '这个任务现在是什么状态？',
    });

    expect(result).toBeNull();
  });

  test('does not dispatch simple explanation questions', () => {
    const result = planMainAgentTaskDispatch({
      sessionId: 'session-main-agent-004',
      userInput: '解释一下什么是事件循环',
    });

    expect(result).toBeNull();
  });
});
