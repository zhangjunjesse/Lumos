import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { buildTemplateBlueprintFiles } from '../templates';
import { buildEcommerceAssistantFiles } from '../template-ecommerce-assistant';
import type { BuilderSession } from '../session';

const SCRIPT = path.join(process.cwd(), 'scripts/validate-native-app.mjs');

function materialize(files: Record<string, string>, rootPath: string): void {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(rootPath, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
}

describe('template-ecommerce-assistant', () => {
  const session: BuilderSession = {
    id: 'bs_ecommerce_test',
    status: 'demo_review',
    appName: '电商商品助手',
    appDescription: '一键生成电商商品图、识别商品资料、批量出图、风格预设和场景方向调整。',
    templateId: 'ecommerce-assistant',
    createdAt: 0,
    updatedAt: 0,
  };

  it('exports the template through buildTemplateBlueprintFiles', () => {
    const files = buildTemplateBlueprintFiles(session, 'ecommerce-assistant', {
      now: 1714470000000,
    });
    expect(files).toBeTruthy();
    const keys = Object.keys(files ?? {});
    for (const required of [
      'app.json',
      'native-app-spec.json',
      'routes.json',
      'data-schema.json',
      'pages/studio.json',
      'pages/jobs.json',
      'pages/library.json',
      'pages/presets.json',
      'pages/status.json',
      'pages/settings.json',
      'pages/automations.json',
      'pages/im.json',
      'pages/run-history.json',
    ]) {
      expect(keys).toContain(required);
    }
  });

  it('declares all required common entities in native-app-spec', () => {
    const files = buildEcommerceAssistantFiles(session, { now: 1714470000000 });
    const spec = JSON.parse(files['native-app-spec.json']);
    const entities: string[] = spec.data.entities;
    for (const required of [
      'app_settings',
      'app_automations',
      'run_history',
      'assistant_messages',
      'app_notifications',
      'app_command_runs',
      'acceptance_checks',
    ]) {
      expect(entities).toContain(required);
    }
    for (const business of [
      'product_inputs',
      'product_briefs',
      'image_jobs',
      'image_outputs',
      'style_presets',
      'selection_evidence',
    ]) {
      expect(entities).toContain(business);
    }
  });

  it('declares schedule and im-notification permissions when automations and im are enabled', () => {
    const files = buildEcommerceAssistantFiles(session, { now: 1714470000000 });
    const app = JSON.parse(files['app.json']);
    expect(app.permissions.system).toEqual(
      expect.arrayContaining(['schedule', 'im-notification']),
    );
    expect(app.permissions.data).toBe('isolated');
  });

  it('passes the validate-native-app script', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-ecom-validator-'));
    try {
      const files = buildEcommerceAssistantFiles(session, { now: 1714470000000 });
      materialize(files, tmp);
      const result = spawnSync(process.execPath, [SCRIPT, tmp, '--json'], {
        encoding: 'utf-8',
      });
      const json = JSON.parse(result.stdout) as {
        ok: boolean;
        errorCount: number;
        issues: Array<{ message: string; file: string; jsonPath: string }>;
      };
      if (!json.ok) {
        // Surface a readable failure list so test diagnostics name the missing pieces.
        const lines = json.issues.map((i) => `  ${i.file} ${i.jsonPath}: ${i.message}`);
        throw new Error(`validator failed:\n${lines.join('\n')}`);
      }
      expect(json).toMatchObject({ ok: true, errorCount: 0 });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
