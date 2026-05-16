import { NextRequest } from 'next/server';

const mockCollectVideoForAi = jest.fn();

jest.mock('@/lib/douyin-collector/ai-tools', () => ({
  collectVideoForAi: (...args: unknown[]) => mockCollectVideoForAi(...args),
  collectCreatorForAi: jest.fn(),
  collectKeywordForAi: jest.fn(),
}));

import { POST } from '../route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/douyin-collector/mcp/collect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('douyin MCP collect route', () => {
  beforeEach(() => {
    mockCollectVideoForAi.mockReset();
  });

  it('returns structured failure instead of leaking an HTTP 500 when collection throws', async () => {
    mockCollectVideoForAi.mockRejectedValue(new Error('unexpected parser crash'));

    const res = await POST(makeReq({
      kind: 'video',
      input: 'https://www.douyin.com/video/7321234567890123456',
    }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual(expect.objectContaining({
      ok: false,
      phase: 'collect_exception',
      error: expect.stringContaining('unexpected parser crash'),
    }));
  });
});
