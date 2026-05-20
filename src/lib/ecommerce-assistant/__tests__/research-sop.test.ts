/**
 * research-sop (方法论层) 单测：planNextRound 的透传、轮次预算强制收尾、
 * LLM 不可用降级、其它错误上抛。
 */
class FakeLlmUnavailable extends Error {}
const mockGenerateStructured = jest.fn();

jest.mock('../llm-client', () => ({
  generateStructured: (...a: unknown[]) => mockGenerateStructured(...a),
  EcommerceLlmUnavailableError: FakeLlmUnavailable,
}));

import { MAX_RESEARCH_ROUNDS, planNextRound } from '../research-sop';

const baseArgs = {
  description: '在 etsy 调研手作陶瓷杯，价位 25-45 USD',
  instruction: null,
  availableSources: ['web', 'deepsearch', 'douyin'],
  digests: [],
  round: 1,
};

describe('planNextRound', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes the model plan through on a normal (pre-budget) round', async () => {
    const plan = {
      platform: 'etsy',
      done: false,
      reasoning: 'r1',
      nextQueries: [{ source: 'web', query: '陶瓷杯 best seller' }],
      gaps: ['pricing'],
    };
    mockGenerateStructured.mockResolvedValue(plan);

    const out = await planNextRound({ ...baseArgs, round: 1 });

    expect(out).toEqual(plan);
    expect(mockGenerateStructured).toHaveBeenCalledTimes(1);
  });

  it('forces done=true and clears nextQueries when the round budget is hit', async () => {
    mockGenerateStructured.mockResolvedValue({
      platform: 'etsy',
      done: false, // model still wants more…
      reasoning: 'wants another round',
      nextQueries: [{ source: 'web', query: 'again' }],
      gaps: [],
    });

    const out = await planNextRound({ ...baseArgs, round: MAX_RESEARCH_ROUNDS });

    expect(out.done).toBe(true); // …but budget overrides
    expect(out.nextQueries).toEqual([]);
  });

  it('degrades to immediate stop (no throw) when the LLM is unavailable', async () => {
    mockGenerateStructured.mockRejectedValue(new FakeLlmUnavailable('no provider'));

    const out = await planNextRound({ ...baseArgs, round: 1 });

    expect(out.done).toBe(true);
    expect(out.nextQueries).toEqual([]);
    expect(out.platform).toBe('general');
    expect(out.gaps.join()).toMatch(/AI 规划不可用/);
  });

  it('re-throws non-LLM-unavailable errors (hard failure stays visible)', async () => {
    mockGenerateStructured.mockRejectedValue(new Error('schema blew up'));

    await expect(planNextRound({ ...baseArgs, round: 1 })).rejects.toThrow(/schema blew up/);
  });
});
