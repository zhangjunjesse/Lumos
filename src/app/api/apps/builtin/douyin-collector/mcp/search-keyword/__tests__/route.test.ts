import { NextRequest } from 'next/server';

// var hoisting needed by jest.mock factory below.
// eslint-disable-next-line no-var
var mockCollectKeywordForAi = jest.fn();

jest.mock('@/lib/douyin-collector/ai-tools', () => ({
  collectKeywordForAi: (...args: unknown[]) => mockCollectKeywordForAi(...args),
}));

import { POST } from '../route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/douyin-collector/mcp/search-keyword', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('douyin MCP search-keyword route', () => {
  beforeEach(() => {
    mockCollectKeywordForAi.mockReset();
    mockCollectKeywordForAi.mockResolvedValue({
      ok: true,
      keyword: { id: 'kw-1', query: 'Etsy选品技巧' },
      job: { id: 'job-1', status: 'success', failure_reason: null },
      videos: [],
      process: { attempted: 0, succeeded: 0, failed: 0, failures: [] },
    });
  });

  it('defaults keyword MCP calls to auto-process and publish to knowledge', async () => {
    const res = await POST(makeReq({ query: ' Etsy选品技巧 ', limit: 14 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mockCollectKeywordForAi).toHaveBeenCalledWith('Etsy选品技巧', {
      timeWindow: undefined,
      dedupeWindowDays: undefined,
      limit: 14,
      autoProcess: true,
      publishToKnowledge: true,
    });
  });

  it('lets AI callers explicitly request metadata-only keyword collection', async () => {
    await POST(
      makeReq({
        query: 'Etsy选品技巧',
        auto_process: false,
        publish_to_knowledge: false,
      }),
    );

    expect(mockCollectKeywordForAi).toHaveBeenCalledWith('Etsy选品技巧', {
      timeWindow: undefined,
      dedupeWindowDays: undefined,
      limit: undefined,
      autoProcess: false,
      publishToKnowledge: false,
    });
  });

  it('rejects empty keyword queries before creating a collect job', async () => {
    const res = await POST(makeReq({ query: '   ' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/query/);
    expect(mockCollectKeywordForAi).not.toHaveBeenCalled();
  });
});
