import { validateAppTool } from '../tools/validate-app';
import {
  APP_BUILDER_TEMPLATES,
  buildTemplateBlueprintFiles,
  inferAppBuilderTemplateId,
} from '../templates';
import { validateNativeGradeAppSpec } from '../native-grade-spec';
import type { BuilderSession } from '../session';

describe('app builder templates', () => {
  it.each(APP_BUILDER_TEMPLATES)('builds a valid starter package for $id', async (template) => {
    const session: BuilderSession = {
      id: `bs_${template.id.replace(/-/g, '')}123456`,
      status: 'gathering',
      appName: template.name,
      appDescription: template.description,
      templateId: template.id,
      createdAt: 0,
      updatedAt: 0,
    };

    const files = buildTemplateBlueprintFiles(session, template.id, { now: 1714470000000 });

    expect(files).toBeTruthy();
    const keys = Object.keys(files ?? {}).sort();
    expect(keys).toEqual(expect.arrayContaining([
      'app.json',
      'data-schema.json',
      'native-app-spec.json',
      'pages/automations.json',
      'pages/im.json',
      'pages/run-history.json',
      'pages/settings.json',
      'pages/status.json',
      'routes.json',
    ]));
    expect(keys.filter((key) => key.startsWith('pages/') && key.endsWith('.json')).length)
      .toBeGreaterThanOrEqual(5);
    expect(JSON.parse(files?.['routes.json'] ?? '{}').menu).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'status', page: 'pages/status.json' }),
      expect.objectContaining({ id: 'settings', page: 'pages/settings.json' }),
      expect.objectContaining({ id: 'automations', page: 'pages/automations.json' }),
      expect.objectContaining({ id: 'im', page: 'pages/im.json' }),
      expect.objectContaining({ id: 'run-history', page: 'pages/run-history.json' }),
    ]));
    const dataSchema = JSON.parse(files?.['data-schema.json'] ?? '{}') as {
      collections?: Array<{ name: string; fields?: Array<{ name: string }> }>;
    };
    expect(dataSchema.collections).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'app_settings' }),
      expect.objectContaining({
        name: 'app_automations',
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'native_action' }),
          expect.objectContaining({ name: 'last_run_id' }),
          expect.objectContaining({ name: 'schedule_status' }),
          expect.objectContaining({ name: 'next_run_at' }),
        ]),
      }),
      expect.objectContaining({ name: 'run_history' }),
      expect.objectContaining({ name: 'assistant_messages' }),
      expect.objectContaining({ name: 'app_notifications' }),
      expect.objectContaining({
        name: 'app_command_runs',
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'last_run_id' }),
        ]),
      }),
      expect.objectContaining({
        name: 'acceptance_checks',
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'status' }),
          expect.objectContaining({ name: 'evidence' }),
          expect.objectContaining({ name: 'failure_reason' }),
          expect.objectContaining({ name: 'evidence_run_id' }),
        ]),
      }),
    ]));
    const nativeSpec = JSON.parse(files?.['native-app-spec.json'] ?? '{}');
    expect(nativeSpec).toMatchObject({
      data: {
        entities: expect.arrayContaining([
          'app_automations',
          'assistant_messages',
          'app_notifications',
          'app_command_runs',
          'acceptance_checks',
        ]),
      },
    });
    expect(nativeSpec.acceptance).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'installation-self-check' }),
    ]));
    expect(JSON.parse(files?.['pages/automations.json'] ?? '{}')).toMatchObject({
      list: {
        actions: {
          row: expect.arrayContaining([
            expect.objectContaining({ label: '立即运行', run: 'native:app:run-automation' }),
            expect.objectContaining({ label: '同步定时任务', run: 'native:app:sync-automation-schedule' }),
          ]),
        },
      },
    });
    expect(JSON.parse(files?.['pages/status.json'] ?? '{}')).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: 'card',
          children: expect.arrayContaining([
            expect.objectContaining({
              label: '重新运行安装自检',
              run: 'native:app:run-self-check',
            }),
          ]),
        }),
      ]),
    });
    expect(JSON.parse(files?.['pages/im.json'] ?? '{}')).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: 'card',
          children: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('/app'),
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
                input: expect.objectContaining({ command: '/status', risk_level: 'read' }),
              }),
              expect.objectContaining({
                label: '添加运行记录命令',
                input: expect.objectContaining({ command: '/runs', risk_level: 'read' }),
              }),
              expect.objectContaining({
                label: '添加验收进度命令',
                input: expect.objectContaining({ command: '/acceptance', risk_level: 'read' }),
              }),
              expect.objectContaining({
                label: '添加帮助命令',
                input: expect.objectContaining({ command: '/help', risk_level: 'read' }),
              }),
            ]),
            row: expect.arrayContaining([
              expect.objectContaining({ label: '测试命令', run: 'native:app:run-command' }),
            ]),
          }),
        }),
      ]),
    });

    const result = await validateAppTool.execute(
      { files: files ?? {} },
      { sessionId: session.id },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.errorCount).toBe(0);
    }
  });

  it('builds a controlled Goofish assistant starter', async () => {
    const template = APP_BUILDER_TEMPLATES.find((item) => item.id === 'goofish-assistant');
    expect(template).toBeTruthy();

    const session: BuilderSession = {
      id: 'bs_goofish12345678',
      status: 'gathering',
      appName: '闲鱼助手',
      appDescription: '帮用户回复闲鱼消息，管理商品，并通过微信 IM 通知。',
      templateId: 'goofish-assistant',
      createdAt: 0,
      updatedAt: 0,
    };

    const files = buildTemplateBlueprintFiles(session, 'goofish-assistant', { now: 1714470000000 });
    expect(files).toBeTruthy();

    const routes = JSON.parse(files?.['routes.json'] ?? '{}') as { menu?: Array<{ id: string }> };
    expect(routes.menu).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'accounts' }),
      expect.objectContaining({ id: 'inbox' }),
      expect.objectContaining({ id: 'drafts' }),
      expect.objectContaining({ id: 'draft-reply' }),
      expect.objectContaining({ id: 'items' }),
      expect.objectContaining({ id: 'im' }),
      expect.objectContaining({ id: 'automations' }),
    ]));

    const dataSchema = JSON.parse(files?.['data-schema.json'] ?? '{}') as {
      collections?: Array<{ name: string; fields?: Array<{ name: string }> }>;
    };
    expect(dataSchema.collections).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'goofish_accounts' }),
      expect.objectContaining({ name: 'buyer_conversations' }),
      expect.objectContaining({
        name: 'reply_drafts',
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'confirmation_code' }),
          expect.objectContaining({ name: 'confirmation_expires_at' }),
        ]),
      }),
      expect.objectContaining({ name: 'item_marks' }),
      expect.objectContaining({ name: 'app_notifications' }),
      expect.objectContaining({ name: 'app_command_runs' }),
    ]));

    const spec = JSON.parse(files?.['native-app-spec.json'] ?? '{}');
    const inboxPage = JSON.parse(files?.['pages/inbox.json'] ?? '{}');
    const draftsPage = JSON.parse(files?.['pages/drafts.json'] ?? '{}');
    const automationsPage = JSON.parse(files?.['pages/automations.json'] ?? '{}');
    expect(spec).toMatchObject({
      ai: { enabled: true, promptSettings: true, draftBeforeWrite: true },
      automations: { enabled: true, visibleRunResults: true },
      im: {
        enabled: true,
        lowRiskCommands: expect.arrayContaining(['/goofish status', '/goofish unread']),
        confirmationRequiredFor: expect.arrayContaining(['发送买家回复草稿']),
      },
      risk: {
        writeActionsRequireConfirmation: true,
        outOfScope: expect.arrayContaining(['自动无确认回复买家', '发布商品', '改价']),
      },
      acceptance: expect.arrayContaining([
        expect.objectContaining({ id: 'installation-self-check' }),
        expect.objectContaining({ id: 'create-draft' }),
        expect.objectContaining({ id: 'draft-confirmation' }),
        expect.objectContaining({ id: 'review-im-commands' }),
      ]),
    });
    expect(inboxPage).toMatchObject({
      list: {
        actions: {
          row: expect.arrayContaining([
            expect.objectContaining({
              label: '生成回复草稿',
              run: 'native:goofish:generate-reply-draft',
            }),
          ]),
        },
      },
    });
    expect(draftsPage).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: 'table',
          data: '{{ db.reply_drafts }}',
          actions: {
            row: expect.arrayContaining([
              expect.objectContaining({ label: '确认发送', run: 'native:goofish:send-draft' }),
              expect.objectContaining({ label: '拒绝草稿', run: 'native:goofish:reject-draft' }),
            ]),
          },
        }),
      ]),
    });
    expect(automationsPage).toMatchObject({
      list: {
        actions: {
          toolbar: expect.arrayContaining([
            expect.objectContaining({
              label: '添加同步自动化',
              input: expect.objectContaining({
                title: '同步闲鱼数据',
                enabled: true,
                schedule: '每 2 小时',
                native_action: 'goofish:sync',
                last_status: 'idle',
                schedule_status: 'not_connected',
              }),
            }),
          ]),
          row: expect.arrayContaining([
            expect.objectContaining({ label: '立即运行', run: 'native:app:run-automation' }),
            expect.objectContaining({ label: '同步定时任务', run: 'native:app:sync-automation-schedule' }),
          ]),
        },
      },
    });
    expect(JSON.parse(files?.['pages/im.json'] ?? '{}')).toMatchObject({
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: 'table',
          data: '{{ db.app_command_runs }}',
          actions: {
            toolbar: expect.arrayContaining([
              expect.objectContaining({
                label: '添加状态命令',
                input: expect.objectContaining({ command: '/goofish status', risk_level: 'read' }),
              }),
              expect.objectContaining({
                label: '添加未读命令',
                input: expect.objectContaining({ command: '/goofish unread', risk_level: 'read' }),
              }),
              expect.objectContaining({
                label: '添加草稿命令',
                input: expect.objectContaining({
                  command: '/goofish draft 待处理买家',
                  risk_level: 'low_write',
                  confirmation_required: false,
                }),
              }),
              expect.objectContaining({
                label: '添加草稿列表命令',
                input: expect.objectContaining({
                  command: '/goofish drafts',
                  risk_level: 'read',
                }),
              }),
              expect.objectContaining({
                label: '添加同步命令',
                input: expect.objectContaining({
                  command: '/goofish sync',
                  risk_level: 'low_write',
                  confirmation_required: true,
                }),
              }),
              expect.objectContaining({
                label: '添加确认草稿命令',
                input: expect.objectContaining({
                  command: '/goofish confirm 草稿编号',
                  risk_level: 'low_write',
                  confirmation_required: true,
                }),
              }),
              expect.objectContaining({
                label: '添加拒绝草稿命令',
                input: expect.objectContaining({
                  command: '/goofish reject 草稿编号',
                  risk_level: 'low_write',
                  confirmation_required: true,
                }),
              }),
            ]),
            row: expect.arrayContaining([
              expect.objectContaining({ label: '测试命令', run: 'native:app:run-command' }),
            ]),
          },
        }),
      ]),
    });

    const nativeIssues = validateNativeGradeAppSpec(new Map(Object.entries(files ?? {})), {
      usesAi: true,
    });
    expect(nativeIssues).toEqual([]);

    const result = await validateAppTool.execute(
      { files: files ?? {} },
      { sessionId: session.id },
    );
    expect(result.ok).toBe(true);
  });

  it('infers Goofish starter from app name or description', () => {
    expect(inferAppBuilderTemplateId('闲鱼助手')).toBe('goofish-assistant');
    expect(inferAppBuilderTemplateId('咸鱼回复工具')).toBe('goofish-assistant');
    expect(inferAppBuilderTemplateId('Reply Bot', 'Goofish inbox assistant')).toBe('goofish-assistant');
    expect(inferAppBuilderTemplateId('客户记录', '记录客户状态和备注')).toBeNull();
  });
});
