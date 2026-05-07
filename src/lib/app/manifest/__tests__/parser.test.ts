import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseApp } from '../parser';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('parseApp', () => {
  it('parses a minimal valid form-tool app', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-form-tool'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.app.manifest.id).toBe('weekly-summary');
    expect(result.app.manifest.entry).toBe('main');
    expect(result.app.routes.menu).toHaveLength(1);
    expect(result.app.pages.has('pages/main.json')).toBe(true);
    expect(result.app.workflows.has('generate-report')).toBe(true);
    expect(result.app.dataSchema).toBeUndefined();
  });

  it('parses a list-detail app with data-schema', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-list-detail-crm'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.app.pages.size).toBe(2);
    expect(result.app.dataSchema).toBeDefined();
    expect(result.app.dataSchema?.collections[0].name).toBe('customers');
  });

  it('reports missing app.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-test-'));
    try {
      const result = parseApp(tmp);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].file).toBe('app.json');
      expect(result.issues[0].message).toContain('not found');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports missing routes.json when only app.json is present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-test-'));
    try {
      fs.writeFileSync(path.join(tmp, 'app.json'), JSON.stringify({
        id: 'test-app', name: 'X', version: '1.0.0', icon: './icon.png', entry: 'home',
      }));
      const result = parseApp(tmp);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].file).toBe('routes.json');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports invalid JSON in app.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-test-'));
    try {
      fs.writeFileSync(path.join(tmp, 'app.json'), '{ broken json');
      const result = parseApp(tmp);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].message).toContain('Invalid JSON');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports schema violations from app.json with multiple errors at once', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-test-'));
    try {
      fs.writeFileSync(path.join(tmp, 'app.json'), JSON.stringify({
        id: 'BAD_ID',           // pattern violation
        name: 'X',
        version: '1.0',         // semver violation
        icon: './icon.png',
        entry: 'home',
        unknown: true,          // additionalProperties: false
      }));
      const result = parseApp(tmp);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
      expect(result.issues.every(i => i.file === 'app.json')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports invalid pages but continues parsing other valid files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-test-'));
    try {
      fs.writeFileSync(path.join(tmp, 'app.json'), JSON.stringify({
        id: 'multi-page', name: 'X', version: '1.0.0', icon: './icon.png', entry: 'home',
      }));
      fs.writeFileSync(path.join(tmp, 'icon.png'), 'PNG_PLACEHOLDER');
      fs.writeFileSync(path.join(tmp, 'routes.json'), JSON.stringify({
        menu: [
          { id: 'home', label: 'Home', page: 'pages/home.json' },
          { id: 'broken', label: 'Broken', page: 'pages/broken.json' },
        ],
        default: 'home',
      }));
      fs.mkdirSync(path.join(tmp, 'pages'));
      fs.writeFileSync(path.join(tmp, 'pages/home.json'), JSON.stringify({
        title: 'Home',
        layout: 'single',
        blocks: [{ type: 'markdown', content: 'hi' }],
      }));
      fs.writeFileSync(path.join(tmp, 'pages/broken.json'), JSON.stringify({
        title: 'Broken',
        layout: 'kanban',  // invalid layout
      }));

      const result = parseApp(tmp);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.some(i => i.file === 'pages/broken.json')).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('detects duplicate workflow ids', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-app-test-'));
    try {
      fs.writeFileSync(path.join(tmp, 'app.json'), JSON.stringify({
        id: 'dup-wf', name: 'X', version: '1.0.0', icon: './icon.png', entry: 'main',
      }));
      fs.writeFileSync(path.join(tmp, 'icon.png'), 'P');
      fs.writeFileSync(path.join(tmp, 'routes.json'), JSON.stringify({
        menu: [{ id: 'main', label: 'M', page: 'pages/main.json' }],
        default: 'main',
      }));
      fs.mkdirSync(path.join(tmp, 'pages'));
      fs.writeFileSync(path.join(tmp, 'pages/main.json'), JSON.stringify({
        title: 'M', layout: 'single', blocks: [{ type: 'markdown', content: '.' }],
      }));
      fs.mkdirSync(path.join(tmp, 'workflows'));
      const wf = JSON.stringify({ id: 'same', version: 2, steps: [{ id: 'a', type: 'agent' }] });
      fs.writeFileSync(path.join(tmp, 'workflows/a.json'), wf);
      fs.writeFileSync(path.join(tmp, 'workflows/b.json'), wf);

      const result = parseApp(tmp);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.some(i => i.message.includes('Duplicate workflow id'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
