const mockSeedBuiltinProviders = jest.fn();
const mockSeedBuiltinSkills = jest.fn();
const mockSeedBuiltinMcpServers = jest.fn();

jest.mock('better-sqlite3', () => function MockDatabase() {});

jest.mock('../seed-builtin', () => ({
  seedBuiltinProviders: (...args: unknown[]) => mockSeedBuiltinProviders(...args),
  seedBuiltinSkills: (...args: unknown[]) => mockSeedBuiltinSkills(...args),
  seedBuiltinMcpServers: (...args: unknown[]) => mockSeedBuiltinMcpServers(...args),
}));

import { migrateLumosTables } from '../migrations-lumos';

type MockPreparedStatement = {
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
  run: (...args: unknown[]) => unknown;
};

function createMockDb() {
  const execCalls: string[] = [];
  const runCalls: Array<{ sql: string; args: unknown[] }> = [];

  const prepare = jest.fn((sql: string): MockPreparedStatement => ({
    all: () => {
      if (sql.includes('PRAGMA table_info(api_providers)')) {
        return [
          { name: 'id' },
          { name: 'name' },
          { name: 'provider_type' },
          { name: 'base_url' },
          { name: 'api_key' },
          { name: 'is_active' },
          { name: 'sort_order' },
          { name: 'extra_env' },
          { name: 'notes' },
          { name: 'created_at' },
          { name: 'updated_at' },
        ];
      }

      return [];
    },
    get: (...args: unknown[]) => {
      if (sql.includes('SELECT COUNT(*) as count FROM api_providers')) {
        return { count: 1 };
      }

      if (sql.includes("SELECT value FROM settings WHERE key = 'anthropic_auth_token'")) {
        return undefined;
      }

      if (sql.includes("SELECT value FROM settings WHERE key = 'anthropic_base_url'")) {
        return undefined;
      }

      if (sql.includes('SELECT id FROM api_providers WHERE is_builtin = 1')) {
        return undefined;
      }

      if (sql.includes('SELECT id FROM api_providers WHERE name = ?')) {
        return args[0] === 'Built-in' ? { id: 'provider-builtin-legacy' } : undefined;
      }

      return undefined;
    },
    run: (...args: unknown[]) => {
      runCalls.push({ sql, args });
      return { changes: 1 };
    },
  }));

  return {
    exec: (sql: string) => {
      execCalls.push(sql);
    },
    prepare,
    execCalls,
    runCalls,
  };
}

describe('provider migrations', () => {
  beforeEach(() => {
    mockSeedBuiltinProviders.mockReset();
    mockSeedBuiltinSkills.mockReset();
    mockSeedBuiltinMcpServers.mockReset();
  });

  it('backfills legacy provider capabilities conservatively when the column is added', () => {
    const db = createMockDb();

    migrateLumosTables(db as never);

    const capabilitiesAlter = db.execCalls.find((sql) => (
      sql.includes('ALTER TABLE api_providers ADD COLUMN capabilities TEXT NOT NULL DEFAULT \'["text-gen"]\'')
    ));
    expect(capabilitiesAlter).toBeTruthy();

    const capabilitiesUpdate = db.execCalls.find((sql) => (
      sql.includes('UPDATE api_providers')
      && sql.includes(`WHEN provider_type = 'gemini-image' THEN '["image-gen"]'`)
      && sql.includes(`WHEN is_builtin = 1 OR is_active = 1 THEN '["agent-chat"]'`)
      && sql.includes(`ELSE '["text-gen"]'`)
    ));
    expect(capabilitiesUpdate).toBeTruthy();
    expect(capabilitiesUpdate).not.toContain('WHERE TRIM(COALESCE(capabilities');

    expect(db.runCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sql: "UPDATE api_providers SET is_builtin = 1 WHERE id = ?",
        args: ['provider-builtin-legacy'],
      }),
      expect.objectContaining({
        sql: "UPDATE api_providers SET provider_origin = 'system' WHERE id = ?",
        args: ['provider-builtin-legacy'],
      }),
      expect.objectContaining({
        sql: "UPDATE api_providers SET capabilities = '[\"agent-chat\"]' WHERE id = ?",
        args: ['provider-builtin-legacy'],
      }),
    ]));
  });
});
