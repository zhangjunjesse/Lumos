import { NextRequest } from 'next/server';

jest.mock('@/lib/db', () => ({
  getMcpServerByNameAndScope: jest.fn(),
  mcpServerRecordToConfig: jest.fn(),
  updateMcpServerHealth: jest.fn(),
}));

jest.mock('@/lib/mcp-smoke-test', () => ({
  smokeTestMcpServerConfig: jest.fn(),
}));

import {
  getMcpServerByNameAndScope,
  mcpServerRecordToConfig,
  updateMcpServerHealth,
} from '@/lib/db';
import { smokeTestMcpServerConfig } from '@/lib/mcp-smoke-test';
import { POST } from '../route';

const mockedGetMcpServerByNameAndScope = getMcpServerByNameAndScope as jest.MockedFunction<typeof getMcpServerByNameAndScope>;
const mockedMcpServerRecordToConfig = mcpServerRecordToConfig as jest.MockedFunction<typeof mcpServerRecordToConfig>;
const mockedUpdateMcpServerHealth = updateMcpServerHealth as jest.MockedFunction<typeof updateMcpServerHealth>;
const mockedSmokeTestMcpServerConfig = smokeTestMcpServerConfig as jest.MockedFunction<typeof smokeTestMcpServerConfig>;

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/plugins/mcp/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('plugins MCP test route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses the saved DB config for named checks instead of trusting the request payload', async () => {
    const record = {
      id: 'server-1',
      name: 'saved-server',
    };
    const savedConfig = {
      command: 'node',
      args: ['saved-server.mjs'],
    };

    mockedGetMcpServerByNameAndScope.mockReturnValue(record as never);
    mockedMcpServerRecordToConfig.mockReturnValue(savedConfig);
    mockedSmokeTestMcpServerConfig.mockResolvedValue({
      ok: true,
      transport: 'stdio',
      tools: ['saved_tool'],
    });

    const res = await POST(makeReq({
      name: 'saved-server',
      scope: 'user',
      server: {
        command: 'node',
        args: ['untrusted-payload.mjs'],
      },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockedSmokeTestMcpServerConfig).toHaveBeenCalledWith(savedConfig);
    expect(mockedSmokeTestMcpServerConfig).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ['untrusted-payload.mjs'],
    }));
    expect(mockedUpdateMcpServerHealth).toHaveBeenCalledWith('server-1', expect.objectContaining({
      status: 'ok',
      tools: ['saved_tool'],
      transport: 'stdio',
    }));
  });

  test('fails named checks when the MCP server is no longer saved', async () => {
    mockedGetMcpServerByNameAndScope.mockReturnValue(undefined);

    const res = await POST(makeReq({
      name: 'missing-server',
      scope: 'user',
      server: {
        command: 'node',
        args: ['stale-ui-payload.mjs'],
      },
    }));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('missing-server');
    expect(mockedSmokeTestMcpServerConfig).not.toHaveBeenCalled();
    expect(mockedUpdateMcpServerHealth).not.toHaveBeenCalled();
  });
});
