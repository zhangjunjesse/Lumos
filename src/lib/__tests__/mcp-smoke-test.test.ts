import { smokeTestMcpServerConfig } from '../mcp-smoke-test';

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  });
}

describe('mcp-smoke-test remote checks', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checks streamable HTTP MCP protocol with initialize and tools/list', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'remote-test', version: '1.0.0' },
        },
      }, { 'mcp-session-id': 'session-1' }))
      .mockResolvedValueOnce(new Response('', { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: '2.0',
        id: 2,
        result: {
          tools: [{ name: 'remote_tool' }],
        },
      }));

    const result = await smokeTestMcpServerConfig({
      type: 'http',
      url: 'https://mcp.example.com',
    });

    expect(result.ok).toBe(true);
    expect(result.transport).toBe('http');
    expect(result.tools).toEqual(['remote_tool']);
    expect(result.reason).toContain('MCP protocol check passed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).method).toBe('initialize');
    expect(JSON.parse(String((fetchMock.mock.calls[2][1] as RequestInit).body)).method).toBe('tools/list');
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toEqual(expect.any(Headers));
    expect(((fetchMock.mock.calls[2][1] as RequestInit).headers as Headers).get('mcp-session-id')).toBe('session-1');
  });

  it('does not mark auth or not-found responses as usable', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('missing', { status: 404 }));

    const result = await smokeTestMcpServerConfig({
      type: 'http',
      url: 'https://mcp.example.com/missing',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('HTTP 404');
  });

  it('checks legacy SSE MCP protocol through endpoint, initialize and tools/list', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(sseResponse([
        [
          'event: endpoint\ndata: /messages?sessionId=abc\n\n',
          'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"sse-test","version":"1.0.0"}}}\n\n',
          'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"sse_tool"}]}}\n\n',
        ].join(''),
      ]))
      .mockResolvedValue(new Response('', { status: 202 }));

    const result = await smokeTestMcpServerConfig({
      type: 'sse',
      url: 'https://mcp.example.com/sse',
    });

    expect(result.ok).toBe(true);
    expect(result.transport).toBe('sse');
    expect(result.tools).toEqual(['sse_tool']);
    expect(result.reason).toContain('MCP protocol check passed');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://mcp.example.com/messages?sessionId=abc');
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)).method).toBe('initialize');
    expect(JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body)).method).toBe('tools/list');
  });
});
