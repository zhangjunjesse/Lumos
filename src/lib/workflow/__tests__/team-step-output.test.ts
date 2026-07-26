// team 步骤执行记录 markdown 回归。
//
// 这份 markdown 必须守住两个前端约定,否则详情页什么都点不亮:
//   1. 首行隐藏头 <!-- step:roleName:stepId:outcome -->(UI 据此认领步骤卡)
//   2. 第一个独立的 `---` 之后是 trace 段(RunOutputRenderer 据此切分并折叠)

import { formatTeamStepOutputMarkdown } from '../team-step-output';
import { parseStepHeader } from '../step-output-formatter';
import type { TeamTaskTrace } from '@/lib/team/task-trace';

const emptyTrace: TeamTaskTrace = { leader: [], members: [] };

function assistantWithTool(name: string, input: unknown) {
  return {
    type: 'assistant' as const,
    raw: { message: { content: [{ type: 'tool_use', name, input }] } },
  };
}

function toolResult(text: string) {
  return {
    type: 'user' as const,
    raw: { message: { content: [{ type: 'tool_result', content: text }] } },
  };
}

const base = {
  stepId: 'print-team',
  teamName: '内容小组',
  text: '台账已归档',
  dispatches: 2,
  dispatchedTo: ['写手', '审稿'],
  trace: emptyTrace,
  outcome: 'done' as const,
};

describe('formatTeamStepOutputMarkdown', () => {
  it('首行隐藏头能被 agent 那套解析器读出来(前端靠它认领步骤)', () => {
    const md = formatTeamStepOutputMarkdown(base);
    const parsed = parseStepHeader(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.roleName).toBe('内容小组');
    expect(parsed!.stepId).toBe('print-team');
    expect(parsed!.outcome).toBe('done');
  });

  it('派单脉络出现在摘要里', () => {
    const md = formatTeamStepOutputMarkdown(base);
    expect(md).toContain('派单 2 次');
    expect(md).toContain('写手、审稿');
    expect(md).toContain('台账已归档');
  });

  it('队长没派单时明确说出来(而不是留白让人猜)', () => {
    const md = formatTeamStepOutputMarkdown({ ...base, dispatches: 0, dispatchedTo: [] });
    expect(md).toContain('队长没有派单');
  });

  it('trace 段以 --- 开头,前端才能切出可折叠部分', () => {
    const md = formatTeamStepOutputMarkdown({
      ...base,
      trace: { leader: [assistantWithTool('Task', { subagent_type: '写手' })], members: [] },
    });
    const idx = md.indexOf('\n---\n');
    expect(idx).toBeGreaterThan(0);
    expect(md.slice(idx)).toContain('队长执行过程');
  });

  it('成员明细带成员名小标题,内容用 agent 同一套渲染', () => {
    const md = formatTeamStepOutputMarkdown({
      ...base,
      trace: {
        leader: [assistantWithTool('Task', { subagent_type: '写手' })],
        members: [{ toolUseId: 'tu-1', member: '写手', events: [assistantWithTool('Bash', { command: 'python x.py' }), toolResult('ok')] }],
      },
    });
    expect(md).toContain('##### 成员「写手」');
    expect(md).toContain('🔧 调用');
    expect(md).toContain('python x.py');
    expect(md).toContain('📤 结果');
  });

  it('嵌套 trace 不会引入第二条 --- 把前端切分弄乱', () => {
    const md = formatTeamStepOutputMarkdown({
      ...base,
      trace: {
        leader: [assistantWithTool('Task', {})],
        members: [{ toolUseId: 'tu-1', member: '写手', events: [assistantWithTool('Read', {})] }],
      },
    });
    // 只允许一条分隔线(summary / trace 的那条)
    expect(md.split(/^---$/m).length - 1).toBe(1);
  });

  it('成员过多时截断并说明,不静默丢弃', () => {
    const members = Array.from({ length: 15 }, (_, i) => ({
      toolUseId: `tu-${i}`, member: `成员${i}`, events: [assistantWithTool('Read', { i })],
    }));
    const md = formatTeamStepOutputMarkdown({ ...base, trace: { leader: [], members } });
    expect(md).toContain('还有 3 位成员的执行明细未展开');
  });

  it('失败时写进错误原因,outcome=failed', () => {
    const md = formatTeamStepOutputMarkdown({
      ...base, text: '', outcome: 'failed', error: '团队任务超时且无任何产出',
    });
    expect(parseStepHeader(md)!.outcome).toBe('failed');
    expect(md).toContain('团队任务超时且无任何产出');
  });

  it('耗时写进页脚', () => {
    const md = formatTeamStepOutputMarkdown({ ...base, durationMs: 95_000 });
    expect(md).toContain('耗时 1m35s');
  });

  it('团队名带冒号时不破坏隐藏头的字段分隔', () => {
    const md = formatTeamStepOutputMarkdown({ ...base, teamName: 'A:B 组' });
    expect(parseStepHeader(md)!.roleName).toBe('A:B 组');
  });
});
