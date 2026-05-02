import { NextRequest } from 'next/server';

jest.mock('@/lib/tools/lumos-butler-mcp-server', () => ({
  buildLumosStatus: jest.fn(),
}));

import { buildLumosStatus } from '@/lib/tools/lumos-butler-mcp-server';
import { GET } from '../route';

const mockedBuildLumosStatus = buildLumosStatus as jest.Mock;

function makeReq(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

describe('main-agent butler status route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes session id and include_recent query options to the status builder', async () => {
    mockedBuildLumosStatus.mockReturnValue({
      schema: 'lumos-butler-status/v1',
      generated_at: '2026-05-02T00:00:00.000Z',
    });

    const res = await GET(makeReq('/api/main-agent/butler/status?session_id=session-1&include_recent=false'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.schema).toBe('lumos-butler-status/v1');
    expect(mockedBuildLumosStatus).toHaveBeenCalledWith({
      currentSessionId: 'session-1',
      includeRecent: false,
    });
  });

  test('defaults include_recent to true and omits blank session ids', async () => {
    mockedBuildLumosStatus.mockReturnValue({
      schema: 'lumos-butler-status/v1',
      generated_at: '2026-05-02T00:00:00.000Z',
    });

    const res = await GET(makeReq('/api/main-agent/butler/status?session_id=+'));

    expect(res.status).toBe(200);
    expect(mockedBuildLumosStatus).toHaveBeenCalledWith({
      currentSessionId: undefined,
      includeRecent: true,
    });
  });

  test('returns 500 when status building fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockedBuildLumosStatus.mockImplementation(() => {
      throw new Error('status read failed');
    });

    const res = await GET(makeReq('/api/main-agent/butler/status'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('status read failed');

    consoleErrorSpy.mockRestore();
  });
});
