import { compileFromYaml } from '../compiler';
import { getValidators } from '../../manifest/ajv-instance';

describe('AppSpec compiler', () => {
  const validators = getValidators();

  function expectValidJson(file: { path: string; content: string }) {
    const value = JSON.parse(file.content);
    if (file.path === 'app.json') {
      const ok = validators.app(value);
      if (!ok) throw new Error(`app.json validation failed: ${JSON.stringify(validators.app.errors, null, 2)}`);
    }
    if (file.path === 'routes.json') {
      const ok = validators.routes(value);
      if (!ok) throw new Error(`routes.json validation failed: ${JSON.stringify(validators.routes.errors, null, 2)}`);
    }
    if (file.path === 'data-schema.json') {
      const ok = validators.dataSchema(value);
      if (!ok) throw new Error(`data-schema.json validation failed: ${JSON.stringify(validators.dataSchema.errors, null, 2)}`);
    }
    if (file.path.startsWith('pages/')) {
      const ok = validators.page(value);
      if (!ok) throw new Error(`${file.path} validation failed: ${JSON.stringify(validators.page.errors, null, 2)}`);
    }
  }

  test('minimal todo app compiles to valid JSON files', () => {
    const yaml = `
app:
  name: 待办助手
  description: 记录每天要做的事

data:
  todos:
    label: 待办
    fields:
      title: text required label="事项"
      status: enum[待办|完成] default=待办
      due: date label="截止"

pages:
  todos:
    title: 我的待办
    layout: list
    data: todos
    columns: [title, status, due]
    actions:
      - { label: 新增, open: page:new-todo, primary: true }

  new-todo:
    title: 新增待办
    layout: form
    collection: todos
    submit: db:create:todos

seed:
  todos:
    - { title: 写周报, status: 待办 }
    - { title: 健身, status: 待办 }
    - { title: 看医生, status: 完成 }
`;
    const result = compileFromYaml(yaml, { sessionId: 'test1234' });
    if (!result.ok) {
      throw new Error(`compile failed: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.appName).toBe('待办助手');
      expect(result.summary.collectionCount).toBe(1);
      expect(result.summary.pageCount).toBe(2);
      expect(result.summary.seedRowCount).toBe(3);
      for (const f of result.files) {
        expectValidJson(f);
      }
      const appFile = result.files.find((f) => f.path === 'app.json');
      expect(appFile).toBeDefined();
      const app = JSON.parse(appFile!.content);
      expect(app.icon).toBe('./icon.png');
      expect(app.requires).toEqual({ lumos: '>=1.0.0', knowledge: 'none' });
      expect(app.permissions).toEqual({ data: 'isolated' });
      expect(app.id).toMatch(/^[a-z][a-z0-9-]+$/);
      expect(app.entry).toBe('todos');
    }
  });

  test('reports errors for unknown collection reference', () => {
    const yaml = `
app:
  name: 测试

data:
  customers:
    fields:
      name: text required

pages:
  customers:
    title: 客户列表
    layout: list
    data: customer
    columns: [name]
`;
    const result = compileFromYaml(yaml, { sessionId: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.errors.map((e) => e.message).join('\n');
      expect(msg).toContain('customer');
    }
  });

  test('reports errors for missing column field', () => {
    const yaml = `
app:
  name: 测试
data:
  todos:
    fields:
      title: text required
pages:
  todos:
    title: 列表
    layout: list
    data: todos
    columns: [title, status, owner_name]
`;
    const result = compileFromYaml(yaml, { sessionId: 'a' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = result.errors.map((e) => e.message).join('\n');
      expect(msg).toMatch(/owner_name|status/);
    }
  });

  test('auto-fixes enum default not in options (warning)', () => {
    const yaml = `
app:
  name: 测试
data:
  todos:
    fields:
      title: text required
      status: enum[A|B|C] default=Z
pages:
  todos:
    title: 列表
    layout: list
    data: todos
    columns: [title, status]
`;
    const result = compileFromYaml(yaml, { sessionId: 'a' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const wmsg = result.warnings.map((w) => w.message).join('\n');
      expect(wmsg).toContain('default');
    }
  });

  test('AI common mistakes are auto-fixed (icon, requires, permissions never appear)', () => {
    const yaml = `
app:
  name: My App With Spaces!
  needs: [notification, browser]
data:
  items:
    fields:
      name: text required
pages:
  items:
    title: Items
    layout: list
    data: items
    columns: [name]
`;
    const result = compileFromYaml(yaml, { sessionId: 'sessXYZ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const app = JSON.parse(result.files.find((f) => f.path === 'app.json')!.content);
      expect(app.icon).toBe('./icon.png');
      expect(typeof app.requires).toBe('object');
      expect(Array.isArray(app.requires)).toBe(false);
      expect(app.requires.browser).toBe(true);
      expect(typeof app.permissions).toBe('object');
      expect(app.permissions.system).toContain('notification');
      expect(app.id).toMatch(/^[a-z][a-z0-9-]{2,63}$/);
    }
  });
});
