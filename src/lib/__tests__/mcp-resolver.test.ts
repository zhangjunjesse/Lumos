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

import { toSdkMcpConfig } from '@/lib/mcp-resolver';
import type { MCPServerConfig } from '@/types';

describe('mcp resolver', () => {
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
});
