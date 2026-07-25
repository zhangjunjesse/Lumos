// 工作流 AI 助手系统提示词装配回归。
// 核心防回归点:团队名单必须拼进去——漏拼会让助手以为没有团队,把 team 节点整个关掉
// (提示词里「AVAILABLE TEAMS 为空时不要使用 team 节点」是硬规则)。

jest.mock('@/lib/db/sessions', () => ({ getSetting: jest.fn(() => '') }));

const agents: Array<Record<string, unknown>> = [];
jest.mock('@/lib/db/agent-presets', () => ({ listAgentPresets: () => agents }));

// 团队块自身的渲染由 team/__tests__/prompt-block.test.ts 覆盖;这里只验证它被拼进来。
jest.mock('@/lib/team/prompt-block', () => ({
  buildTeamListBlock: () => '## AVAILABLE TEAMS\n- id: "t-1"  name: "内容小组"  members: 2',
}));

import { buildWorkflowChatSystemPrompt } from '../workflow-session';

beforeEach(() => {
  agents.length = 0;
  agents.push({ id: 'a-1', name: '调研员', roleKind: 'worker', responsibility: '查资料' });
});

describe('buildWorkflowChatSystemPrompt', () => {
  it('把团队名单拼进系统提示词', () => {
    const prompt = buildWorkflowChatSystemPrompt();
    expect(prompt).toContain('## AVAILABLE TEAMS');
    expect(prompt).toContain('name: "内容小组"');
  });

  it('同时保留 Agent 名单,两者不互相顶掉', () => {
    const prompt = buildWorkflowChatSystemPrompt();
    expect(prompt).toContain('## 可用 Agent');
    expect(prompt).toContain('id: "a-1"');
    expect(prompt).toContain('## AVAILABLE TEAMS');
  });

  it('说明书讲清团队与部门的区别,并交代 list_workflow_teams', () => {
    const prompt = buildWorkflowChatSystemPrompt();
    expect(prompt).toContain('list_workflow_teams');
    expect(prompt).toContain('team 节点');
    // 防回归:不能再教「用户要团队 → 建部门」
    expect(prompt).toContain('不要用"建个部门 + 几个 agent"冒充团队协作');
  });

  it('带入当前 DSL 时附在末尾', () => {
    const prompt = buildWorkflowChatSystemPrompt('{"version":"v3"}');
    expect(prompt).toContain('## 当前工作流 DSL');
    expect(prompt.indexOf('## 当前工作流 DSL')).toBeGreaterThan(prompt.indexOf('## AVAILABLE TEAMS'));
  });

  it('没有 Agent 时给出去哪创建的提示,团队块照旧拼', () => {
    agents.length = 0;
    const prompt = buildWorkflowChatSystemPrompt();
    expect(prompt).toContain('Agent 管理');
    expect(prompt).toContain('## AVAILABLE TEAMS');
  });
});
