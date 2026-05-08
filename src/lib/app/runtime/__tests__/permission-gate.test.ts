import path from 'path';

import Database from 'better-sqlite3';

import { migrateAppTables } from '../../../db/migrations-app';
import { PermissionDeniedError, createPermissionGate } from '../permission-gate';

function setup(perms: { permission: string; granted: 0 | 1 }[]) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  const now = Date.now();
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('app-one', 'A', '1.0.0', '{}', 'ai-generated', '/tmp/app-one', now);
  const insert = db.prepare(
    `INSERT INTO lumos_app_permissions (app_id, permission, granted, granted_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const p of perms) insert.run('app-one', p.permission, p.granted, now);
  return db;
}

describe('PermissionGate — basic', () => {
  it('rejects malformed appId', () => {
    const db = setup([]);
    expect(() => createPermissionGate(db, 'BAD')).toThrow();
  });

  it('only treats granted=1 rows as granted', () => {
    const db = setup([
      { permission: 'mcp:feishu', granted: 1 },
      { permission: 'mcp:office-docs', granted: 0 },
    ]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.isGranted('mcp:feishu')).toBe(true);
    expect(gate.isGranted('mcp:office-docs')).toBe(false);
    expect(gate.granted()).toEqual(['mcp:feishu']);
  });

  it('treats permissions not in the table as denied', () => {
    const db = setup([{ permission: 'mcp:feishu', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.isGranted('tool:bash')).toBe(false);
  });

  it('requireOrThrow throws PermissionDeniedError', () => {
    const db = setup([{ permission: 'mcp:feishu', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(() => gate.requireOrThrow('mcp:feishu')).not.toThrow();
    try {
      gate.requireOrThrow('tool:bash');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionDeniedError);
      expect((err as PermissionDeniedError).permission).toBe('tool:bash');
      expect((err as PermissionDeniedError).appId).toBe('app-one');
    }
  });
});

describe('PermissionGate — MCP', () => {
  it('canCallMcp matches mcp:<server>', () => {
    const db = setup([{ permission: 'mcp:feishu', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.canCallMcp('feishu')).toBe(true);
    expect(gate.canCallMcp('other')).toBe(false);
  });

  it('canCallMcpTool falls back to mcp:<server> when tool-specific not granted', () => {
    const db = setup([{ permission: 'mcp:feishu', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.canCallMcpTool('feishu', 'send_message')).toBe(true);
    expect(gate.canCallMcpTool('other', 'x')).toBe(false);
  });

  it('canCallMcpTool honours fine-grained mcp.tool:<server>:<tool>', () => {
    const db = setup([{ permission: 'mcp.tool:feishu:send_message', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.canCallMcpTool('feishu', 'send_message')).toBe(true);
    expect(gate.canCallMcpTool('feishu', 'delete_user')).toBe(false);
  });
});

describe('PermissionGate — tools and system', () => {
  it('canUseTool matches tool:<name>', () => {
    const db = setup([{ permission: 'tool:python', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.canUseTool('python')).toBe(true);
    expect(gate.canUseTool('bash')).toBe(false);
  });

  it('canUseSystem matches system:<cap>', () => {
    const db = setup([
      { permission: 'system:notification', granted: 1 },
      { permission: 'system:browser', granted: 1 },
      { permission: 'system:im-notification', granted: 1 },
    ]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.canUseSystem('notification')).toBe(true);
    expect(gate.canUseSystem('browser')).toBe(true);
    expect(gate.canUseSystem('im-notification')).toBe(true);
    expect(gate.canUseSystem('schedule')).toBe(false);
  });
});

describe('PermissionGate — network', () => {
  it('canFetchUrl extracts hostname and matches net:<host>', () => {
    const db = setup([{ permission: 'net:open.feishu.cn', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.canFetchUrl('https://open.feishu.cn/api/x')).toBe(true);
    expect(gate.canFetchUrl('https://OPEN.FEISHU.CN/api/x')).toBe(true);
    expect(gate.canFetchUrl('https://open.feishu.cn:8443/api/x')).toBe(true);
    expect(gate.canFetchUrl('https://api.openai.com/x')).toBe(false);
  });

  it('rejects non-http(s) URLs even if host matches', () => {
    const db = setup([{ permission: 'net:open.feishu.cn', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.canFetchUrl('ws://open.feishu.cn/socket')).toBe(false);
    expect(gate.canFetchUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    const db = setup([{ permission: 'net:open.feishu.cn', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    expect(gate.canFetchUrl('not a url')).toBe(false);
    expect(gate.canFetchUrl('')).toBe(false);
  });
});

describe('PermissionGate — filesystem', () => {
  const HOME = '/Users/test';

  it('allows paths under a granted ~/ prefix', () => {
    const db = setup([{ permission: 'fs.read:~/Documents/customers', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one', { homeDir: HOME });
    expect(gate.canReadPath('/Users/test/Documents/customers/alice.json')).toBe(true);
    expect(gate.canReadPath('/Users/test/Documents/customers')).toBe(true);
  });

  it('refuses paths outside the granted prefix', () => {
    const db = setup([{ permission: 'fs.read:~/Documents/customers', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one', { homeDir: HOME });
    expect(gate.canReadPath('/Users/test/Documents/other')).toBe(false);
    expect(gate.canReadPath('/Users/test/Desktop/x')).toBe(false);
  });

  it('respects a directory boundary (no string-prefix-only match)', () => {
    const db = setup([{ permission: 'fs.read:~/Documents/foo', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one', { homeDir: HOME });
    // "/Users/test/Documents/foo-bar" must NOT be allowed by "/Users/test/Documents/foo"
    expect(gate.canReadPath('/Users/test/Documents/foo-bar/x')).toBe(false);
    expect(gate.canReadPath('/Users/test/Documents/foo')).toBe(true);
    expect(gate.canReadPath('/Users/test/Documents/foo/x')).toBe(true);
  });

  it('write requires fs.write — read does not imply write', () => {
    const db = setup([{ permission: 'fs.read:~/Documents/x', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one', { homeDir: HOME });
    expect(gate.canReadPath('/Users/test/Documents/x/file')).toBe(true);
    expect(gate.canWritePath('/Users/test/Documents/x/file')).toBe(false);
  });

  it('handles absolute granted prefixes', () => {
    const db = setup([{ permission: 'fs.write:/var/log/lumos-app', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one', { homeDir: HOME });
    expect(gate.canWritePath('/var/log/lumos-app/output.log')).toBe(true);
    expect(gate.canWritePath('/var/log/other')).toBe(false);
  });

  it('normalizes ".." traversal in queried paths', () => {
    const db = setup([{ permission: 'fs.read:~/Documents/foo', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one', { homeDir: HOME });
    // /Users/test/Documents/foo/../../etc/passwd → /Users/test/etc/passwd
    expect(
      gate.canReadPath(path.resolve('/Users/test/Documents/foo/../../etc/passwd')),
    ).toBe(false);
  });

  it('multiple prefixes are honored', () => {
    const db = setup([
      { permission: 'fs.read:~/Documents', granted: 1 },
      { permission: 'fs.read:~/Downloads', granted: 1 },
    ]);
    const gate = createPermissionGate(db, 'app-one', { homeDir: HOME });
    expect(gate.canReadPath('/Users/test/Documents/x')).toBe(true);
    expect(gate.canReadPath('/Users/test/Downloads/y')).toBe(true);
    expect(gate.canReadPath('/Users/test/Library/z')).toBe(false);
  });
});

describe('PermissionGate — snapshot semantics', () => {
  it('does NOT see permissions added after gate creation', () => {
    const db = setup([{ permission: 'mcp:feishu', granted: 1 }]);
    const gate = createPermissionGate(db, 'app-one');
    db.prepare(
      `INSERT INTO lumos_app_permissions (app_id, permission, granted, granted_at)
       VALUES (?, ?, ?, ?)`,
    ).run('app-one', 'mcp:other', 1, Date.now());
    expect(gate.canCallMcp('other')).toBe(false);
    // Caller must rebuild the gate after permission changes.
    const fresh = createPermissionGate(db, 'app-one');
    expect(fresh.canCallMcp('other')).toBe(true);
  });
});
