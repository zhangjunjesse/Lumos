import Database from 'better-sqlite3';

import { probeCapabilities } from '../capabilities';

function emptyDb(): Database.Database {
  const db = new Database(':memory:');
  return db;
}

describe('probeCapabilities — empty database', () => {
  it('returns empty mcps / agents / knowledge', () => {
    const db = emptyDb();
    try {
      const cap = probeCapabilities(db);
      expect(cap.mcps).toEqual([]);
      expect(cap.agents).toEqual([]);
      expect(cap.knowledge).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('returns the static llmTiers and tools', () => {
    const db = emptyDb();
    try {
      const cap = probeCapabilities(db);
      expect(cap.llmTiers).toEqual(['chat', 'reasoning', 'fast']);
      expect(cap.tools).toEqual(['bash', 'python', 'file', 'web-fetch']);
    } finally {
      db.close();
    }
  });

  it('defaults M-stage flags to false', () => {
    const db = emptyDb();
    try {
      const cap = probeCapabilities(db);
      expect(cap.workflowExecutionReady).toBe(false);
      expect(cap.codeAppsEnabled).toBe(false);
    } finally {
      db.close();
    }
  });

  it('honours capability flag overrides', () => {
    const db = emptyDb();
    try {
      const cap = probeCapabilities(db, {
        workflowExecutionReady: true,
        codeAppsEnabled: true,
      });
      expect(cap.workflowExecutionReady).toBe(true);
      expect(cap.codeAppsEnabled).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('probeCapabilities — populated database', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = emptyDb();
    // Mimic the relevant lumos schema. We only create what probeCapabilities
    // reads — broader columns are ignored.
    db.exec(`
      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_enabled INTEGER NOT NULL,
        scope TEXT NOT NULL
      );
      CREATE TABLE agent_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        role TEXT
      );
      CREATE TABLE kb_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );
      CREATE TABLE kb_items (
        id TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('lists MCPs, sorted by enabled-first then name', () => {
    db.prepare(
      `INSERT INTO mcp_servers (id, name, description, is_enabled, scope) VALUES (?, ?, ?, ?, ?)`,
    ).run('feishu', '飞书', 'Feishu integration', 1, 'builtin');
    db.prepare(
      `INSERT INTO mcp_servers (id, name, description, is_enabled, scope) VALUES (?, ?, ?, ?, ?)`,
    ).run('bilibili', 'B 站', 'Bilibili search', 0, 'user');

    const cap = probeCapabilities(db);
    expect(cap.mcps.map((m) => m.id)).toEqual(['feishu', 'bilibili']);
    expect(cap.mcps[0].enabled).toBe(true);
    expect(cap.mcps[0].description).toBe('Feishu integration');
  });

  it('lists agents', () => {
    db.prepare(
      `INSERT INTO agent_presets (id, name, description, role) VALUES (?, ?, ?, ?)`,
    ).run('worker', 'Worker', 'General-purpose', 'worker');
    db.prepare(
      `INSERT INTO agent_presets (id, name, description, role) VALUES (?, ?, ?, ?)`,
    ).run('researcher', 'Researcher', 'Deep research', 'researcher');

    const cap = probeCapabilities(db);
    expect(cap.agents.map((a) => a.id).sort()).toEqual(['researcher', 'worker']);
    expect(cap.agents.find((a) => a.id === 'worker')?.role).toBe('worker');
  });

  it('lists knowledge collections with item counts', () => {
    db.prepare(`INSERT INTO kb_collections (id, name) VALUES (?, ?)`).run('docs', '产品文档');
    db.prepare(`INSERT INTO kb_collections (id, name) VALUES (?, ?)`).run('cases', '客户案例');
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO kb_items (id, collection_id) VALUES (?, ?)`).run(
        `docs-${i}`,
        'docs',
      );
    }
    db.prepare(`INSERT INTO kb_items (id, collection_id) VALUES (?, ?)`).run('cases-1', 'cases');

    const cap = probeCapabilities(db);
    expect(cap.knowledge.find((k) => k.id === 'docs')?.itemCount).toBe(3);
    expect(cap.knowledge.find((k) => k.id === 'cases')?.itemCount).toBe(1);
  });

  it('survives missing columns in agent_presets', () => {
    db.exec(`DROP TABLE agent_presets;`);
    db.exec(`CREATE TABLE agent_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL);`);
    db.prepare(`INSERT INTO agent_presets (id, name) VALUES (?, ?)`).run('w', 'Worker');
    const cap = probeCapabilities(db);
    expect(cap.agents).toEqual([
      expect.objectContaining({ id: 'w', name: 'Worker' }),
    ]);
  });
});
