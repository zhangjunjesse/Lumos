// 交差组装的行为回归:真实路径校验(防幻觉)+ 兜底回收(超时/未交差不再「有图也全损」)。

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
  tool: jest.fn(() => ({})),
  createSdkMcpServer: jest.fn(() => ({})),
}));
jest.mock('@/lib/claude/sdk-runtime', () => ({ buildClaudeSdkInvocationContext: jest.fn() }));
jest.mock('@/lib/claude/provider-env', () => ({ isClaudeLocalAuthProvider: jest.fn(() => false) }));
jest.mock('@/lib/claude/local-auth', () => ({ ensureClaudeLocalAuthReady: jest.fn() }));
jest.mock('@/lib/tools/lumos-mcp-server', () => ({ LUMOS_MCP_SERVER_NAME: 'lumos-image' }));

import { assembleResult } from '../team-session';
import type { AgentTeamRow } from '../../types';

const team = { name: '测试队' } as AgentTeamRow;

function base(over: Partial<Parameters<typeof assembleResult>[0]> = {}) {
  return {
    team,
    structured: undefined as unknown,
    producedPaths: new Set<string>(),
    imageCallsUsed: 0,
    timedOut: false,
    callMemberBySeq: new Map<number, string>(),
    okPathBySeq: new Map<number, string>(),
    ...over,
  };
}

describe('assembleResult', () => {
  it('正常交差:申报路径经真实产出集合校验,幻觉路径被丢弃', () => {
    const r = assembleResult(base({
      structured: {
        designs: [
          { path: '/real.png', member: '出图师', rationale: 'ok' },
          { path: '/fake.png', member: '出图师', rationale: '编的' },
        ],
        summary: 'done',
      },
      producedPaths: new Set(['/real.png']),
      imageCallsUsed: 2,
    }));
    expect(r.designs.map((d) => d.path)).toEqual(['/real.png']);
    expect(r.summary).toBe('done');
    expect(r.imageCallsUsed).toBe(2);
  });

  it('兜底回收:队长没交结构化产出但有真图 → 按执行流归属成员部分交差', () => {
    const r = assembleResult(base({
      timedOut: true,
      producedPaths: new Set(['/a.png', '/b.png']),
      callMemberBySeq: new Map([[1, '印工老陈'], [2, '发散阿图']]),
      okPathBySeq: new Map([[1, '/a.png'], [2, '/b.png']]),
    }));
    expect(r.designs).toHaveLength(2);
    expect(r.designs[0].member).toBe('印工老陈');
    expect(r.summary).toContain('超时');
  });

  it('兜底回收:申报全是幻觉路径时也回收真实产出;流里缺归属的图记到「团队」', () => {
    const r = assembleResult(base({
      structured: { designs: [{ path: '/fake.png', member: 'x', rationale: 'y' }], summary: '' },
      producedPaths: new Set(['/real.png']),
    }));
    expect(r.designs.map((d) => d.path)).toEqual(['/real.png']);
    expect(r.designs[0].member).toBe('团队');
  });

  it('零产出:没结构化产出也没真图 → 抛错(超时与否给不同文案)', () => {
    expect(() => assembleResult(base({ timedOut: true }))).toThrow('超时');
    expect(() => assembleResult(base())).toThrow('没有交回结构化产出');
  });

  it('队长有意识地交了空 designs(如实报告零产出)但确有真图 → 仍兜底回收', () => {
    const r = assembleResult(base({
      structured: { designs: [], summary: '全部失败' },
      producedPaths: new Set(['/a.png']),
      callMemberBySeq: new Map([[1, '出图师']]),
      okPathBySeq: new Map([[1, '/a.png']]),
    }));
    expect(r.designs).toHaveLength(1);
    expect(r.summary).toBe('全部失败');
  });
});
