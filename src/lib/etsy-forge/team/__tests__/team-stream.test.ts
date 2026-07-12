// 团队流解析器单测:用合成的 SDK 消息喂进去,锁住「派单/出图发起/出图成败/终态」的事件产出,
// 以及 tool_use_id → 序号的对号能力。真实消息形状(subagent_type/tool_use/tool_result)一旦变,这里先红。

import { TeamStreamParser, firstImagePath, toolResultText, type TeamEvent } from '../team-stream';

const IMG = 'mcp__lumos-image__generate_image';

function collect(messages: unknown[]): TeamEvent[] {
  const events: TeamEvent[] = [];
  const parser = new TeamStreamParser(IMG, (e) => events.push(e));
  for (const m of messages) parser.consume(m);
  return events;
}

describe('TeamStreamParser', () => {
  it('队长派单 Task → dispatch 事件(取 subagent_type + description)', () => {
    const events = collect([
      { type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Task', input: { subagent_type: '设计师', description: '出一张露营徽章' } },
      ] } },
    ]);
    expect(events).toEqual([{ kind: 'dispatch', to: '设计师', task: '出一张露营徽章' }]);
  });

  it('成员发起出图 + 结果回来 → image_call/image_ok 对上同一序号', () => {
    const events = collect([
      { type: 'assistant', subagent_type: '设计师', message: { content: [
        { type: 'tool_use', name: IMG, id: 'tu_1', input: { prompt: 'a flat vector palm tree' } },
      ] } },
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: JSON.stringify({ images: [{ path: '/m/a.png' }] }) }] },
      ] } },
    ]);
    expect(events).toEqual([
      { kind: 'image_call', member: '设计师', seq: 1, prompt: 'a flat vector palm tree' },
      { kind: 'image_ok', seq: 1, path: '/m/a.png' },
    ]);
  });

  it('出图失败(结果非成功结构)→ image_fail 带真实错误文本', () => {
    const events = collect([
      { type: 'assistant', subagent_type: '设计师', message: { content: [
        { type: 'tool_use', name: IMG, id: 'tu_9', input: { prompt: 'x' } },
      ] } },
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_9', content: 'Stream closed unexpectedly' },
      ] } },
    ]);
    expect(events[1]).toEqual({ kind: 'image_fail', seq: 1, error: 'Stream closed unexpectedly' });
  });

  it('多张出图各自独立序号,结果不串号', () => {
    const events = collect([
      { type: 'assistant', subagent_type: 'A', message: { content: [{ type: 'tool_use', name: IMG, id: 't1', input: { prompt: 'p1' } }] } },
      { type: 'assistant', subagent_type: 'B', message: { content: [{ type: 'tool_use', name: IMG, id: 't2', input: { prompt: 'p2' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: JSON.stringify({ images: [{ path: '/b.png' }] }) }] }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: JSON.stringify({ images: [{ path: '/a.png' }] }) }] }] } },
    ]);
    expect(events.filter((e) => e.kind === 'image_ok')).toEqual([
      { kind: 'image_ok', seq: 2, path: '/b.png' }, // t2 先回,对应序号 2
      { kind: 'image_ok', seq: 1, path: '/a.png' },
    ]);
  });

  it('assistant 文本 → speak(队长无 subagent_type 归「队长」)', () => {
    const events = collect([
      { type: 'assistant', message: { content: [{ type: 'text', text: '  我先派策划定方向  ' }] } },
    ]);
    expect(events).toEqual([{ kind: 'speak', member: '队长', text: '我先派策划定方向' }]);
  });

  it('result → done 携带 subtype/轮数/错误;structured 被捕获', () => {
    const events: TeamEvent[] = [];
    const parser = new TeamStreamParser(IMG, (e) => events.push(e));
    parser.consume({ type: 'result', subtype: 'error_max_turns', num_turns: 40, errors: ['maxturns'], structured_output: { designs: [] } });
    expect(events).toEqual([{ kind: 'done', subtype: 'error_max_turns', turns: 40, errors: ['maxturns'] }]);
    expect(parser.structured).toEqual({ designs: [] });
  });

  it('非出图的 tool_result 不产事件(只认自己发起过的 id)', () => {
    const events = collect([
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'unknown', content: 'whatever' }] } },
    ]);
    expect(events).toEqual([]);
  });
});

describe('firstImagePath / toolResultText', () => {
  it('从成功 JSON 取第一张路径;字符串/数组两种 content 都能取文本', () => {
    expect(firstImagePath([{ type: 'text', text: JSON.stringify({ images: [{ path: '/x.png' }, { path: '/y.png' }] }) }])).toBe('/x.png');
    expect(firstImagePath('not json')).toBe('');
    expect(toolResultText('plain error')).toBe('plain error');
    expect(toolResultText([{ type: 'text', text: 'block error' }])).toBe('block error');
  });
});
