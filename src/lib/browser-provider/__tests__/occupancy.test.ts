import { parseBrowserContextConflict } from '../occupancy';

describe('browser context occupancy helpers', () => {
  test('parses bridge JSON conflict payloads', () => {
    expect(parseBrowserContextConflict({
      error: 'BROWSER_CONTEXT_IN_USE',
      message: '该浏览器正在被另一个会话使用，请稍后再试或切换到其他浏览器。',
      browserContextId: 'adspower:p1',
      ownerId: 'session-a',
      expiresAt: '2026-04-30T10:00:00.000Z',
      lastPath: '/v1/pages/new',
      waitedMs: 10_000,
      retryAfterMs: 5_000,
    })).toEqual({
      contextId: 'adspower:p1',
      message: '该浏览器正在被另一个会话使用，请稍后再试或切换到其他浏览器。',
      ownerId: 'session-a',
      expiresAt: '2026-04-30T10:00:00.000Z',
      lastPath: '/v1/pages/new',
      waitedMs: 10_000,
      retryAfterMs: 5_000,
    });
  });

  test('parses MCP tool-result conflict text with fallback context id', () => {
    const conflict = parseBrowserContextConflict(
      JSON.stringify({
        error: 'Bridge request failed (/v1/pages/new): BROWSER_CONTEXT_IN_USE: 该浏览器正在被另一个会话使用，请稍后再试或切换到其他浏览器。',
      }),
      'adspower:p2',
    );

    expect(conflict?.contextId).toBe('adspower:p2');
    expect(conflict?.message).toContain('浏览器');
  });

  test('ignores unrelated errors', () => {
    expect(parseBrowserContextConflict('WAIT_FOR_TIMEOUT', 'adspower:p1')).toBeNull();
  });
});
