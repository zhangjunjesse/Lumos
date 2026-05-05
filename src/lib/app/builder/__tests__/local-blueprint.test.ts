import { buildLocalBlueprintFiles } from '../local-blueprint';
import type { BuilderSession } from '../session';

describe('buildLocalBlueprintFiles', () => {
  it('produces the minimum installable declarative app files', () => {
    const session: BuilderSession = {
      id: 'bs_1234567890abcdef',
      status: 'gathering',
      appName: '客户记录',
      appDescription: '记录客户状态和备注',
      createdAt: 0,
      updatedAt: 0,
    };

    const files = buildLocalBlueprintFiles(session, { now: 1714470000000 });

    expect(Object.keys(files).sort()).toEqual([
      'app.json',
      'data-schema.json',
      'pages/items.json',
      'pages/new-item.json',
      'routes.json',
    ]);
    expect(JSON.parse(files['app.json'])).toMatchObject({
      id: 'app-12345678',
      name: '客户记录',
      description: '记录客户状态和备注',
      entry: 'items',
      icon: './icon.png',
      permissions: { data: 'isolated' },
    });
    expect(JSON.parse(files['routes.json']).menu).toHaveLength(2);
    expect(JSON.parse(files['data-schema.json']).collections[0].name).toBe('items');
    expect(JSON.parse(files['pages/items.json'])).toMatchObject({
      title: '客户记录',
      layout: 'single',
    });
    expect(JSON.parse(files['pages/new-item.json'])).toMatchObject({
      title: '新增记录',
      layout: 'form',
    });
  });

  it('uses a slug app id for latin names', () => {
    const session: BuilderSession = {
      id: 'bs_abcdef1234567890',
      status: 'gathering',
      appName: 'Weekly CRM',
      createdAt: 0,
      updatedAt: 0,
    };

    const app = JSON.parse(buildLocalBlueprintFiles(session)['app.json']) as { id: string };
    expect(app.id).toBe('weekly-crm');
  });
});
