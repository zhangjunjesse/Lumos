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
      'native-app-spec.json',
      'pages/automations.json',
      'pages/im.json',
      'pages/items.json',
      'pages/new-item.json',
      'pages/run-history.json',
      'pages/settings.json',
      'pages/status.json',
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
    expect(JSON.parse(files['native-app-spec.json'])).toMatchObject({
      version: 1,
      data: {
        entities: expect.arrayContaining([
          'app_automations',
          'assistant_messages',
          'app_notifications',
          'app_command_runs',
          'acceptance_checks',
        ]),
      },
      status: {
        states: expect.arrayContaining(['not_configured', 'ready', 'running', 'failed', 'not_connected']),
      },
      acceptance: expect.arrayContaining([
        expect.objectContaining({ id: 'installation-self-check' }),
        expect.objectContaining({ id: 'open-items' }),
        expect.objectContaining({ id: 'save-settings' }),
        expect.objectContaining({ id: 'review-run-history' }),
      ]),
    });
    expect(JSON.parse(files['routes.json']).menu).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'status' }),
      expect.objectContaining({ id: 'settings' }),
      expect.objectContaining({ id: 'automations' }),
      expect.objectContaining({ id: 'im' }),
      expect.objectContaining({ id: 'run-history' }),
    ]));
    expect(JSON.parse(files['data-schema.json']).collections).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'items' }),
      expect.objectContaining({ name: 'app_settings' }),
      expect.objectContaining({ name: 'app_automations' }),
      expect.objectContaining({ name: 'run_history' }),
      expect.objectContaining({ name: 'assistant_messages' }),
      expect.objectContaining({ name: 'app_notifications' }),
      expect.objectContaining({ name: 'app_command_runs' }),
      expect.objectContaining({ name: 'acceptance_checks' }),
    ]));
    expect(JSON.parse(files['pages/items.json'])).toMatchObject({
      title: '客户记录',
      layout: 'single',
    });
    expect(JSON.parse(files['pages/new-item.json'])).toMatchObject({
      title: '新增记录',
      layout: 'form',
    });
    expect(JSON.parse(files['pages/status.json'])).toMatchObject({
      title: '客户记录 状态',
      layout: 'single',
    });
    expect(JSON.parse(files['pages/settings.json'])).toMatchObject({
      title: '设置',
      layout: 'form',
    });
    expect(JSON.parse(files['pages/automations.json'])).toMatchObject({
      title: '自动化',
      layout: 'list-detail',
    });
    expect(JSON.parse(files['pages/im.json'])).toMatchObject({
      title: '通知命令',
      layout: 'single',
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: 'card',
          children: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('/app 客户记录 status'),
            }),
          ]),
        }),
        expect.objectContaining({
          type: 'table',
          data: '{{ db.app_command_runs }}',
          actions: expect.objectContaining({
            toolbar: expect.arrayContaining([
              expect.objectContaining({
                label: '添加通用状态命令',
                input: expect.objectContaining({ command: '/status' }),
              }),
              expect.objectContaining({
                label: '添加运行记录命令',
                input: expect.objectContaining({ command: '/runs' }),
              }),
              expect.objectContaining({
                label: '添加验收进度命令',
                input: expect.objectContaining({ command: '/acceptance' }),
              }),
              expect.objectContaining({
                label: '添加帮助命令',
                input: expect.objectContaining({ command: '/help' }),
              }),
            ]),
          }),
        }),
      ]),
    });
    expect(JSON.parse(files['pages/run-history.json'])).toMatchObject({
      title: '运行结果',
      layout: 'single',
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
