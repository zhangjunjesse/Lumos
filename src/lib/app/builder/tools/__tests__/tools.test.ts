import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import { migrateAppTables } from '../../../../db/migrations-app';
import type { ConsentCallback, InstallContext } from '../../../installer';
import { createSoftwareCryptor } from '../../../runtime/secret-cryptor';
import { createSecretVault } from '../../../runtime/secret-vault';
import { createTriggerManager } from '../../../runtime/trigger-manager';

import {
  createGetAppStateTool,
  createInstallAppTool,
  createListCapabilitiesTool,
  createUpdateAppFileTool,
  generateManifestTool,
  generatePageTool,
  generateRoutesTool,
  readSchemaTool,
  validateAppTool,
  resetReadSchemaCache,
} from '..';

const FIXTURES = path.join(__dirname, '../../../manifest/__tests__/fixtures');
const VALID = path.join(FIXTURES, 'valid-form-tool');

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return db;
}

function makeInstallCtx(db: Database.Database, appsRoot: string): InstallContext {
  const cryptor = createSoftwareCryptor(crypto.randomBytes(32));
  const vault = createSecretVault({ db, cryptor });
  const triggers = createTriggerManager(db);
  const grantAll: ConsentCallback = async (req) => ({
    granted: req.permissions.map((p) => p.permission),
  });
  return { db, vault, triggers, appsRootPath: appsRoot, onConsent: grantAll };
}

// ───── read_schema ─────

describe('read_schema', () => {
  beforeEach(() => resetReadSchemaCache());

  it('returns the app schema', async () => {
    const r = await readSchemaTool.execute({ schema: 'app' }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.alias).toBe('app');
    expect(r.data.schema).toMatchObject({ type: 'object' });
  });

  it('rejects unknown alias', async () => {
    const r = await readSchemaTool.execute({ schema: 'bogus' as never }, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('UnknownSchema');
  });

  it('caches across calls', async () => {
    const a = await readSchemaTool.execute({ schema: 'page' }, {});
    const b = await readSchemaTool.execute({ schema: 'page' }, {});
    if (!a.ok || !b.ok) throw new Error('precondition');
    expect(a.data.schema).toBe(b.data.schema);
  });
});

// ───── list_capabilities ─────

describe('list_capabilities', () => {
  it('returns AvailableCapabilities from a fresh db', async () => {
    const db = setupDb();
    try {
      const tool = createListCapabilitiesTool(db);
      const r = await tool.execute({}, {});
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.mcps).toEqual([]);
      expect(r.data.tools).toEqual(['bash', 'python', 'file', 'web-fetch']);
      expect(r.data.workflowExecutionReady).toBe(false);
    } finally {
      db.close();
    }
  });
});

// ───── generate_* ─────

