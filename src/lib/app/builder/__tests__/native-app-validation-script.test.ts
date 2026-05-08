import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildTemplateBlueprintFiles } from '../templates';
import type { BuilderSession } from '../session';

const SCRIPT = path.join(process.cwd(), 'scripts/validate-native-app.mjs');

function materialize(files: Record<string, string>, rootPath: string): void {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(rootPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

function runValidator(appDir: string) {
  return spawnSync(process.execPath, [SCRIPT, appDir, '--json'], {
    encoding: 'utf-8',
  });
}

describe('validate-native-app script', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-native-validator-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('accepts the Goofish native-grade starter package', () => {
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
    expect(files).toBeTruthy();
    materialize(files ?? {}, tmp);

    const result = runValidator(tmp);
    expect(result.status).toBe(0);
    const json = JSON.parse(result.stdout) as { ok: boolean; errorCount: number };
    expect(json).toMatchObject({ ok: true, errorCount: 0 });
  });

  it('rejects ordinary packages without the native-grade contract', () => {
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
      id: 'ordinary-demo',
      name: '普通 Demo',
    }, null, 2));

    const result = runValidator(tmp);
    expect(result.status).toBe(1);
    const json = JSON.parse(result.stdout) as {
      ok: boolean;
      issues: Array<{ file: string; message: string }>;
    };
    expect(json.ok).toBe(false);
    const messages = json.issues.map((issue) => `${issue.file}: ${issue.message}`).join('\n');
    expect(messages).toContain('manifest.json');
    expect(messages).toContain('native-app-spec.json');
  });
});
