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

  it('resolves qmt placeholders only when provided, else leaves them intact', () => {
    const base = {
      runtimePath: '/app/resources',
      workspacePath: '/work/project',
      dataDir: '/Users/alice/.lumos',
      pythonPath: '/Users/alice/.lumos/venv/bin/python',
      userHome: '/Users/alice',
    };

    // qmt-readonly 启用：qmtPython/qmtScript 注入后被替换为系统 python 与脚本绝对路径。
    const withQmt = { ...base, qmtPython: 'C:\\Python311\\python.exe', qmtScript: 'D:\\quant\\qmt_mcp_server.py' };
    expect(resolveMcpConfigPlaceholders('[QMT_PYTHON]', withQmt)).toBe('C:\\Python311\\python.exe');
    expect(resolveMcpConfigPlaceholders('[QMT_SCRIPT]', withQmt)).toBe('D:\\quant\\qmt_mcp_server.py');

    // 未提供（qmt 未启用）：占位符原样保留，让缺失暴露为明确失败而非静默空命令。
    expect(resolveMcpConfigPlaceholders('[QMT_PYTHON]', base)).toBe('[QMT_PYTHON]');
    expect(resolveMcpConfigPlaceholders('[QMT_SCRIPT]', base)).toBe('[QMT_SCRIPT]');
  });
});