describe('generate_manifest', () => {
  it('accepts a valid manifest', async () => {
    const r = await generateManifestTool.execute(
      {
        value: {
          id: 'demo-app',
          name: 'Demo',
          version: '1.0.0',
          icon: './icon.png',
          entry: 'main',
        },
      },
      {},
    );
    expect(r.ok).toBe(true);
  });

  it('returns SchemaInvalid with issues for bad ids', async () => {
    const r = await generateManifestTool.execute(
      {
        value: {
          id: 'BadId',
          name: 'X',
          version: '1.0.0',
          icon: './icon.png',
          entry: 'home',
        },
      },
      {},
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SchemaInvalid');
    expect(r.issues).toBeDefined();
    expect(r.hint).toContain("read_schema('app')");
  });

  it('rejects non-object input shape', async () => {
    const r = await generateManifestTool.execute(null as never, {});
    expect(r.ok).toBe(false);
  });
});

describe('generate_routes', () => {
  it('rejects routes with both page and component', async () => {
    const r = await generateRoutesTool.execute(
      {
        value: {
          menu: [
            { id: 'x', label: 'X', page: 'pages/x.json', component: 'components/X' },
          ],
          default: 'x',
        },
      },
      {},
    );
    expect(r.ok).toBe(false);
  });
});

describe('generate_page', () => {
  it('rejects unknown layout', async () => {
    const r = await generatePageTool.execute(
      { value: { title: 'X', layout: 'kanban' } },
      {},
    );
    expect(r.ok).toBe(false);
  });

  it('accepts a form layout', async () => {
    const r = await generatePageTool.execute(
      {
        value: {
          title: 'Run',
          layout: 'form',
          form: [{ type: 'textarea', name: 'x', label: 'X', required: true }],
          submit: { label: 'Go', run: 'workflow:run', render: 'markdown' },
        },
      },
      {},
    );
    expect(r.ok).toBe(true);
  });
});

// ───── validate_app ─────

describe('validate_app', () => {
  it('validates an existing fixture directory', async () => {
    const r = await validateAppTool.execute({ rootPath: VALID }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ok).toBe(true);
    expect(r.data.errorCount).toBe(0);
  });

  it('reports errors for an invalid fixture', async () => {
    const r = await validateAppTool.execute(
      { rootPath: path.join(FIXTURES, 'invalid-undeclared-workflow') },
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ok).toBe(false);
    expect(r.data.errorCount).toBeGreaterThan(0);
    expect(r.data.issues.some((i) => i.message.includes('Workflow not found'))).toBe(true);
  });

  it('validates an in-memory file map', async () => {
    const r = await validateAppTool.execute(
      {
        files: {
          'app.json': JSON.stringify({
            id: 'inmem-app',
            name: 'Inmem',
            version: '1.0.0',
            icon: './icon.png',
            entry: 'main',
          }),
          'routes.json': JSON.stringify({
            menu: [{ id: 'main', label: 'Main', page: 'pages/main.json' }],
            default: 'main',
          }),
          'pages/main.json': JSON.stringify({
            title: 'Main',
            layout: 'single',
            blocks: [{ type: 'markdown', content: 'hi' }],
          }),
        },
      },
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ok).toBe(true);
  });

  it('rejects unsafe paths in files map', async () => {
    const r = await validateAppTool.execute(
      {
        files: {
          'app.json': '{}',
          '../etc/passwd': 'pwned',
        },
      },
      {},
    );
    expect(r.ok).toBe(false);
  });

  it('rejects nonexistent rootPath', async () => {
    const r = await validateAppTool.execute({ rootPath: '/no/such/dir' }, {});
    expect(r.ok).toBe(false);
  });
});

// ───── install_app + get_app_state + update_app_file ─────

describe('install_app + get_app_state + update_app_file', () => {
  let tmp: string;
  let appsRoot: string;
  let db: Database.Database;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-tools-'));
    appsRoot = path.join(tmp, 'apps');
    db = setupDb();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('install_app installs from a directory', async () => {
    const tool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    const r = await tool.execute({ rootPath: VALID }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.installed.appId).toBe('weekly-summary');
  });

  it('install_app installs from in-memory files', async () => {
    const tool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    const r = await tool.execute(
      {
        files: {
          'app.json': JSON.stringify({
            id: 'inmem-app',
            name: 'Inmem',
            version: '0.1.0',
            icon: './icon.png',
            entry: 'main',
          }),
          'routes.json': JSON.stringify({
            menu: [{ id: 'main', label: 'Main', page: 'pages/main.json' }],
            default: 'main',
          }),
          'pages/main.json': JSON.stringify({
            title: 'Main',
            layout: 'single',
            blocks: [{ type: 'markdown', content: 'hello' }],
          }),
        },
      },
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.installed.source).toBe('ai-generated');
  });

  it('install_app surfaces install errors with their issues', async () => {
    const tool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    const r = await tool.execute(
      {
        files: {
          'app.json': JSON.stringify({
            id: 'BadId',
            name: 'X',
            version: '1.0',
            icon: './icon.png',
            entry: 'home',
          }),
        },
      },
      {},
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('ManifestInvalid');
  });

  it('get_app_state returns installed=false for unknown app', async () => {
    const tool = createGetAppStateTool(db);
    const r = await tool.execute({ appId: 'nope-app' }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.installed).toBe(false);
    expect(r.data.files).toEqual([]);
  });

  it('get_app_state returns manifest + file listing for an installed app', async () => {
    const installTool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    await installTool.execute({ rootPath: VALID }, {});

    const stateTool = createGetAppStateTool(db);
    const r = await stateTool.execute({ appId: 'weekly-summary' }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.installed).toBe(true);
    expect(r.data.manifest?.id).toBe('weekly-summary');
    expect(r.data.files.some((f) => f.path === 'app.json')).toBe(true);
    const pageFile = r.data.files.find((f) => f.path === 'pages/main.json');
    expect(pageFile?.readable).toBe(true);
    expect(pageFile?.content).toContain('"layout"');
  });

  it('update_app_file rolls back on schema error', async () => {
    const installTool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    await installTool.execute({ rootPath: VALID }, {});

    const updateTool = createUpdateAppFileTool(db);
    const before = fs
      .readFileSync(path.join(appsRoot, 'weekly-summary', '1.0.0', 'pages/main.json'), 'utf-8');

    const r = await updateTool.execute(
      {
        appId: 'weekly-summary',
        path: 'pages/main.json',
        content: JSON.stringify({ title: 'X', layout: 'kanban' }),
      },
      {},
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('SchemaInvalid');

    // Original content must be intact after rollback.
    const after = fs
      .readFileSync(path.join(appsRoot, 'weekly-summary', '1.0.0', 'pages/main.json'), 'utf-8');
    expect(after).toBe(before);
  });

  it('update_app_file commits a valid patch', async () => {
    const installTool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    await installTool.execute({ rootPath: VALID }, {});

    const updateTool = createUpdateAppFileTool(db);
    const newPage = JSON.stringify({
      title: 'New title',
      layout: 'form',
      form: [{ type: 'textarea', name: 'completed', label: '本周完成' }],
      submit: { label: '生成', run: 'workflow:generate-report', render: 'markdown' },
    });
    const r = await updateTool.execute(
      { appId: 'weekly-summary', path: 'pages/main.json', content: newPage },
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.written).toBe(true);
    const onDisk = fs.readFileSync(
      path.join(appsRoot, 'weekly-summary', '1.0.0', 'pages/main.json'),
      'utf-8',
    );
    expect(onDisk).toContain('"New title"');
  });

  it('update_app_file dryRun does not write', async () => {
    const installTool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    await installTool.execute({ rootPath: VALID }, {});

    const updateTool = createUpdateAppFileTool(db);
    const before = fs.readFileSync(
      path.join(appsRoot, 'weekly-summary', '1.0.0', 'pages/main.json'),
      'utf-8',
    );

    const newPage = JSON.stringify({
      title: 'X',
      layout: 'single',
      blocks: [{ type: 'markdown', content: 'changed' }],
    });
    const r = await updateTool.execute(
      {
        appId: 'weekly-summary',
        path: 'pages/main.json',
        content: newPage,
        dryRun: true,
      },
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.written).toBe(false);

    const after = fs.readFileSync(
      path.join(appsRoot, 'weekly-summary', '1.0.0', 'pages/main.json'),
      'utf-8',
    );
    expect(after).toBe(before);
  });

  it('update_app_file rejects components/ paths (M6+ reserved)', async () => {
    const installTool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    await installTool.execute({ rootPath: VALID }, {});

    const updateTool = createUpdateAppFileTool(db);
    const r = await updateTool.execute(
      {
        appId: 'weekly-summary',
        path: 'components/Whiteboard.tsx',
        content: 'export default function() {}',
      },
      {},
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('TopDirRejected');
  });

  it('update_app_file rejects unsafe paths', async () => {
    const installTool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    await installTool.execute({ rootPath: VALID }, {});

    const updateTool = createUpdateAppFileTool(db);
    const r = await updateTool.execute(
      {
        appId: 'weekly-summary',
        path: '../etc/passwd',
        content: 'pwned',
      },
      {},
    );
    expect(r.ok).toBe(false);
  });

  it('update_app_file returns NotInstalled for unknown app', async () => {
    const updateTool = createUpdateAppFileTool(db);
    const r = await updateTool.execute(
      {
        appId: 'nope-app',
        path: 'pages/x.json',
        content: '{}',
      },
      {},
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NotInstalled');
  });
});
