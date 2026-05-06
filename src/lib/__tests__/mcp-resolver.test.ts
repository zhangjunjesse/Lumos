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
});
