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
import type { BuilderSession } from '../../session';
import { buildTemplateBlueprintFiles } from '../../templates';

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

const NATIVE_SPEC = `${JSON.stringify({
  version: 1,
  summary: 'Weekly Summary：保存周报输入、生成结果和运行状态。',
  userVisibleScope: [
    '打开应用首页查看周报表单。',
    '填写周报内容并保存。',
    '查看运行结果和失败原因。',
  ],
  status: {
    states: ['not_configured', 'ready', 'running', 'failed', 'not_connected'],
    readyCriteria: ['应用页面可打开。'],
    notConnectedBehavior: '缺少底层能力时显示未接入或失败原因。',
  },
  settings: [
    {
      id: 'general',
      label: '基础设置',
      fields: ['默认视图'],
    },
  ],
  data: {
    entities: [
      'app_settings',
      'app_automations',
      'run_history',
      'assistant_messages',
      'app_notifications',
      'app_command_runs',
      'acceptance_checks',
    ],
    reusableStores: ['settings', 'run_history'],
  },
  ai: {
    enabled: false,
    promptSettings: false,
    draftBeforeWrite: true,
    visibleFailureHandling: true,
  },
  automations: {
    enabled: false,
    controls: ['run_now', 'edit', 'delete'],
    visibleRunResults: true,
  },
  runResults: {
    visible: true,
    states: ['running', 'success', 'failed', 'cancelled'],
    failureReasons: true,
    retry: true,
  },
  im: {
    enabled: false,
    lowRiskCommands: [],
    confirmationRequiredFor: ['所有写操作'],
    visibleCommandResults: true,
  },
  risk: {
    writeActionsRequireConfirmation: true,
    highRiskActions: ['覆盖已有记录'],
    outOfScope: ['未确认的外部发送'],
  },
  acceptance: [
    {
      id: 'installation-self-check',
      label: '安装自检',
      howToVerify: '安装后查看自检结果。',
    },
    { id: 'open-main', label: '打开首页', howToVerify: '进入应用后看到首页。' },
    { id: 'submit-form', label: '提交表单', howToVerify: '填写并提交表单。' },
    { id: 'review-result', label: '查看结果', howToVerify: '查看运行结果。' },
    { id: 'review-failure', label: '查看失败原因', howToVerify: '失败时能看到原因。' },
  ],
}, null, 2)}\n`;

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

function makeNativeFixture(rootPath: string): string {
  const nativeRoot = path.join(rootPath, 'native-valid-form-tool');
  fs.cpSync(VALID, nativeRoot, { recursive: true });
  fs.writeFileSync(path.join(nativeRoot, 'native-app-spec.json'), NATIVE_SPEC);
  fs.writeFileSync(path.join(nativeRoot, 'routes.json'), JSON.stringify({
    menu: [
      { id: 'main', label: '生成', icon: 'edit', page: 'pages/main.json' },
      { id: 'status', label: '状态', icon: 'activity', page: 'pages/status.json' },
      { id: 'settings', label: '设置', icon: 'settings', page: 'pages/settings.json' },
      { id: 'automations', label: '自动化', icon: 'timer', page: 'pages/automations.json' },
      { id: 'im', label: '通知命令', icon: 'message-circle', page: 'pages/im.json' },
      { id: 'run-history', label: '运行结果', icon: 'list-checks', page: 'pages/run-history.json' },
    ],
    default: 'main',
  }, null, 2));
  fs.writeFileSync(path.join(nativeRoot, 'data-schema.json'), JSON.stringify({
    collections: [
      collection('app_settings', ['ai_system_prompt', 'risk_note']),
      collection('app_automations', ['native_action', 'last_run_id', 'schedule_id', 'schedule_status', 'schedule_error', 'next_run_at']),
      collection('run_history', ['status', 'summary', 'failure_reason']),
      collection('assistant_messages', ['role', 'text']),
      collection('app_notifications', ['channel', 'status', 'last_error', 'last_message_id']),
      collection('app_command_runs', ['command', 'risk_level', 'confirmation_required', 'last_run_id']),
      collection('acceptance_checks', ['acceptance_id', 'done', 'status', 'evidence', 'failure_reason', 'evidence_run_id']),
    ],
  }, null, 2));
  fs.writeFileSync(path.join(nativeRoot, 'pages/status.json'), JSON.stringify({ title: '状态', layout: 'single', blocks: [{ type: 'button', label: '重新运行安装自检', run: 'native:app:run-self-check' }] }, null, 2));
  fs.writeFileSync(path.join(nativeRoot, 'pages/settings.json'), JSON.stringify({ title: '设置', layout: 'single', blocks: [{ type: 'markdown', content: 'ai_system_prompt risk_note' }] }, null, 2));
  fs.writeFileSync(path.join(nativeRoot, 'pages/automations.json'), JSON.stringify({ title: '自动化', layout: 'single', blocks: [{ type: 'button', label: '立即运行', run: 'native:app:run-automation' }, { type: 'button', label: '同步定时任务', run: 'native:app:sync-automation-schedule' }] }, null, 2));
  fs.writeFileSync(path.join(nativeRoot, 'pages/im.json'), JSON.stringify({ title: '通知命令', layout: 'single', blocks: [{ type: 'button', label: '测试命令', run: 'native:app:run-command' }, { type: 'markdown', content: '/app <应用名或ID> status runs acceptance help' }] }, null, 2));
  fs.writeFileSync(path.join(nativeRoot, 'pages/run-history.json'), JSON.stringify({ title: '运行结果', layout: 'single', blocks: [{ type: 'markdown', content: 'failure_reason' }] }, null, 2));
  return nativeRoot;
}

