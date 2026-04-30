import crypto from 'crypto';

import Database from 'better-sqlite3';

import { migrateAppTables } from '../../../db/migrations-app';
import {
  BindingError,
  renderTemplate,
  resolveBindingExpression,
  resolveSingleBinding,
} from '../binding-resolver';
import { createAppDataStore } from '../data-store';
import { createSoftwareCryptor } from '../secret-cryptor';
import { createSecretVault } from '../secret-vault';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  db.prepare(
    `INSERT INTO lumos_app_apps (id, name, version, manifest_json, source, install_path, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run('app-one', 'A', '1.0.0', '{}', 'ai-generated', '/tmp/app-one', Date.now());
  const cryptor = createSoftwareCryptor(crypto.randomBytes(32));
  const vault = createSecretVault({ db, cryptor });
  const dataStore = createAppDataStore(db, 'app-one');
  return { db, vault, dataStore };
}

describe('resolveBindingExpression — inputs', () => {
  it('returns dotted-path value', () => {
    expect(
      resolveBindingExpression('inputs.completed', {
        inputs: { completed: 'x', next: 'y' },
      }),
    ).toBe('x');
  });

  it('returns nested values', () => {
    expect(
      resolveBindingExpression('inputs.detail.id', {
        inputs: { detail: { id: '42' } },
      }),
    ).toBe('42');
  });

  it('returns undefined for missing keys', () => {
    expect(resolveBindingExpression('inputs.missing', { inputs: {} })).toBeUndefined();
  });
});

describe('resolveBindingExpression — config', () => {
  it('reads from the secret vault', () => {
    const { vault } = setup();
    vault.set('app-one', 'feishu_token', 'secret123', { secret: true });
    expect(
      resolveBindingExpression('config.feishu_token', { vault, appId: 'app-one' }),
    ).toBe('secret123');
  });

  it('throws when vault is not provided', () => {
    expect(() =>
      resolveBindingExpression('config.x', { appId: 'app-one' }),
    ).toThrow(BindingError);
  });

  it('throws on multi-segment config', () => {
    const { vault } = setup();
    expect(() =>
      resolveBindingExpression('config.a.b', { vault, appId: 'app-one' }),
    ).toThrow(/config\.<key>/);
  });
});

describe('resolveBindingExpression — db', () => {
  it('returns all rows for a collection', () => {
    const { dataStore } = setup();
    dataStore.create('customers', { id: 'a', name: 'A' });
    dataStore.create('customers', { id: 'b', name: 'B' });
    const rows = resolveBindingExpression('db.customers', { dataStore }) as Array<{
      id: string;
    }>;
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('returns count', () => {
    const { dataStore } = setup();
    dataStore.create('customers', { id: 'a', name: 'A' });
    dataStore.create('customers', { id: 'b', name: 'B' });
    expect(resolveBindingExpression('db.customers.count', { dataStore })).toBe(2);
  });

  it('rejects unsupported methods', () => {
    const { dataStore } = setup();
    expect(() =>
      resolveBindingExpression("db.customers.where", { dataStore }),
    ).toThrow(/unsupported db method/);
  });

  it('throws when dataStore not provided', () => {
    expect(() => resolveBindingExpression('db.customers', {})).toThrow(BindingError);
  });
});

describe('resolveBindingExpression — user / steps', () => {
  it('reads user dotted paths', () => {
    expect(
      resolveBindingExpression('user.name', { user: { name: 'Alice' } }),
    ).toBe('Alice');
  });

  it('reads step output', () => {
    const value = resolveBindingExpression('steps.write.output', {
      steps: { write: { output: 'hello' } },
    });
    expect(value).toBe('hello');
  });

  it('returns undefined for missing step', () => {
    expect(resolveBindingExpression('steps.missing.output', { steps: {} })).toBeUndefined();
  });
});

describe('resolveBindingExpression — invalid', () => {
  it('rejects empty expression', () => {
    expect(() => resolveBindingExpression('', {})).toThrow(BindingError);
    expect(() => resolveBindingExpression('   ', {})).toThrow(BindingError);
  });

  it('rejects unknown namespace', () => {
    expect(() => resolveBindingExpression('foo.bar', {})).toThrow(/unknown namespace/);
  });

  it('rejects non-identifier segments (e.g. method calls)', () => {
    expect(() =>
      resolveBindingExpression("db.customers.where('status','active')", {}),
    ).toThrow(/invalid path segment/);
  });

  it('rejects path that descends into a primitive', () => {
    expect(() =>
      resolveBindingExpression('inputs.x.y', { inputs: { x: 'string' } }),
    ).toThrow(/non-object/);
  });
});

describe('renderTemplate', () => {
  it('replaces multiple bindings', () => {
    const out = renderTemplate(
      'hello {{ user.name }}, you have {{ db.customers.count }} customers',
      { user: { name: 'Alice' }, dataStore: setup().dataStore },
    );
    expect(out).toBe('hello Alice, you have 0 customers');
  });

  it('coerces numbers and booleans', () => {
    expect(renderTemplate('{{ inputs.n }} / {{ inputs.b }}', {
      inputs: { n: 42, b: true },
    })).toBe('42 / true');
  });

  it('renders missing values as empty strings', () => {
    expect(renderTemplate('a={{ inputs.missing }}.', { inputs: {} })).toBe('a=.');
  });

  it('JSON-stringifies arrays and objects', () => {
    expect(renderTemplate('{{ inputs.x }}', { inputs: { x: [1, 2, 3] } })).toBe(
      '[1,2,3]',
    );
  });

  it('leaves non-binding text intact', () => {
    expect(renderTemplate('plain text only', {})).toBe('plain text only');
  });

  it('whitespace inside {{ }} is tolerated', () => {
    expect(renderTemplate('{{   inputs.x   }}', { inputs: { x: 'ok' } })).toBe('ok');
  });
});

describe('resolveSingleBinding', () => {
  it('returns the raw value for a sole-binding template', () => {
    const { dataStore } = setup();
    dataStore.create('customers', { id: 'a', name: 'A' });
    const r = resolveSingleBinding('{{ db.customers }}', { dataStore });
    expect(r.isSingle).toBe(true);
    if (!r.isSingle) return;
    expect(Array.isArray(r.value)).toBe(true);
  });

  it('reports non-single when the template has surrounding text', () => {
    const r = resolveSingleBinding('hello {{ inputs.x }}', { inputs: { x: 'world' } });
    expect(r.isSingle).toBe(false);
  });

  it('reports non-single for plain strings', () => {
    expect(resolveSingleBinding('plain', {}).isSingle).toBe(false);
  });
});
