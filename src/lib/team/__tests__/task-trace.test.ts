// 团队执行痕迹收集回归。
// 病史:run.ts 的消息循环只认 `!msg.parent_tool_use_id` 的队长消息,带 parent_tool_use_id 的
// 成员消息被整个丢弃 —— 详情页里团队节点因此是黑箱(只剩队长最后那段交付文本)。

import { createTeamTraceCollector } from '../task-trace';

/** 队长派单消息:tool_use 里带 id 与 subagent_type。 */
function leaderDispatch(toolUseId: string, member: string) {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_use', name: 'Task', id: toolUseId, input: { subagent_type: member } }] },
  };
}

function memberMessage(parentId: string, text: string) {
  return {
    type: 'assistant',
    parent_tool_use_id: parentId,
    message: { content: [{ type: 'text', text }] },
  };
}

describe('createTeamTraceCollector', () => {
  it('成员消息按派单归组,不再被丢弃', () => {
    const c = createTeamTraceCollector();
    c.onMessage(leaderDispatch('tu-1', '写手'));
    c.onMessage(memberMessage('tu-1', '我在写稿'));
    c.onMessage(memberMessage('tu-1', '写完了'));
    const trace = c.build();

    expect(trace.leader).toHaveLength(1);
    expect(trace.members).toHaveLength(1);
    expect(trace.members[0].member).toBe('写手');
    expect(trace.members[0].events).toHaveLength(2);
  });

  it('多次派单分成多组,保持派单顺序', () => {
    const c = createTeamTraceCollector();
    c.onMessage(leaderDispatch('tu-1', '写手'));
    c.onMessage(memberMessage('tu-1', 'a'));
    c.onMessage(leaderDispatch('tu-2', '审稿'));
    c.onMessage(memberMessage('tu-2', 'b'));
    const trace = c.build();

    expect(trace.members.map(m => m.member)).toEqual(['写手', '审稿']);
  });

  it('派单工具叫 Agent 时也认(SDK 0.3.207 消息流里的真名)', () => {
    const c = createTeamTraceCollector();
    c.onMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', name: 'Agent', id: 'tu-9', input: { subagent_type: '归档员' } }] },
    });
    c.onMessage(memberMessage('tu-9', 'x'));
    expect(c.build().members[0].member).toBe('归档员');
  });

  it('成员消息先到、派单消息后到时也能补上成员名(不假设消息有序)', () => {
    const c = createTeamTraceCollector();
    c.onMessage(memberMessage('tu-1', '先到的成员消息'));
    c.onMessage(leaderDispatch('tu-1', '写手'));
    expect(c.build().members[0].member).toBe('写手');
  });

  it('成员的工具结果(user 消息)也收进该成员组', () => {
    const c = createTeamTraceCollector();
    c.onMessage(leaderDispatch('tu-1', '写手'));
    c.onMessage({ type: 'user', parent_tool_use_id: 'tu-1', message: { content: [{ type: 'tool_result' }] } });
    const trace = c.build();
    expect(trace.members[0].events[0].type).toBe('user');
    expect(trace.leader).toHaveLength(1);
  });

  it('result / system 等非会话消息不进 trace', () => {
    const c = createTeamTraceCollector();
    c.onMessage({ type: 'result', subtype: 'success' });
    c.onMessage({ type: 'system' });
    const trace = c.build();
    expect(trace.leader).toHaveLength(0);
    expect(trace.members).toHaveLength(0);
  });

  it('没有 subagent_type 时给个兜底名,不至于空白', () => {
    const c = createTeamTraceCollector();
    c.onMessage({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', name: 'Task', id: 'tu-1', input: {} }] },
    });
    c.onMessage(memberMessage('tu-1', 'x'));
    expect(c.build().members[0].member).toBe('成员');
  });
});
