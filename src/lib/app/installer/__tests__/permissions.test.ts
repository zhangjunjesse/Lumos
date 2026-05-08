import type { AppManifest } from '../../manifest/types';
import { derivePermissions } from '../permissions';

const baseManifest: AppManifest = {
  id: 'test-app',
  name: 'Test',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'main',
};

describe('derivePermissions', () => {
  it('returns empty array for a manifest with no requires/permissions', () => {
    expect(derivePermissions(baseManifest)).toEqual([]);
  });

  it('emits fs.read and fs.write entries', () => {
    const perms = derivePermissions({
      ...baseManifest,
      permissions: {
        filesystem: {
          read: ['~/Documents/work'],
          write: ['~/Downloads/lumos-app-{id}'],
        },
      },
    });
    expect(perms).toContainEqual(
      expect.objectContaining({ permission: 'fs.read:~/Documents/work' }),
    );
    expect(perms).toContainEqual(
      expect.objectContaining({ permission: 'fs.write:~/Downloads/lumos-app-{id}', level: 'safe' }),
    );
  });

  it('rates write to Documents as high and read as moderate', () => {
    const perms = derivePermissions({
      ...baseManifest,
      permissions: {
        filesystem: {
          read: ['~/Documents/x'],
          write: ['~/Documents/x'],
        },
      },
    });
    const read = perms.find((p) => p.permission.startsWith('fs.read:'))!;
    const write = perms.find((p) => p.permission.startsWith('fs.write:'))!;
    expect(read.level).toBe('moderate');
    expect(write.level).toBe('high');
  });

  it('emits one net entry per whitelist domain', () => {
    const perms = derivePermissions({
      ...baseManifest,
      permissions: {
        network: {
          mode: 'whitelist',
          domains: ['open.feishu.cn', 'api.openai.com'],
        },
      },
    });
    expect(perms.filter((p) => p.permission.startsWith('net:'))).toHaveLength(2);
  });

  it('omits net entries when mode is disabled', () => {
    const perms = derivePermissions({
      ...baseManifest,
      permissions: { network: { mode: 'disabled' } },
    });
    expect(perms.filter((p) => p.permission.startsWith('net:'))).toEqual([]);
  });

  it('emits mcp entries for each declared server', () => {
    const perms = derivePermissions({
      ...baseManifest,
      requires: { mcp: ['feishu', 'office-docs'] },
    });
    expect(perms.filter((p) => p.permission.startsWith('mcp:'))).toHaveLength(2);
  });

  it('rates bash tool as high, python as moderate, web-fetch as safe', () => {
    const perms = derivePermissions({
      ...baseManifest,
      requires: { tools: ['bash', 'python', 'web-fetch'] },
    });
    expect(perms.find((p) => p.permission === 'tool:bash')?.level).toBe('high');
    expect(perms.find((p) => p.permission === 'tool:python')?.level).toBe('moderate');
    expect(perms.find((p) => p.permission === 'tool:web-fetch')?.level).toBe('safe');
  });

  it('emits system entries', () => {
    const perms = derivePermissions({
      ...baseManifest,
      permissions: { system: ['notification', 'schedule', 'im-notification'] },
    });
    expect(perms.map((p) => p.permission).sort()).toEqual([
      'system:im-notification',
      'system:notification',
      'system:schedule',
    ]);
  });

  it('emits system:browser when requires.browser', () => {
    const perms = derivePermissions({
      ...baseManifest,
      requires: { browser: true },
    });
    expect(perms).toContainEqual(
      expect.objectContaining({ permission: 'system:browser', level: 'high' }),
    );
  });

  it('flags data:shared as high if it slips past validation', () => {
    const perms = derivePermissions({
      ...baseManifest,
      permissions: { data: 'shared' },
    });
    expect(perms).toContainEqual(
      expect.objectContaining({ permission: 'data:shared', level: 'high' }),
    );
  });

  it('every descriptor carries a non-empty source label', () => {
    const perms = derivePermissions({
      ...baseManifest,
      permissions: {
        filesystem: { read: ['~/x'] },
        network: { mode: 'whitelist', domains: ['a.b.c'] },
      },
      requires: { tools: ['python'], mcp: ['feishu'] },
    });
    for (const p of perms) {
      expect(p.source.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});
