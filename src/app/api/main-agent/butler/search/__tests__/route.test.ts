import { NextRequest } from 'next/server';

jest.mock('@/lib/tools/lumos-butler-mcp-server', () => ({
  searchLumosHistory: jest.fn(),
}));

import { searchLumosHistory } from '@/lib/tools/lumos-butler-mcp-server';
import { GET } from '../route';

const mockedSearchLumosHistory = searchLumosHistory as jest.Mock;

function makeReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

describe('main-agent butler search route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes query, scope and limit to history search', async () => {
    mockedSearchLumosHistory.mockReturnValue({
      schema: 'lumos-butler-history-search/v1',
      query: 'PDF',
      total: 1,
      results: [{ type: 'message', id: 'm1' }],
    });

    const res = await GET(makeReq('/api/main-agent/butler/search?q=PDF&scope=messages&limit=12'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(mockedSearchLumosHistory).toHaveBeenCalledWith({
      query: 'PDF',
      scope: 'messages',
      limit: 12,
    });
  });

  test('falls back to all scope for unknown scope and ignores invalid limits', async () => {
    mockedSearchLumosHistory.mockReturnValue({
      schema: 'lumos-butler-history-search/v1',
      query: '任务',
      total: 0,
      results: [],
    });

    const res = await GET(makeReq('/api/main-agent/butler/search?query=%E4%BB%BB%E5%8A%A1&scope=unsafe&limit=abc'));

    expect(res.status).toBe(200);
    expect(mockedSearchLumosHistory).toHaveBeenCalledWith({
      query: '任务',
      scope: 'all',
      limit: undefined,
    });
  });

  test('requires a non-empty query', async () => {
    const res = await GET(makeReq('/api/main-agent/butler/search?q=+'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('query');
    expect(mockedSearchLumosHistory).not.toHaveBeenCalled();
  });

  test('returns 500 when history search fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedSearchLumosHistory.mockImplementation(() => {
      throw new Error('search failed');
    });

    const res = await GET(makeReq('/api/main-agent/butler/search?q=PDF'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('search failed');

    consoleErrorSpy.mockRestore();
  });
});
