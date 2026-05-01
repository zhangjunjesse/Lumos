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
});
