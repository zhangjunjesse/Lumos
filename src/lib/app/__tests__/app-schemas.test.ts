import fs from 'fs';
import path from 'path';

import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const SCHEMA_DIR = path.resolve(__dirname, '../../../../resources/app-schemas');

function loadSchema(file: string): object {
  const full = path.join(SCHEMA_DIR, file);
  return JSON.parse(fs.readFileSync(full, 'utf-8'));
}

function makeAjv(): Ajv2020 {
  // strict: false because our schemas use oneOf/anyOf with `required` against
  // fields declared in the parent schema — ajv strict mode flags this as
  // "missing properties" even though it's spec-valid. We keep allErrors on so
  // the validator/parser can collect all issues for AI builder feedback.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

describe('app platform schemas — sanity', () => {
  const schemaFiles = [
    'app.schema.json',
    'routes.schema.json',
    'page.schema.json',
    'data-schema.schema.json',
    'workflow-ref.schema.json',
  ];

  it.each(schemaFiles)('%s is valid JSON Schema', (file) => {
    const schema = loadSchema(file);
    const ajv = makeAjv();
    expect(() => ajv.compile(schema)).not.toThrow();
  });
});

describe('app.schema.json — positive & negative fixtures', () => {
  let validate: ReturnType<ReturnType<typeof makeAjv>['compile']>;

  beforeAll(() => {
    const ajv = makeAjv();
    validate = ajv.compile(loadSchema('app.schema.json'));
  });

  it('accepts a minimal valid manifest', () => {
    const ok = validate({
      id: 'my-app',
      name: 'My App',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'home',
    });
    expect(ok).toBe(true);
  });

  it('accepts a full-featured manifest', () => {
    const ok = validate({
      id: 'customer-mgmt',
      name: '客户管理',
      version: '1.2.3',
      description: '简单 CRM',
      author: 'zhangjun',
      icon: './icon.png',
      category: 'office',
      tags: ['crm', '客户'],
      entry: 'customers',
      requires: {
        lumos: '>=1.0.0',
        mcp: ['feishu'],
        tools: ['python'],
        llm: 'chat',
        knowledge: 'optional',
      },
      permissions: {
        filesystem: {
          read: ['~/Documents/customers'],
          write: ['~/Downloads/lumos-app-{id}'],
        },
        network: {
          mode: 'whitelist',
          domains: ['open.feishu.cn'],
        },
        data: 'isolated',
        system: ['notification', 'im-notification'],
      },
      config: [
        { key: 'feishu_token', label: '飞书 Token', type: 'secret', required: true, secret: true },
      ],
      triggers: [
        { type: 'manual' },
        { type: 'schedule', cron: '0 17 * * 5', workflow: 'weekly-summary' },
      ],
    });
    expect(ok).toBe(true);
  });

  it('rejects bad id (uppercase)', () => {
    expect(validate({
      id: 'BadId',
      name: 'X',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'home',
    })).toBe(false);
  });

  it('rejects non-semver version', () => {
    expect(validate({
      id: 'my-app',
      name: 'X',
      version: '1.0',
      icon: './icon.png',
      entry: 'home',
    })).toBe(false);
  });

  it('rejects wildcard in network domains', () => {
    expect(validate({
      id: 'my-app',
      name: 'X',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'home',
      permissions: {
        network: { mode: 'whitelist', domains: ['*'] },
      },
    })).toBe(false);
  });

  it('rejects whitelist network mode without domains', () => {
    expect(validate({
      id: 'my-app',
      name: 'X',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'home',
      permissions: {
        network: { mode: 'whitelist' },
      },
    })).toBe(false);
  });

  it('rejects unknown tool', () => {
    expect(validate({
      id: 'my-app',
      name: 'X',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'home',
      requires: { tools: ['rm-rf'] },
    })).toBe(false);
  });

  it('rejects path traversal in fs paths', () => {
    expect(validate({
      id: 'my-app',
      name: 'X',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'home',
      permissions: {
        filesystem: { read: ['~/Documents/../../../etc/passwd'] },
      },
    })).toBe(false);
  });

  it('rejects additional unknown top-level fields', () => {
    expect(validate({
      id: 'my-app',
      name: 'X',
      version: '1.0.0',
      icon: './icon.png',
      entry: 'home',
      mystery: 'field',
    })).toBe(false);
  });
});

describe('page.schema.json — 4 layouts', () => {
  let validate: ReturnType<ReturnType<typeof makeAjv>['compile']>;

  beforeAll(() => {
    const ajv = makeAjv();
    validate = ajv.compile(loadSchema('page.schema.json'));
  });

  it('accepts form layout', () => {
    expect(validate({
      title: '生成周报',
      layout: 'form',
      form: [
        { type: 'textarea', name: 'completed', label: '本周完成', required: true },
      ],
      submit: {
        label: '生成',
        run: 'workflow:generate-report',
        render: 'markdown',
      },
    })).toBe(true);
  });

  it('accepts list-detail layout', () => {
    expect(validate({
      title: '客户列表',
      layout: 'list-detail',
      list: {
        type: 'table',
        data: '{{ db.customers }}',
        columns: [
          { field: 'name', label: '姓名', sortable: true },
          { field: 'status', label: '状态', render: 'tag' },
        ],
        actions: {
          row: [{ label: '编辑', open: 'page:edit' }],
          toolbar: [{ label: '新增', open: 'dialog:create', primary: true }],
        },
      },
      detail: {
        view: {
          form: [{ type: 'text', name: 'name', label: '姓名', required: true }],
          submit: { label: '保存', run: 'db:update:customers' },
        },
      },
    })).toBe(true);
  });

  it('accepts result layout', () => {
    expect(validate({
      title: '分析结果',
      layout: 'result',
      source: { run: 'workflow:analyze', input: { id: '{{ inputs.id }}' } },
      render: 'markdown',
    })).toBe(true);
  });

  it('accepts single layout with multiple widgets', () => {
    expect(validate({
      title: '看板',
      layout: 'single',
      blocks: [
        { type: 'card', title: '统计', children: [
          { type: 'markdown', content: '本月新增 **{{ db.customers.count }}** 个客户' },
        ] },
        { type: 'button', label: '生成报告', primary: true, run: 'workflow:report' },
        { type: 'button', label: '同步闲鱼数据', run: 'native:goofish:sync' },
      ],
    })).toBe(true);
  });

  it('rejects malformed event DSL', () => {
    expect(validate({
      title: 'X',
      layout: 'form',
      form: [{ type: 'text', name: 'x', label: 'X' }],
      submit: { label: 'Go', run: 'rm:rf:slash' },
    })).toBe(false);
  });

  it('rejects unknown layout', () => {
    expect(validate({
      title: 'X',
      layout: 'kanban',
    })).toBe(false);
  });
});

describe('data-schema.schema.json', () => {
  let validate: ReturnType<ReturnType<typeof makeAjv>['compile']>;

  beforeAll(() => {
    const ajv = makeAjv();
    validate = ajv.compile(loadSchema('data-schema.schema.json'));
  });

  it('accepts a CRM-like data schema', () => {
    expect(validate({
      collections: [
        {
          name: 'customers',
          fields: [
            { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
            { name: 'name', type: 'string', required: true, indexed: true },
            { name: 'status', type: 'enum', options: ['active', 'inactive'] },
            { name: 'created_at', type: 'datetime', auto: 'now' },
          ],
          indexes: [['status', 'created_at']],
        },
      ],
    })).toBe(true);
  });

  it('rejects enum field without options', () => {
    expect(validate({
      collections: [{
        name: 'orders',
        fields: [{ name: 'state', type: 'enum' }],
      }],
    })).toBe(false);
  });

  it('rejects ref field without target', () => {
    expect(validate({
      collections: [{
        name: 'orders',
        fields: [{ name: 'customer', type: 'ref' }],
      }],
    })).toBe(false);
  });
});

describe('routes.schema.json', () => {
  let validate: ReturnType<ReturnType<typeof makeAjv>['compile']>;

  beforeAll(() => {
    const ajv = makeAjv();
    validate = ajv.compile(loadSchema('routes.schema.json'));
  });

  it('accepts routes with page-only menu items', () => {
    expect(validate({
      menu: [
        { id: 'home', label: '首页', icon: 'home', page: 'pages/home.json' },
      ],
      default: 'home',
    })).toBe(true);
  });

  it('rejects menu items with both page and component', () => {
    expect(validate({
      menu: [{
        id: 'x', label: 'X', page: 'pages/x.json', component: 'components/X',
      }],
      default: 'x',
    })).toBe(false);
  });
});
