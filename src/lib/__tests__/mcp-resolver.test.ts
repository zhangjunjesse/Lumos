jest.mock('@/lib/db', () => ({
  getEnabledMcpServersAsConfig: jest.fn(() => ({})),
  dataDir: '/tmp/lumos-test',
}));

jest.mock('@/lib/mcp-env-enrichers', () => ({
  ENRICHER_MAP: {},
}));

jest.mock('@/lib/python-venv', () => ({
  getVenvPythonPath: jest.fn(() => 'python'),
  isVenvReady: jest.fn(() => false),
}));

jest.mock('@/lib/python-runtime', () => ({
  resolvePythonBinary: jest.fn(() => 'python'),
}));

jest.mock('@/lib/runtime-resources', () => ({
  resolveRuntimeResourceRootFor: jest.fn(() => '/runtime'),
}));

import { getEnabledMcpServersAsConfig } from '@/lib/db';
import { resolveEnabledMcpServers, toSdkMcpConfig } from '@/lib/mcp-resolver';
import type { MCPServerConfig } from '@/types';

const mockedGetEnabledMcpServersAsConfig = getEnabledMcpServersAsConfig as jest.MockedFunction<typeof getEnabledMcpServersAsConfig>;

describe('mcp resolver', () => {
  beforeEach(() => {
    mockedGetEnabledMcpServersAsConfig.mockReturnValue({});
  });

  test('registers chrome-devtools with SDK-safe chrome_devtools name', () => {
    const config: Record<string, MCPServerConfig> = {
      'chrome-devtools': {
        type: 'stdio',
        command: 'node',
        args: ['server.mjs'],
        env: {},
      },
    };

    const sdkConfig = toSdkMcpConfig(config);
    expect(sdkConfig['chrome-devtools']).toBeUndefined();
    expect(sdkConfig.chrome_devtools).toMatchObject({
      command: 'node',
      args: ['server.mjs'],
    });
  });

  test('normalizes legacy string args before resolving placeholders', () => {
    mockedGetEnabledMcpServersAsConfig.mockReturnValue({
      dirty: {
        command: 'node',
        args: '[DATA_DIR]/mcp-scripts/legacy.mjs' as never,
      },
    });

    const resolved = resolveEnabledMcpServers();

    expect(resolved?.dirty.args).toEqual(['/tmp/lumos-test/mcp-scripts/legacy.mjs']);
  });

  test('drops malformed non-array args instead of throwing', () => {
    mockedGetEnabledMcpServersAsConfig.mockReturnValue({
      dirty: {
        command: 'node',
        args: { bad: true } as never,
      },
    });

    expect(() => resolveEnabledMcpServers()).not.toThrow();
    expect(resolveEnabledMcpServers()?.dirty.args).toBeUndefined();
  });

  test('injects LUMOS_INTERNAL_URL from PORT for stdio MCP', () => {
    const prevPort = process.env.PORT;
    process.env.PORT = '43127';
    try {
      mockedGetEnabledMcpServersAsConfig.mockReturnValue({
        'douyin-collector': { command: 'node', args: ['c.mjs'], env: {} },
      });
      expect(
        resolveEnabledMcpServers()?.['douyin-collector'].env?.LUMOS_INTERNAL_URL,
      ).toBe('http://127.0.0.1:43127');
    } finally {
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
    }
  });

  test('falls back to LUMOS_SERVER_PORT then 3000 for LUMOS_INTERNAL_URL', () => {
    const prevPort = process.env.PORT;
    const prevServerPort = process.env.LUMOS_SERVER_PORT;
    delete process.env.PORT;
    process.env.LUMOS_SERVER_PORT = '8081';
    try {
      mockedGetEnabledMcpServersAsConfig.mockReturnValue({
        'x-platform': { command: 'node', args: ['x.mjs'], env: {} },
      });
      expect(
        resolveEnabledMcpServers()?.['x-platform'].env?.LUMOS_INTERNAL_URL,
      ).toBe('http://127.0.0.1:8081');

      delete process.env.LUMOS_SERVER_PORT;
      mockedGetEnabledMcpServersAsConfig.mockReturnValue({
        'x-platform': { command: 'node', args: ['x.mjs'], env: {} },
      });
      expect(
        resolveEnabledMcpServers()?.['x-platform'].env?.LUMOS_INTERNAL_URL,
      ).toBe('http://127.0.0.1:3000');
    } finally {
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
      if (prevServerPort === undefined) delete process.env.LUMOS_SERVER_PORT;
      else process.env.LUMOS_SERVER_PORT = prevServerPort;
    }
  });

  test('does not override an explicit LUMOS_INTERNAL_URL', () => {
    const prevPort = process.env.PORT;
    process.env.PORT = '43127';
    try {
      mockedGetEnabledMcpServersAsConfig.mockReturnValue({
        'douyin-collector': {
          command: 'node',
          args: ['c.mjs'],
          env: { LUMOS_INTERNAL_URL: 'http://127.0.0.1:9999' },
        },
      });
      expect(
        resolveEnabledMcpServers()?.['douyin-collector'].env?.LUMOS_INTERNAL_URL,
      ).toBe('http://127.0.0.1:9999');
    } finally {
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
    }
  });
});
