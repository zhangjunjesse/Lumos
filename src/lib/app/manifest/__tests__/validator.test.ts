import path from 'path';

import { parseApp } from '../parser';
import { validateApp } from '../validator';

const FIXTURES = path.join(__dirname, 'fixtures');

function parseAndValidate(name: string) {
  const result = parseApp(path.join(FIXTURES, name));
  if (!result.ok) {
    throw new Error(
      `parseApp failed for ${name}: ${JSON.stringify(result.issues, null, 2)}`,
    );
  }
  return validateApp(result.app);
}

describe('validateApp — positive', () => {
  it('valid-form-tool has no errors', () => {
    const issues = parseAndValidate('valid-form-tool');
    const errors = issues.filter(i => i.level === 'error');
    expect(errors).toEqual([]);
  });

  it('valid-list-detail-crm has no errors', () => {
    const issues = parseAndValidate('valid-list-detail-crm');
    const errors = issues.filter(i => i.level === 'error');
    expect(errors).toEqual([]);
  });
});

describe('validateApp — negative', () => {
  it('invalid-bad-page-ref reports the missing page', () => {
    const issues = parseAndValidate('invalid-bad-page-ref');
    const err = issues.find(
      i => i.file === 'routes.json' && i.message.includes('Page not found'),
    );
    expect(err).toBeDefined();
    expect(err?.jsonPath).toBe('/menu/0/page');
  });

  it('invalid-undeclared-workflow reports the missing workflow', () => {
    const issues = parseAndValidate('invalid-undeclared-workflow');
    const err = issues.find(i => i.message.includes('Workflow not found'));
    expect(err).toBeDefined();
    expect(err?.file).toBe('pages/main.json');
    expect(err?.message).toContain('nonexistent');
  });

  it('invalid-bad-data-binding reports the unknown collection', () => {
    const issues = parseAndValidate('invalid-bad-data-binding');
    const err = issues.find(i => i.message.includes('unknown collection'));
    expect(err).toBeDefined();
    expect(err?.message).toContain('unknown_collection');
  });

  it('invalid-shared-data rejects v1 shared permission', () => {
    const issues = parseAndValidate('invalid-shared-data');
    const err = issues.find(
      i => i.file === 'app.json' && i.jsonPath === '/permissions/data',
    );
    expect(err).toBeDefined();
    expect(err?.level).toBe('error');
  });
});

describe('validateApp — synthetic checks', () => {
  it('rejects missing icon file', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-form-tool'));
    if (!result.ok) throw new Error('precondition');
    // Mutate manifest to point at a missing icon.
    result.app.manifest.icon = './missing.png';
    const issues = validateApp(result.app);
    const err = issues.find(
      i => i.file === 'app.json' && i.jsonPath === '/icon',
    );
    expect(err).toBeDefined();
    expect(err?.message).toContain('not found');
  });

  it('rejects routes.default referencing a nonexistent menu id', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-form-tool'));
    if (!result.ok) throw new Error('precondition');
    result.app.routes.default = 'nope';
    const issues = validateApp(result.app);
    const err = issues.find(
      i => i.file === 'routes.json' && i.jsonPath === '/default',
    );
    expect(err).toBeDefined();
  });

  it('rejects manifest.entry referencing a nonexistent menu id', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-form-tool'));
    if (!result.ok) throw new Error('precondition');
    result.app.manifest.entry = 'nope';
    const issues = validateApp(result.app);
    const err = issues.find(
      i => i.file === 'app.json' && i.jsonPath === '/entry',
    );
    expect(err).toBeDefined();
  });

  it('rejects code components in v1', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-form-tool'));
    if (!result.ok) throw new Error('precondition');
    result.app.routes.menu.push({
      id: 'whiteboard', label: 'Whiteboard', component: 'components/Whiteboard',
    });
    const issues = validateApp(result.app);
    const err = issues.find(
      i => i.jsonPath.endsWith('/component'),
    );
    expect(err).toBeDefined();
    expect(err?.message).toContain('not supported in v1');
  });

  it('rejects triggers referencing unknown workflows', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-form-tool'));
    if (!result.ok) throw new Error('precondition');
    result.app.manifest.triggers = [
      { type: 'schedule', cron: '0 9 * * 1', workflow: 'nope' },
    ];
    const issues = validateApp(result.app);
    const err = issues.find(
      i => i.jsonPath === '/triggers/0/workflow',
    );
    expect(err).toBeDefined();
  });

  it('warns on declared MCP that is unused in any workflow', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-form-tool'));
    if (!result.ok) throw new Error('precondition');
    result.app.manifest.requires = { ...(result.app.manifest.requires ?? {}), mcp: ['feishu'] };
    const issues = validateApp(result.app);
    const warn = issues.find(
      i => i.level === 'warning' && i.message.includes("'feishu'"),
    );
    expect(warn).toBeDefined();
  });

  it('detects duplicate menu ids in routes', () => {
    const result = parseApp(path.join(FIXTURES, 'valid-list-detail-crm'));
    if (!result.ok) throw new Error('precondition');
    // Force a duplicate id.
    result.app.routes.menu[1].id = result.app.routes.menu[0].id;
    const issues = validateApp(result.app);
    const err = issues.find(i => i.message.includes('Duplicate menu id'));
    expect(err).toBeDefined();
  });
});
