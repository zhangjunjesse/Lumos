import {
  normalizePortableMcpConfig,
  normalizePortableMcpValue,
  resolveMcpConfigPlaceholders,
} from '../mcp-config-placeholders';

describe('mcp-config-placeholders', () => {
  it('normalizes generated MCP script paths to DATA_DIR placeholders', () => {
    expect(
      normalizePortableMcpValue('/Users/alice/.lumos/mcp-scripts/weather.py', {
        dataDir: '/Users/alice/.lumos',
        homeDir: '/Users/alice',
      }),
    ).toBe('[DATA_DIR]/mcp-scripts/weather.py');

    expect(
      normalizePortableMcpValue('C:\\Users\\Alice\\.lumos\\mcp-scripts\\weather.py', {
        dataDir: 'C:\\Users\\Alice\\.lumos',
        homeDir: 'C:\\Users\\Alice',
      }),
    ).toBe('[DATA_DIR]/mcp-scripts/weather.py');
  });

  it('normalizes data and home directory prefixes without leaking local usernames', () => {
    const config = normalizePortableMcpConfig(
      {
        command: '/Users/alice/.lumos/venv/bin/python',
        args: ['/Users/alice/.lumos/data/input.csv', '/Users/alice/Documents/config.json'],
        env: { CACHE_DIR: '/Users/alice/.lumos/cache' },
        headers: { 'X-Config': '/Users/alice/Documents/header.json' },
        type: 'stdio',
      },
      {
        dataDir: '/Users/alice/.lumos',
        homeDir: '/Users/alice',
      },
    );

    expect(config.command).toBe('[DATA_DIR]/venv/bin/python');
    expect(config.args).toEqual(['[DATA_DIR]/data/input.csv', '${USER_HOME}/Documents/config.json']);
    expect(config.env).toEqual({ CACHE_DIR: '[DATA_DIR]/cache' });
    expect(config.headers).toEqual({ 'X-Config': '${USER_HOME}/Documents/header.json' });
  });

  it('resolves both bracket and env-style placeholders at runtime', () => {
    const context = {
      runtimePath: '/app/resources',
      workspacePath: '/work/project',
      dataDir: '/Users/alice/.lumos',
      pythonPath: '/Users/alice/.lumos/venv/bin/python',
      userHome: '/Users/alice',
    };

    expect(resolveMcpConfigPlaceholders('[PYTHON_PATH]', context)).toBe('/Users/alice/.lumos/venv/bin/python');
    expect(resolveMcpConfigPlaceholders('${DATA_DIR}/mcp-scripts/weather.py', context)).toBe('/Users/alice/.lumos/mcp-scripts/weather.py');
    expect(resolveMcpConfigPlaceholders('[RUNTIME_PATH]/mcp-servers/tool.js', context)).toBe('/app/resources/mcp-servers/tool.js');
    expect(resolveMcpConfigPlaceholders('~/Documents/config.json', context)).toBe('/Users/alice/Documents/config.json');
    expect(resolveMcpConfigPlaceholders('${USER_HOME}/Documents/config.json', context)).toBe('/Users/alice/Documents/config.json');
  });
});
