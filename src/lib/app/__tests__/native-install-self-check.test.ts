import fs from 'fs';
import os from 'os';
import path from 'path';

import Database from 'better-sqlite3';

import { migrateAppTables } from '@/lib/db/migrations-app';

import { buildTemplateBlueprintFiles } from '../builder/templates';
import { recordNativeInstallSelfCheck } from '../native-install-self-check';
import type { BuilderSession } from '../builder/session';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateAppTables(db);
  return db;
}

function materialize(files: Record<string, string>): { rootPath: string; cleanup: () => void } {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-native-self-check-'));
  for (const [rel, content] of Object.entries(files)) {
    const fullPath = path.join(rootPath, rel);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  fs.writeFileSync(path.join(rootPath, 'icon.png'), 'PNG_PLACEHOLDER');
  return {
    rootPath,
    cleanup: () => fs.rmSync(rootPath, { recursive: true, force: true }),
  };
}

function goofishSession(): BuilderSession {
  return {
    id: 'bs_goofishselfcheck',
    status: 'gathering',
    appName: '闲鱼助手',
    appDescription: '帮用户回复闲鱼消息，管理商品，并通过微信 IM 通知。',
    templateId: 'goofish-assistant',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('recordNativeInstallSelfCheck', () => {
  it('writes a successful run_history evidence row for a native-grade generated app', () => {
    const db = makeDb();
    const files = buildTemplateBlueprintFiles(goofishSession(), 'goofish-assistant', {
      now: 1714470000000,
    });
    expect(files).toBeTruthy();
    const app = JSON.parse(files?.['app.json'] ?? '{}') as { id: string };
    const { rootPath, cleanup } = materialize(files ?? {});

    try {
      const result = recordNativeInstallSelfCheck(db, {
        appId: app.id,
        installPath: rootPath,
        now: 1714470000000,
      });

      expect(result.status).toBe('success');
      expect(result.failures).toEqual([]);
      expect(result.checked).toEqual(expect.arrayContaining([
        'app.json 存在',
        '内置级规格有效',
        '通用页面入口齐全',
        '规格声明的数据集合已落到 data-schema',
        '通用集合字段可支撑内置级运行',
        '应用隔离数据读写可用',
        '状态页包含重新自检入口',
        '自动化页包含手动运行和定时同步入口',
        '通知命令页包含命令测试入口',
        '通知命令页包含通用 /app 只读命令说明',
        '通知命令页覆盖规格声明的低风险命令',
        '闲鱼会话页包含草稿生成入口',
        '回复草稿页包含发送和拒绝入口',
        '验收清单包含安装自检项',
      ]));

      const row = db
        .prepare(
          `SELECT data_json FROM lumos_app_data
           WHERE app_id = ? AND collection = 'run_history' AND id = ?`,
        )
        .get(app.id, result.runId) as { data_json: string } | undefined;
      expect(row).toBeTruthy();
      expect(JSON.parse(row?.data_json ?? '{}')).toMatchObject({
        title: '安装自检',
        status: 'success',
        summary: expect.stringContaining('安装自检通过'),
      });
      const acceptanceRow = db
        .prepare(
          `SELECT data_json FROM lumos_app_data
           WHERE app_id = ? AND collection = 'acceptance_checks' AND id = 'installation-self-check'`,
        )
        .get(app.id) as { data_json: string } | undefined;
      expect(JSON.parse(acceptanceRow?.data_json ?? '{}')).toMatchObject({
        acceptance_id: 'installation-self-check',
        done: true,
        status: 'passed',
        evidence_run_id: result.runId,
        evidence: expect.stringContaining('安装自检通过'),
      });
    } finally {
      cleanup();
      db.close();
    }
  });

  it('records failure evidence when the native app spec is missing', () => {
    const db = makeDb();
    const files = buildTemplateBlueprintFiles(goofishSession(), 'goofish-assistant', {
      now: 1714470000000,
    });
    expect(files).toBeTruthy();
    const withoutSpec = { ...(files ?? {}) };
    delete withoutSpec['native-app-spec.json'];
    const app = JSON.parse(withoutSpec['app.json'] ?? '{}') as { id: string };
    const { rootPath, cleanup } = materialize(withoutSpec);

    try {
      const result = recordNativeInstallSelfCheck(db, {
        appId: app.id,
        installPath: rootPath,
        now: 1714470000001,
      });

      expect(result.status).toBe('failed');
      expect(result.failures.join('\n')).toContain('native-app-spec.json 存在');
      expect(result.failures.join('\n')).toContain('缺少内置级应用规格');

      const row = db
        .prepare(
          `SELECT data_json FROM lumos_app_data
           WHERE app_id = ? AND collection = 'run_history' AND id = ?`,
        )
        .get(app.id, result.runId) as { data_json: string } | undefined;
      expect(JSON.parse(row?.data_json ?? '{}')).toMatchObject({
        title: '安装自检',
        status: 'failed',
        failure_reason: expect.stringContaining('native-app-spec'),
      });
      const acceptanceRow = db
        .prepare(
          `SELECT data_json FROM lumos_app_data
           WHERE app_id = ? AND collection = 'acceptance_checks' AND id = 'installation-self-check'`,
        )
        .get(app.id) as { data_json: string } | undefined;
      expect(JSON.parse(acceptanceRow?.data_json ?? '{}')).toMatchObject({
        acceptance_id: 'installation-self-check',
        done: false,
        status: 'failed',
        evidence_run_id: result.runId,
        failure_reason: expect.stringContaining('native-app-spec'),
      });
    } finally {
      cleanup();
      db.close();
    }
  });

  it('records failure evidence when native-grade action entries are missing', () => {
    const db = makeDb();
    const files = buildTemplateBlueprintFiles(goofishSession(), 'goofish-assistant', {
      now: 1714470000000,
    });
    expect(files).toBeTruthy();
    const broken = { ...(files ?? {}) };
    broken['pages/automations.json'] = broken['pages/automations.json']
      .replace('native:app:sync-automation-schedule', 'native:app:missing-schedule');
    const app = JSON.parse(broken['app.json'] ?? '{}') as { id: string };
    const { rootPath, cleanup } = materialize(broken);

    try {
      const result = recordNativeInstallSelfCheck(db, {
        appId: app.id,
        installPath: rootPath,
        now: 1714470000002,
      });

      expect(result.status).toBe('failed');
      expect(result.failures.join('\n')).toContain('自动化页包含手动运行和定时同步入口');
      expect(result.failures.join('\n')).toContain('native:app:sync-automation-schedule');

      const row = db
        .prepare(
          `SELECT data_json FROM lumos_app_data
           WHERE app_id = ? AND collection = 'run_history' AND id = ?`,
        )
        .get(app.id, result.runId) as { data_json: string } | undefined;
      expect(JSON.parse(row?.data_json ?? '{}')).toMatchObject({
        title: '安装自检',
        status: 'failed',
        failure_reason: expect.stringContaining('同步入口'),
      });
    } finally {
      cleanup();
      db.close();
    }
  });

  it('fails when the IM page omits the external /app read command guidance', () => {
    const db = makeDb();
    const files = buildTemplateBlueprintFiles(goofishSession(), 'goofish-assistant', {
      now: 1714470000000,
    });
    expect(files).toBeTruthy();
    const broken = { ...(files ?? {}) };
    broken['pages/im.json'] = broken['pages/im.json']
      .replaceAll('/app', '/external-app-command-removed')
      .replaceAll('acceptance', 'acceptance-removed')
      .replaceAll('runs', 'runs-removed');
    const app = JSON.parse(broken['app.json'] ?? '{}') as { id: string };
    const { rootPath, cleanup } = materialize(broken);

    try {
      const result = recordNativeInstallSelfCheck(db, {
        appId: app.id,
        installPath: rootPath,
        now: 1714470000004,
      });

      expect(result.status).toBe('failed');
      expect(result.failures.join('\n')).toContain('通知命令页包含通用 /app 只读命令说明');
      expect(result.failures.join('\n')).toContain('/app status / runs / acceptance / help');
    } finally {
      cleanup();
      db.close();
    }
  });

  it('fails when the IM page omits low-risk commands declared by the native spec', () => {
    const db = makeDb();
    const files = buildTemplateBlueprintFiles(goofishSession(), 'goofish-assistant', {
      now: 1714470000000,
    });
    expect(files).toBeTruthy();
    const broken = { ...(files ?? {}) };
    broken['pages/im.json'] = broken['pages/im.json']
      .replaceAll('/goofish confirm', '/goofish-confirm-removed')
      .replaceAll('/goofish reject', '/goofish-reject-removed');
    const app = JSON.parse(broken['app.json'] ?? '{}') as { id: string };
    const { rootPath, cleanup } = materialize(broken);

    try {
      const result = recordNativeInstallSelfCheck(db, {
        appId: app.id,
        installPath: rootPath,
        now: 1714470000006,
      });

      expect(result.status).toBe('failed');
      expect(result.failures.join('\n')).toContain('通知命令页覆盖规格声明的低风险命令');
      expect(result.failures.join('\n')).toContain('/goofish confirm <draft>');
      expect(result.failures.join('\n')).toContain('/goofish reject <draft>');
    } finally {
      cleanup();
      db.close();
    }
  });

  it('fails when the native acceptance checklist omits the installation self-check item', () => {
    const db = makeDb();
    const files = buildTemplateBlueprintFiles(goofishSession(), 'goofish-assistant', {
      now: 1714470000000,
    });
    expect(files).toBeTruthy();
    const broken = { ...(files ?? {}) };
    const spec = JSON.parse(broken['native-app-spec.json'] ?? '{}') as {
      acceptance?: Array<{ id?: string }>;
    };
    spec.acceptance = (spec.acceptance ?? []).filter((item) => item.id !== 'installation-self-check');
    broken['native-app-spec.json'] = `${JSON.stringify(spec, null, 2)}\n`;
    const app = JSON.parse(broken['app.json'] ?? '{}') as { id: string };
    const { rootPath, cleanup } = materialize(broken);

    try {
      const result = recordNativeInstallSelfCheck(db, {
        appId: app.id,
        installPath: rootPath,
        now: 1714470000005,
      });

      expect(result.status).toBe('failed');
      expect(result.failures.join('\n')).toContain('验收清单包含安装自检项');
      expect(result.failures.join('\n')).toContain('installation-self-check');
    } finally {
      cleanup();
      db.close();
    }
  });

  it('fails explicitly when the app data runtime table is unavailable', () => {
    const db = new Database(':memory:');
    const files = buildTemplateBlueprintFiles(goofishSession(), 'goofish-assistant', {
      now: 1714470000000,
    });
    expect(files).toBeTruthy();
    const app = JSON.parse(files?.['app.json'] ?? '{}') as { id: string };
    const { rootPath, cleanup } = materialize(files ?? {});

    try {
      const result = recordNativeInstallSelfCheck(db, {
        appId: app.id,
        installPath: rootPath,
        now: 1714470000003,
      });

      expect(result.status).toBe('failed');
      expect(result.failures.join('\n')).toContain('应用隔离数据读写可用');
      expect(result.failures.join('\n')).toContain('lumos_app_data');
    } finally {
      cleanup();
      db.close();
    }
  });
});