function collection(name: string, fields: string[]) {
  return {
    name,
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      ...fields.map((field) => ({ name: field, type: field === 'done' ? 'boolean' : 'string' })),
    ],
  };
}

function makeGoofishNativeFiles(): Record<string, string> {
  const session: BuilderSession = {
    id: 'bs_goofish123456',
    status: 'demo_review',
    appName: '闲鱼助手',
    appDescription: '帮用户回复闲鱼消息，管理商品，并通过微信 IM 通知。',
    templateId: 'goofish-assistant',
    createdAt: 0,
    updatedAt: 0,
  };
  const files = buildTemplateBlueprintFiles(session, 'goofish-assistant', {
    now: 1714470000000,
  });
  if (!files) throw new Error('expected goofish native files');
  return files;
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

  it('returns the native-grade app spec schema', async () => {
    const r = await readSchemaTool.execute({ schema: 'native-app-spec' }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.alias).toBe('native-app-spec');
    expect(r.data.filename).toBe('native-app-spec.schema.json');
    expect(r.data.schema).toMatchObject({
      title: 'Lumos Native-grade App Spec',
      required: expect.arrayContaining(['status', 'acceptance']),
    });
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
      expect(r.data.nativeIntegrations.map((item) => item.id)).toContain('goofish');
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

  it('passes native-grade package validation for the Goofish starter', async () => {
    const r = await validateAppTool.execute(
      { files: makeGoofishNativeFiles(), nativeGrade: true },
      {},
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ok).toBe(true);
    expect(r.data.errorCount).toBe(0);
  });

  it('rejects ordinary packages when nativeGrade is required', async () => {
    const r = await validateAppTool.execute(
      {
        nativeGrade: true,
        files: {
          'app.json': JSON.stringify({
            id: 'ordinary-demo',
            name: 'Ordinary',
            version: '1.0.0',
            icon: './icon.png',
            entry: 'main',
            permissions: { data: 'isolated' },
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
    expect(r.data.ok).toBe(false);
    const messages = r.data.issues.map((issue) => `${issue.file}: ${issue.message}`).join('\n');
    expect(messages).toContain('native-app-spec.json');
    expect(messages).toContain('缺少内置级通用菜单 status');
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
  let nativeValid: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-tools-'));
    appsRoot = path.join(tmp, 'apps');
    db = setupDb();
    nativeValid = makeNativeFixture(tmp);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('install_app installs from a directory', async () => {
    const tool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    const r = await tool.execute({ rootPath: nativeValid }, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.installed.appId).toBe('weekly-summary');
  });

  it('install_app installs from in-memory files', async () => {
    const tool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    const r = await tool.execute(
      { files: makeGoofishNativeFiles() },
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
    const brokenRoot = path.join(tmp, 'broken-native-valid-form-tool');
    fs.cpSync(nativeValid, brokenRoot, { recursive: true });
    const appJsonPath = path.join(brokenRoot, 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8')) as { id: string };
    appJson.id = 'BadId';
    fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));

    const r = await tool.execute({ rootPath: brokenRoot }, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('ManifestInvalid');
  });

  it('install_app rejects packages without a native-grade spec', async () => {
    const tool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
    });
    const r = await tool.execute({ rootPath: VALID }, {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NativeSpecInvalid');
    expect(r.issues?.map((issue) => issue.message).join('\n')).toContain('缺少内置级应用规格');
  });

  it('install_app rejects when the current native spec has not been accepted', async () => {
    const tool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
      nativeSpecReview: () => ({
        review: { status: 'pending' },
        artifactVersion: 1,
      }),
    });
    const r = await tool.execute({ rootPath: nativeValid }, { sessionId: 'bs_test' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('NativeSpecReviewRequired');
    expect(r.hint).toContain('接受当前内置级规格');
    expect(fs.existsSync(path.join(appsRoot, 'weekly-summary'))).toBe(false);
  });

  it('install_app accepts a session-bound native spec review for the current artifact version', async () => {
    const tool = createInstallAppTool({
      installContext: () => makeInstallCtx(db, appsRoot),
      nativeSpecReview: () => ({
        review: { status: 'accepted', artifactVersion: 1 },
        artifactVersion: 1,
      }),
    });
    const r = await tool.execute({ rootPath: nativeValid }, { sessionId: 'bs_test' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.installed.appId).toBe('weekly-summary');
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
    await installTool.execute({ rootPath: nativeValid }, {});

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
    await installTool.execute({ rootPath: nativeValid }, {});

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
    await installTool.execute({ rootPath: nativeValid }, {});

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
    await installTool.execute({ rootPath: nativeValid }, {});

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
    await installTool.execute({ rootPath: nativeValid }, {});

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
    await installTool.execute({ rootPath: nativeValid }, {});

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
