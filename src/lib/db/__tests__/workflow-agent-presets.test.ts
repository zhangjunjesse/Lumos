import Database from 'better-sqlite3';

let db: Database.Database;

jest.mock('../connection', () => ({
  getDb: () => db,
}));

import {
  listWorkflowAgentPresets,
  listPublishedWorkflowAgentPresets,
  getWorkflowAgentPreset,
  createWorkflowAgentPreset,
  updateWorkflowAgentPreset,
  deleteWorkflowAgentPreset,
  seedBuiltinWorkflowAgentPresets,
  parseWorkflowAgentPresetRecord,
} from '../workflow-agent-presets';

function createTemplatesTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'builtin',
      content_skeleton TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      opening_message TEXT NOT NULL DEFAULT '',
      ai_config TEXT NOT NULL DEFAULT '{}',
      icon TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `);
}

beforeEach(() => {
  db = new Database(':memory:');
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// parseWorkflowAgentPresetRecord
// ---------------------------------------------------------------------------

describe('parseWorkflowAgentPresetRecord', () => {
  test('returns null for null input', () => {
    expect(parseWorkflowAgentPresetRecord(null)).toBeNull();
  });

  test('returns null when kind or version mismatch', () => {
    expect(parseWorkflowAgentPresetRecord({ kind: 'other', version: 1, expertise: 'x' })).toBeNull();
    expect(parseWorkflowAgentPresetRecord({ kind: 'workflow-agent-preset', version: 2, expertise: 'x' })).toBeNull();
  });

  test('returns null when expertise is missing or empty', () => {
    expect(parseWorkflowAgentPresetRecord({ kind: 'workflow-agent-preset', version: 1 })).toBeNull();
    expect(parseWorkflowAgentPresetRecord({ kind: 'workflow-agent-preset', version: 1, expertise: '  ' })).toBeNull();
  });

  test('parses valid record with all optional fields', () => {
    const result = parseWorkflowAgentPresetRecord({
      kind: 'workflow-agent-preset',
      version: 1,
      expertise: '代码实现',
      role: 'coder',
      systemPrompt: 'You are a coder.',
      model: 'claude-sonnet-4-6',
      allowedTools: ['workspace.read', 'workspace.write'],
      outputMode: 'plain-text',
      capabilityTags: ['code'],
      memoryPolicy: 'ephemeral-stage',
      concurrencyLimit: 2,
      timeoutMs: 30000,
      maxRetries: 1,
    });
    expect(result).toMatchObject({
      expertise: '代码实现',
      role: 'coder',
      systemPrompt: 'You are a coder.',
      model: 'claude-sonnet-4-6',
      allowedTools: ['workspace.read', 'workspace.write'],
      outputMode: 'plain-text',
      capabilityTags: ['code'],
      memoryPolicy: 'ephemeral-stage',
      concurrencyLimit: 2,
      timeoutMs: 30000,
      maxRetries: 1,
    });
  });

  test('parses minimal valid record', () => {
    const result = parseWorkflowAgentPresetRecord({ kind: 'workflow-agent-preset', version: 1, expertise: 'research' });
    expect(result).toEqual({ expertise: 'research' });
  });
});

// ---------------------------------------------------------------------------
// listWorkflowAgentPresets — no table
// ---------------------------------------------------------------------------

describe('listWorkflowAgentPresets (no table)', () => {
  test('returns empty array when templates table does not exist', () => {
    expect(listWorkflowAgentPresets()).toEqual([]);
  });

  test('listPublishedWorkflowAgentPresets returns empty when no table', () => {
    expect(listPublishedWorkflowAgentPresets()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CRUD with table
// ---------------------------------------------------------------------------

describe('CRUD operations', () => {
  beforeEach(() => {
    createTemplatesTable();
  });

  test('listWorkflowAgentPresets returns empty array when table is empty', () => {
    expect(listWorkflowAgentPresets()).toEqual([]);
  });

  test('createWorkflowAgentPreset creates a user preset', () => {
    const preset = createWorkflowAgentPreset({
      name: '测试专员',
      description: '测试用预设',
      expertise: '执行测试任务',
      role: 'worker',
    });

    expect(preset.id).toBeTruthy();
    expect(preset.name).toBe('测试专员');
    expect(preset.description).toBe('测试用预设');
    expect(preset.category).toBe('user');
    expect(preset.config.expertise).toBe('执行测试任务');
    expect(preset.config.role).toBe('worker');
    expect(preset.isEnabled).toBe(true);
  });

  test('createWorkflowAgentPreset stores all optional fields', () => {
    const preset = createWorkflowAgentPreset({
      name: '完整预设',
      expertise: '完整能力',
      role: 'coder',
      systemPrompt: 'sys prompt',
      model: 'claude-haiku-4-5',
      allowedTools: ['workspace.read'],
      outputMode: 'plain-text',
      capabilityTags: ['tag1'],
      memoryPolicy: 'ephemeral-stage',
      concurrencyLimit: 3,
      timeoutMs: 60000,
      maxRetries: 2,
    });

    expect(preset.config).toMatchObject({
      expertise: '完整能力',
      role: 'coder',
      systemPrompt: 'sys prompt',
      model: 'claude-haiku-4-5',
      allowedTools: ['workspace.read'],
      outputMode: 'plain-text',
      capabilityTags: ['tag1'],
      memoryPolicy: 'ephemeral-stage',
      concurrencyLimit: 3,
      timeoutMs: 60000,
      maxRetries: 2,
    });
  });

  test('getWorkflowAgentPreset returns undefined for unknown id', () => {
    expect(getWorkflowAgentPreset('nonexistent')).toBeUndefined();
  });

  test('getWorkflowAgentPreset returns preset by id', () => {
    const created = createWorkflowAgentPreset({ name: '查找测试', expertise: '查找能力' });
    const found = getWorkflowAgentPreset(created.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('查找测试');
  });

  test('listWorkflowAgentPresets returns all presets', () => {
    createWorkflowAgentPreset({ name: '预设A', expertise: '能力A' });
    createWorkflowAgentPreset({ name: '预设B', expertise: '能力B' });
    const list = listWorkflowAgentPresets();
    expect(list).toHaveLength(2);
    const names = list.map((p) => p.name);
    expect(names).toContain('预设A');
    expect(names).toContain('预设B');
  });

  test('updateWorkflowAgentPreset updates name and expertise', () => {
    const created = createWorkflowAgentPreset({ name: '原名称', expertise: '原能力', role: 'worker' });
    const updated = updateWorkflowAgentPreset(created.id, { name: '新名称', expertise: '新能力' });
    expect(updated.name).toBe('新名称');
    expect(updated.config.expertise).toBe('新能力');
    expect(updated.config.role).toBe('worker'); // unchanged
  });

  test('updateWorkflowAgentPreset preserves isEnabled', () => {
    const created = createWorkflowAgentPreset({ name: '预设', expertise: '能力' });
    const updated = updateWorkflowAgentPreset(created.id, { expertise: '新能力' });
    expect(updated.isEnabled).toBe(created.isEnabled);
  });

  test('updateWorkflowAgentPreset throws for unknown id', () => {
    expect(() => updateWorkflowAgentPreset('ghost', { name: 'x' })).toThrow("not found");
  });

  test('updateWorkflowAgentPreset throws for builtin preset', () => {
    seedBuiltinWorkflowAgentPresets();
    expect(() => updateWorkflowAgentPreset('builtin-worker', { name: 'hacked' })).toThrow('Cannot update builtin');
  });

  test('deleteWorkflowAgentPreset removes user preset', () => {
    const created = createWorkflowAgentPreset({ name: '待删除', expertise: '能力' });
    deleteWorkflowAgentPreset(created.id);
    expect(getWorkflowAgentPreset(created.id)).toBeUndefined();
  });

  test('deleteWorkflowAgentPreset is a no-op for unknown id', () => {
    expect(() => deleteWorkflowAgentPreset('nonexistent')).not.toThrow();
  });

  test('deleteWorkflowAgentPreset throws for builtin preset', () => {
    seedBuiltinWorkflowAgentPresets();
    expect(() => deleteWorkflowAgentPreset('builtin-worker')).toThrow('Cannot delete builtin');
  });
});

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

describe('seedBuiltinWorkflowAgentPresets', () => {
  beforeEach(() => {
    createTemplatesTable();
  });

  test('seeds 4 builtin presets', () => {
    seedBuiltinWorkflowAgentPresets();
    const all = listWorkflowAgentPresets();
    expect(all).toHaveLength(4);
    const ids = all.map((p) => p.id);
    expect(ids).toContain('builtin-worker');
    expect(ids).toContain('builtin-researcher');
    expect(ids).toContain('builtin-coder');
    expect(ids).toContain('builtin-integration');
  });

  test('all seeded presets are builtin category and enabled', () => {
    seedBuiltinWorkflowAgentPresets();
    const all = listWorkflowAgentPresets();
    for (const p of all) {
      expect(p.category).toBe('builtin');
      expect(p.isEnabled).toBe(true);
    }
  });

  test('each preset has the expected role', () => {
    seedBuiltinWorkflowAgentPresets();
    const byId = Object.fromEntries(listWorkflowAgentPresets().map((p) => [p.id, p]));
    expect(byId['builtin-worker'].config.role).toBe('worker');
    expect(byId['builtin-researcher'].config.role).toBe('researcher');
    expect(byId['builtin-coder'].config.role).toBe('coder');
    expect(byId['builtin-integration'].config.role).toBe('integration');
  });

  test('each preset has systemPrompt and allowedTools', () => {
    seedBuiltinWorkflowAgentPresets();
    const all = listWorkflowAgentPresets();
    for (const p of all) {
      expect(typeof p.config.systemPrompt).toBe('string');
      expect((p.config.systemPrompt ?? '').length).toBeGreaterThan(0);
      expect(Array.isArray(p.config.allowedTools)).toBe(true);
      expect((p.config.allowedTools ?? []).length).toBeGreaterThan(0);
    }
  });

  test('seed is idempotent (INSERT OR IGNORE)', () => {
    seedBuiltinWorkflowAgentPresets();
    seedBuiltinWorkflowAgentPresets();
    expect(listWorkflowAgentPresets()).toHaveLength(4);
  });

  test('listPublishedWorkflowAgentPresets returns all 4 enabled presets', () => {
    seedBuiltinWorkflowAgentPresets();
    const published = listPublishedWorkflowAgentPresets();
    expect(published).toHaveLength(4);
  });

  test('no table is a no-op', () => {
    db.close();
    db = new Database(':memory:'); // fresh db without templates table
    expect(() => seedBuiltinWorkflowAgentPresets()).not.toThrow();
    expect(listWorkflowAgentPresets()).toHaveLength(0);
  });
});
