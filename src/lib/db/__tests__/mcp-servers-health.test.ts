import fs from 'fs';
import os from 'os';
import path from 'path';

describe('mcp server health persistence', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-mcp-health-test-'));
    delete process.env.LUMOS_DATA_DIR;
    process.env.LUMOS_BUILD_PHASE = '1';
    process.env.LUMOS_BUILD_DATA_DIR = tmpDir;
    process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
    jest.resetModules();
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.resetModules() requires CJS reload to pick up env-driven path resolution
    const { closeDb } = require('../connection') as typeof import('../connection');
    closeDb({ silent: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_GUI_DATA_DIR;
    delete process.env.LUMOS_BUILD_PHASE;
    delete process.env.LUMOS_BUILD_DATA_DIR;
    jest.resetModules();
  });

  it('persists health checks and clears stale health after config changes', () => {
    const {
      createMcpServer,
      getMcpServer,
      updateMcpServer,
      updateMcpServerHealth,
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- see afterEach above
    } = require('../mcp-servers') as typeof import('../mcp-servers');

    const server = createMcpServer({
      name: 'health-test',
      command: 'node',
      args: ['server.mjs'],
      scope: 'user',
      is_enabled: true,
    });

    expect(server.health_status).toBe('unknown');
    expect(server.run_mode).toBe('on_demand');
    expect(server.runtime_kind).toBe('auto');

    updateMcpServerHealth(server.id, {
      status: 'ok',
      checked_at: '2026-05-01T00:00:00.000Z',
      tools: ['hello'],
      transport: 'stdio',
    });

    const checked = getMcpServer(server.id);
    expect(checked?.health_status).toBe('ok');
    expect(checked?.health_checked_at).toBe('2026-05-01T00:00:00.000Z');
    expect(checked?.health_tools).toBe('["hello"]');
    expect(checked?.health_transport).toBe('stdio');

    updateMcpServer(server.id, { description: 'description only' });
    expect(getMcpServer(server.id)?.health_status).toBe('ok');

    updateMcpServer(server.id, { command: 'node2' });
    const changed = getMcpServer(server.id);
    expect(changed?.health_status).toBe('unknown');
    expect(changed?.health_checked_at).toBe('');
    expect(changed?.health_tools).toBe('[]');

    updateMcpServer(server.id, { runMode: 'keep_alive', runtime: 'node' });
    const runtimeChanged = getMcpServer(server.id);
    expect(runtimeChanged?.run_mode).toBe('keep_alive');
    expect(runtimeChanged?.runtime_kind).toBe('node');
  });

  it('normalizes legacy non-array args when reading and writing MCP configs', () => {
    const {
      createMcpServer,
      getMcpServer,
      mcpServerRecordToConfig,
      parseMcpStringArray,
      updateMcpServer,
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- see afterEach above
    } = require('../mcp-servers') as typeof import('../mcp-servers');

    expect(parseMcpStringArray('"legacy-server.mjs"')).toEqual(['legacy-server.mjs']);
    expect(parseMcpStringArray('{"bad":true}')).toEqual([]);

    const server = createMcpServer({
      name: 'legacy-args-test',
      command: 'node',
      args: 'legacy-server.mjs' as never,
      env: ['bad-env'] as never,
      headers: ['bad-header'] as never,
      scope: 'user',
      is_enabled: true,
    });

    expect(getMcpServer(server.id)?.args).toBe('["legacy-server.mjs"]');
    expect(getMcpServer(server.id)?.env).toBe('{}');
    expect(getMcpServer(server.id)?.headers).toBe('{}');

    updateMcpServer(server.id, { args: { bad: true } as never });
    expect(getMcpServer(server.id)?.args).toBe('[]');

    const legacyRecord = {
      ...server,
      args: '"legacy-server.mjs"',
      env: '[]',
      headers: '[]',
    };
    expect(mcpServerRecordToConfig(legacyRecord).args).toEqual(['legacy-server.mjs']);
    expect(mcpServerRecordToConfig(legacyRecord).env).toBeUndefined();
  });

  it('does not expose missing goofish-cli MCP to chat runtime config', () => {
    const {
      createMcpServer,
      getEnabledMcpServersAsConfig,
      updateMcpServerHealth,
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- see afterEach above
    } = require('../mcp-servers') as typeof import('../mcp-servers');

    createMcpServer({
      name: 'goofish-search',
      command: 'node',
      args: ['search_mcp.mjs'],
      scope: 'builtin',
      is_enabled: true,
    });
    const goofish = createMcpServer({
      name: 'goofish',
      command: 'node',
      args: ['launcher.mjs'],
      scope: 'builtin',
      is_enabled: true,
    });
    updateMcpServerHealth(goofish.id, {
      status: 'failed',
      error: "ModuleNotFoundError: No module named 'goofish_cli'",
    });

    const config = getEnabledMcpServersAsConfig();
    expect(config['goofish-search']).toBeDefined();
    expect(config.goofish).toBeUndefined();
  });
});
