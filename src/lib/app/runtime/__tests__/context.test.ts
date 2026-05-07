import crypto from 'crypto';

import Database from 'better-sqlite3';

import { migrateAppTables } from '../../../db/migrations-app';
import type { AppManifest } from '../../manifest/types';
import { buildAppRunContext } from '../context';
import { PermissionDeniedError } from '../permission-gate';
import { createSoftwareCryptor } from '../secret-cryptor';
import { createSecretVault } from '../secret-vault';

const APP_ID = 'demo-app';
const MANIFEST: AppManifest = {
  id: APP_ID,
  name: 'Demo',
  version: '1.0.0',
  icon: './icon.png',
  entry: 'main',
  requires: { mcp: ['feishu'] },
};

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  const now = Date.now();
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(APP_ID, APP_ID, '1.0.0', JSON.stringify(MANIFEST), 'ai-generated', '/tmp', now);
  // Grant feishu MCP for tests.
  db.prepare(
    `INSERT INTO lumos_app_permissions (app_id, permission, granted, granted_at)
     VALUES (?, ?, ?, ?)`,
  ).run(APP_ID, 'mcp:feishu', 1, now);
  const cryptor = createSoftwareCryptor(crypto.randomBytes(32));
  const vault = createSecretVault({ db, cryptor });
  return { db, vault };
}

describe('buildAppRunContext', () => {
  it('exposes appId, pageId, runId, inputs, user', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({
      db,
      vault,
      appId: APP_ID,
      manifest: MANIFEST,
      pageId: 'home',
      runId: 'run_42',
      inputs: { x: 1 },
      user: { id: 'u1' },
    });
    expect(ctx.appId).toBe(APP_ID);
    expect(ctx.pageId).toBe('home');
    expect(ctx.runId).toBe('run_42');
    expect(ctx.inputs.x).toBe(1);
    expect(ctx.user.id).toBe('u1');
  });

  it('inputs and user default to empty objects', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({ db, vault, appId: APP_ID, manifest: MANIFEST });
    expect(ctx.inputs).toEqual({});
    expect(ctx.user).toEqual({});
  });

  it('exposes a permission gate built from lumos_app_permissions', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({ db, vault, appId: APP_ID, manifest: MANIFEST });
    expect(ctx.gate.canCallMcp('feishu')).toBe(true);
    expect(ctx.gate.canCallMcp('other')).toBe(false);
    expect(() => ctx.gate.requireOrThrow('mcp:other')).toThrow(PermissionDeniedError);
  });

  it('exposes an isolated data store', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({ db, vault, appId: APP_ID, manifest: MANIFEST });
    ctx.dataStore.create('items', { id: 'a', name: 'A' });
    expect(ctx.dataStore.query('items').map((r) => r.id)).toEqual(['a']);
    // Confirm by raw SQL it landed under the right app_id.
    const row = db
      .prepare('SELECT app_id FROM lumos_app_data WHERE id = ?')
      .get('a') as { app_id: string };
    expect(row.app_id).toBe(APP_ID);
  });
});

describe('AppRunContext — bindings', () => {
  it('renderTemplate uses inputs and config', () => {
    const { db, vault } = setup();
    vault.set(APP_ID, 'token', 'XYZ', { secret: true });
    const ctx = buildAppRunContext({
      db,
      vault,
      appId: APP_ID,
      manifest: MANIFEST,
      inputs: { name: 'Alice' },
    });
    const out = ctx.renderTemplate('Hello {{ inputs.name }}, token={{ config.token }}');
    expect(out).toBe('Hello Alice, token=XYZ');
  });

  it('resolveBinding returns raw values', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({
      db,
      vault,
      appId: APP_ID,
      manifest: MANIFEST,
      inputs: { count: 42 },
    });
    expect(ctx.resolveBinding('inputs.count')).toBe(42);
  });

  it('resolveProp returns the raw value for a sole-binding template', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({
      db,
      vault,
      appId: APP_ID,
      manifest: MANIFEST,
    });
    ctx.dataStore.create('items', { id: 'a' });
    const value = ctx.resolveProp('{{ db.items }}');
    expect(Array.isArray(value)).toBe(true);
    expect((value as Array<unknown>).length).toBe(1);
  });

  it('resolveProp falls back to string render with mixed templates', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({
      db,
      vault,
      appId: APP_ID,
      manifest: MANIFEST,
      inputs: { x: 'world' },
    });
    expect(ctx.resolveProp('hello {{ inputs.x }}')).toBe('hello world');
  });

  it('recordStepOutput makes the value available to subsequent bindings', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({ db, vault, appId: APP_ID, manifest: MANIFEST });
    ctx.recordStepOutput('write', 'the report content');
    expect(ctx.resolveBinding('steps.write.output')).toBe('the report content');
    expect(ctx.renderTemplate('result: {{ steps.write.output }}')).toBe(
      'result: the report content',
    );
  });

  it('binding context reflects mutations to step outputs', () => {
    const { db, vault } = setup();
    const ctx = buildAppRunContext({ db, vault, appId: APP_ID, manifest: MANIFEST });
    const a = ctx.bindingContext();
    expect(a.steps).toEqual({});
    ctx.recordStepOutput('s1', 'hello');
    const b = ctx.bindingContext();
    expect(b.steps).toEqual({ s1: { output: 'hello' } });
  });
});
