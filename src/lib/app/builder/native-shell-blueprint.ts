interface NativeShellInput {
  appName: string;
  primaryPageId: string;
  primaryCollection: string;
  primaryCollectionLabel: string;
  automationPresets?: NativeShellAutomationPreset[];
  commandPresets?: NativeShellCommandPreset[];
}

interface NativeShellAutomationPreset {
  label: string;
  primary?: boolean;
  input: Record<string, unknown>;
}

interface NativeShellCommandPreset {
  label: string;
  primary?: boolean;
  input: Record<string, unknown>;
}

interface RoutesShape {
  menu: unknown[];
}

interface DataSchemaShape {
  collections: unknown[];
}

export function withNativeShellRoutes<T extends RoutesShape>(routes: T): T {
  return {
    ...routes,
    menu: [
      ...routes.menu,
      { id: 'status', label: '状态', icon: 'circle-gauge', page: 'pages/status.json' },
      { id: 'settings', label: '设置', icon: 'settings', page: 'pages/settings.json' },
      { id: 'automations', label: '自动化', icon: 'calendar-clock', page: 'pages/automations.json' },
      { id: 'im', label: '通知命令', icon: 'message-square', page: 'pages/im.json' },
      { id: 'run-history', label: '运行结果', icon: 'history', page: 'pages/run-history.json' },
    ],
  };
}

export function withNativeShellCollections<T extends DataSchemaShape>(dataSchema: T): T {
  return {
    ...dataSchema,
    collections: [
      ...dataSchema.collections,
      {
        name: 'app_settings',
        label: '应用设置',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'default_view', type: 'string', label: '默认视图', default: '工作台' },
          {
            name: 'notification_channel',
            type: 'enum',
            label: '通知方式',
            options: ['关闭', '系统通知', '微信 IM'],
            default: '关闭',
          },
          { name: 'ai_system_prompt', type: 'text', label: 'AI 提示词' },
          { name: 'automation_enabled', type: 'boolean', label: '自动化启用', default: false },
          { name: 'risk_note', type: 'text', label: '风险边界' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['updated_at']],
      },
      {
        name: 'run_history',
        label: '运行结果',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'title', type: 'string', label: '运行标题', required: true, indexed: true },
          {
            name: 'status',
            type: 'enum',
            label: '状态',
            options: ['running', 'success', 'failed', 'cancelled'],
            default: 'success',
            indexed: true,
          },
          { name: 'summary', type: 'text', label: '结果摘要' },
          { name: 'failure_reason', type: 'text', label: '失败原因' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['status'], ['updated_at']],
      },
      {
        name: 'app_automations',
        label: '自动化',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'title', type: 'string', label: '名称', required: true, indexed: true },
          { name: 'enabled', type: 'boolean', label: '启用', default: false, indexed: true },
          { name: 'schedule', type: 'string', label: '触发规则', default: '未设置' },
          {
            name: 'native_action',
            type: 'string',
            label: '执行动作',
            default: '',
            indexed: true,
          },
          { name: 'description', type: 'text', label: '说明' },
          {
            name: 'last_status',
            type: 'enum',
            label: '最近状态',
            options: ['not_connected', 'idle', 'running', 'success', 'failed', 'cancelled'],
            default: 'not_connected',
            indexed: true,
          },
          { name: 'last_run_summary', type: 'text', label: '最近结果' },
          { name: 'last_run_id', type: 'string', label: '最近运行记录' },
          { name: 'schedule_id', type: 'string', label: '调度任务 ID' },
          {
            name: 'schedule_status',
            type: 'enum',
            label: '调度状态',
            options: ['not_connected', 'scheduled', 'paused', 'failed'],
            default: 'not_connected',
            indexed: true,
          },
          { name: 'schedule_error', type: 'text', label: '调度失败原因' },
          { name: 'next_run_at', type: 'datetime', label: '下次运行时间' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['enabled'], ['native_action'], ['last_status'], ['schedule_status'], ['updated_at']],
      },
      {
        name: 'assistant_messages',
        label: 'AI 助手对话',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          {
            name: 'role',
            type: 'enum',
            label: '角色',
            options: ['user', 'assistant'],
            required: true,
            indexed: true,
          },
          { name: 'text', type: 'text', label: '消息内容', required: true },
          { name: 'error', type: 'boolean', label: '是否失败', default: false },
          { name: 'created_at', type: 'datetime', label: '创建时间' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['role'], ['updated_at']],
      },
      {
        name: 'app_notifications',
        label: '通知目标',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          {
            name: 'channel',
            type: 'enum',
            label: '渠道',
            options: ['system', 'wechat_im'],
            default: 'system',
            indexed: true,
          },
          { name: 'provider_id', type: 'string', label: 'IM 服务商', default: 'wechat' },
          { name: 'chat_id', type: 'string', label: '会话 ID' },
          { name: 'target_label', type: 'string', label: '目标', required: true, indexed: true },
          { name: 'title', type: 'string', label: '通知标题', default: '应用通知' },
          { name: 'text', type: 'text', label: '通知正文' },
          {
            name: 'status',
            type: 'enum',
            label: '状态',
            options: ['not_connected', 'ready', 'sent', 'failed'],
            default: 'not_connected',
            indexed: true,
          },
          { name: 'last_error', type: 'text', label: '失败原因' },
          { name: 'last_message_id', type: 'string', label: '最近消息 ID' },
          { name: 'last_sent_at', type: 'datetime', label: '最近发送时间' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['channel'], ['status'], ['updated_at']],
      },
      {
        name: 'app_command_runs',
        label: 'IM 命令',
        fields: [
          { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
          { name: 'command', type: 'string', label: '命令', required: true, indexed: true },
          {
            name: 'risk_level',
            type: 'enum',
            label: '风险',
            options: ['read', 'low_write', 'high_risk'],
            default: 'read',
            indexed: true,
          },
          { name: 'confirmation_required', type: 'boolean', label: '需要确认', default: true },
          {
            name: 'status',
            type: 'enum',
            label: '状态',
            options: ['not_connected', 'draft', 'pending_confirmation', 'success', 'failed', 'rejected'],
            default: 'not_connected',
            indexed: true,
          },
          { name: 'result_summary', type: 'text', label: '结果' },
          { name: 'failure_reason', type: 'text', label: '失败原因' },
          { name: 'last_run_id', type: 'string', label: '最近运行记录' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['command'], ['risk_level'], ['status'], ['updated_at']],
      },
      {
        name: 'acceptance_checks',
        label: '验收清单',
        fields: [
          { name: 'id', type: 'string', primary: true },
          { name: 'acceptance_id', type: 'string', label: '验收项 ID', required: true, indexed: true },
          { name: 'done', type: 'boolean', label: '已验收', default: false },
          {
            name: 'status',
            type: 'enum',
            label: '验收状态',
            options: ['unverified', 'passed', 'failed', 'blocked'],
            default: 'unverified',
            indexed: true,
          },
          { name: 'evidence', type: 'text', label: '验收证据' },
          { name: 'failure_reason', type: 'text', label: '失败或阻塞原因' },
          { name: 'evidence_run_id', type: 'string', label: '关联运行记录' },
          { name: 'completed_at', type: 'datetime', label: '验收时间' },
          { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
        ],
        indexes: [['acceptance_id'], ['status'], ['updated_at']],
      },
    ],
  };
}

export function buildNativeShellPages(input: NativeShellInput): Record<string, unknown> {
  const automationPresetActions = (input.automationPresets ?? []).map((preset) => ({
    label: preset.label,
    primary: preset.primary,
    run: 'db:create:app_automations',
    input: preset.input,
  }));
  const genericCommandPresetActions = buildGenericCommandPresetActions(input.appName);
  const commandPresetActions = (input.commandPresets ?? []).map((preset) => ({
    label: preset.label,
    primary: preset.primary,
    run: 'db:create:app_command_runs',
    input: preset.input,
  }));

  return {
    'pages/status.json': {
      title: `${input.appName} 状态`,
      description: '查看应用是否就绪、哪些能力未接入，以及最近运行结果。',
      layout: 'single',
      blocks: [
        {
          type: 'card',
          title: '就绪检查',
          children: [
            {
              type: 'markdown',
              content: [
                `- ${input.primaryCollectionLabel}：{{ db.${input.primaryCollection}.count }} 条`,
                '- 设置记录：{{ db.app_settings.count }} 条',
                '- 自动化：{{ db.app_automations.count }} 条',
                '- 运行记录：{{ db.run_history.count }} 条',
                '- AI 对话：{{ db.assistant_messages.count }} 条',
                '- 通知目标：{{ db.app_notifications.count }} 条',
                '- IM 命令：{{ db.app_command_runs.count }} 条',
                '- 验收记录：{{ db.acceptance_checks.count }} 条',
                '- 未接入能力必须在这里显示为“未接入 / 需官方能力”，不能伪装成功。',
              ].join('\n'),
            },
            { type: 'button', label: '打开设置', open: 'page:settings', primary: true },
            {
              type: 'button',
              label: '重新运行安装自检',
              run: 'native:app:run-self-check',
              confirm: '重新运行安装自检会写入一条新的运行结果记录，继续吗？',
            },
            { type: 'button', label: '查看运行结果', open: 'page:run-history' },
          ],
        },
        {
          type: 'card',
          title: '主工作台',
          children: [
            {
              type: 'markdown',
              content: `返回 ${input.primaryCollectionLabel} 工作台继续处理真实业务数据。`,
            },
            { type: 'button', label: '打开工作台', open: `page:${input.primaryPageId}` },
          ],
        },
      ],
    },
    'pages/automations.json': {
      title: '自动化',
      description: '管理定时任务、手动触发意图和最近运行状态。',
      layout: 'list-detail',
      list: {
        type: 'table',
        data: '{{ db.app_automations }}',
        columns: [
          { field: 'title', label: '名称', search: true },
          { field: 'enabled', label: '启用', render: 'tag' },
          { field: 'schedule', label: '触发规则', search: true },
          { field: 'native_action', label: '执行动作', search: true },
          { field: 'last_status', label: '最近状态', render: 'tag' },
          { field: 'schedule_status', label: '调度状态', render: 'tag' },
          { field: 'next_run_at', label: '下次运行', render: 'date', sortable: true },
          { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
        ],
        filter: [
          { field: 'last_status', options: ['not_connected', 'idle', 'running', 'success', 'failed', 'cancelled'] },
          { field: 'schedule_status', options: ['not_connected', 'scheduled', 'paused', 'failed'] },
        ],
        actions: {
          toolbar: [
            ...automationPresetActions,
            {
              label: '新增自动化',
              primary: automationPresetActions.length === 0,
              run: 'db:create:app_automations',
              input: {
                title: '新的自动化',
                enabled: false,
                schedule: '未设置',
                native_action: '',
                description: '写清触发条件、处理范围和失败时如何提示用户。',
                last_status: 'not_connected',
                last_run_summary: '用户生成应用的自动化运行桥尚未接入时，必须保持未接入状态。',
              },
            },
          ],
          row: [
            {
              label: '立即运行',
              run: 'native:app:run-automation',
              input: { confirmed: true },
              confirm: '确认立即运行这条应用自动化？运行结果会写入「运行结果」。',
            },
            {
              label: '同步定时任务',
              run: 'native:app:sync-automation-schedule',
              confirm: '确认把这条应用自动化同步为 Lumos 定时任务？关闭自动化会暂停关联任务。',
            },
          ],
        },
      },
      detail: {
        view: {
          form: [
            { type: 'text', name: 'title', label: '名称', required: true },
            { type: 'switch', name: 'enabled', label: '启用' },
            { type: 'text', name: 'schedule', label: '触发规则', placeholder: '例如：每天 09:00 / 每 2 小时 / 手动触发' },
            { type: 'text', name: 'native_action', label: '执行动作', placeholder: '例如：goofish:sync；留空表示未接入' },
            { type: 'textarea', name: 'description', label: '说明', rows: 4 },
            {
              type: 'select',
              name: 'last_status',
              label: '最近状态',
              options: ['not_connected', 'idle', 'running', 'success', 'failed', 'cancelled'],
            },
            { type: 'textarea', name: 'last_run_summary', label: '最近结果', rows: 4 },
            {
              type: 'select',
              name: 'schedule_status',
              label: '调度状态',
              options: ['not_connected', 'scheduled', 'paused', 'failed'],
            },
            { type: 'text', name: 'next_run_at', label: '下次运行时间' },
            { type: 'textarea', name: 'schedule_error', label: '调度失败原因', rows: 3 },
          ],
          submit: { label: '保存自动化', run: 'db:update:app_automations' },
        },
      },
    },
    'pages/im.json': {
      title: '通知命令',
      description: '配置应用通知目标，记录 IM 命令模板、确认边界和执行结果。',
      layout: 'single',
      blocks: [
        {
          type: 'card',
          title: '接入边界',
          children: [
            {
              type: 'markdown',
              content: [
                '- 应用可通过平台桥给用户自己的微信 IM 发送通知；用户回复仍进入主 Agent。',
                '- 微信通知依赖用户先在微信里给 Lumos/Clawbot 发过消息完成绑定。',
                `- 外部微信可用 /app ${input.appName} status、/app ${input.appName} runs、/app ${input.appName} acceptance、/app ${input.appName} help 查看通用只读结果。`,
                '- 业务写操作和高风险命令必须回到应用内确认，不能从通用微信入口直接执行。',
              ].join('\n'),
            },
          ],
        },
        {
          type: 'table',
          data: '{{ db.app_notifications }}',
          columns: [
            { field: 'target_label', label: '通知目标', search: true },
            { field: 'channel', label: '渠道', render: 'tag' },
            { field: 'provider_id', label: '服务商', render: 'tag' },
            { field: 'status', label: '状态', render: 'tag' },
            { field: 'last_error', label: '失败原因', search: true },
            { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
          ],
          search: { fields: ['target_label', 'last_error'] },
          filter: [
            { field: 'status', options: ['not_connected', 'ready', 'sent', 'failed'] },
          ],
          actions: {
            toolbar: [
              {
                label: '新增通知目标',
                primary: true,
                run: 'db:create:app_notifications',
                input: {
                  channel: 'wechat_im',
                  provider_id: 'wechat',
                  chat_id: '',
                  target_label: '默认微信用户',
                  title: '应用测试通知',
                  text: '这是一条来自应用的测试通知。用户回复会进入 Lumos 主 Agent。',
                  status: 'not_connected',
                  last_error: '首次发送前，请先在微信里给 Lumos/Clawbot 发一条消息完成绑定。',
                },
              },
              {
                label: '发送测试通知',
                run: 'im:notify',
                input: {
                  title: '应用测试通知',
                  text: '这是一条来自应用的测试通知。用户回复会进入 Lumos 主 Agent。',
                  target_label: '默认微信用户',
                },
              },
            ],
            row: [
              {
                label: '发送测试通知',
                run: 'im:notify',
                confirm: '确认发送这条应用通知到微信？',
              },
            ],
          },
        },
        {
          type: 'table',
          data: '{{ db.app_command_runs }}',
          columns: [
            { field: 'command', label: '命令', search: true },
            { field: 'risk_level', label: '风险', render: 'tag' },
            { field: 'confirmation_required', label: '需确认', render: 'tag' },
            { field: 'status', label: '状态', render: 'tag' },
            { field: 'result_summary', label: '结果', search: true },
            { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
          ],
          search: { fields: ['command', 'result_summary', 'failure_reason'] },
          filter: [
            { field: 'risk_level', options: ['read', 'low_write', 'high_risk'] },
            { field: 'status', options: ['not_connected', 'draft', 'pending_confirmation', 'success', 'failed', 'rejected'] },
          ],
          actions: {
            toolbar: [
              ...genericCommandPresetActions,
              ...commandPresetActions,
              {
                label: '新增命令模板',
                primary: genericCommandPresetActions.length === 0 && commandPresetActions.length === 0,
                run: 'db:create:app_command_runs',
                input: {
                  command: '/status',
                  risk_level: 'read',
                  confirmation_required: false,
                  status: 'draft',
                  result_summary: `通用只读状态命令，可在应用内点击“测试命令”验证；外部微信也可发送 /app ${input.appName} status 查询。`,
                },
              },
            ],
            row: [
              {
                label: '测试命令',
                run: 'native:app:run-command',
                input: { confirmed: true },
                confirm: '确认在应用内测试执行这条 IM 命令？通用只读命令也可通过微信 /app 入口查询。',
              },
            ],
          },
        },
      ],
    },
    'pages/settings.json': {
      title: '设置',
      description: '配置默认视图、通知、AI 提示词、自动化开关和风险边界。',
      layout: 'form',
      form: [
        { type: 'text', name: 'default_view', label: '默认视图', placeholder: '例如：工作台' },
        {
          type: 'select',
          name: 'notification_channel',
          label: '通知方式',
          options: ['关闭', '系统通知', '微信 IM'],
          default: '关闭',
        },
        {
          type: 'textarea',
          name: 'ai_system_prompt',
          label: 'AI 提示词',
          rows: 6,
          placeholder: '写清这个应用的 AI 助手角色、边界和输出格式。',
        },
        {
          type: 'switch',
          name: 'automation_enabled',
          label: '启用自动化',
          default: false,
          description: '开启前必须确认运行结果和失败原因可见。',
        },
        {
          type: 'textarea',
          name: 'risk_note',
          label: '风险边界',
          rows: 4,
          placeholder: '例如：所有外部写操作都必须先生成草稿并由用户确认。',
        },
      ],
      submit: { label: '保存设置', run: 'db:create:app_settings', render: 'none' },
    },
    'pages/run-history.json': {
      title: '运行结果',
      description: '查看运行状态、结果摘要、失败原因和最近更新时间。',
      layout: 'single',
      blocks: [
        {
          type: 'card',
          title: '运行记录',
          children: [
            {
              type: 'markdown',
              content: '自动化、AI 处理或 IM 命令后续都应把结果写入这里，方便用户验收和重试。',
            },
          ],
        },
        {
          type: 'table',
          data: '{{ db.run_history }}',
          columns: [
            { field: 'title', label: '运行标题', search: true },
            { field: 'status', label: '状态', render: 'tag' },
            { field: 'summary', label: '结果摘要', search: true },
            { field: 'failure_reason', label: '失败原因', search: true },
            { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
          ],
          search: { fields: ['title', 'summary', 'failure_reason'] },
          filter: [{ field: 'status', options: ['running', 'success', 'failed', 'cancelled'] }],
        },
      ],
    },
  };
}

function buildGenericCommandPresetActions(appName: string): Array<{
  label: string;
  run: string;
  input: Record<string, unknown>;
}> {
  return [
    {
      label: '添加通用状态命令',
      run: 'db:create:app_command_runs',
      input: {
        command: '/status',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: `可点击“测试命令”查看当前应用状态；外部微信也可发送 /app ${appName} status 查询。`,
      },
    },
    {
      label: '添加运行记录命令',
      run: 'db:create:app_command_runs',
      input: {
        command: '/runs',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: `可点击“测试命令”查看最近运行结果；外部微信也可发送 /app ${appName} runs 查询。`,
      },
    },
    {
      label: '添加验收进度命令',
      run: 'db:create:app_command_runs',
      input: {
        command: '/acceptance',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: `可点击“测试命令”查看验收进度；外部微信也可发送 /app ${appName} acceptance 查询。`,
      },
    },
    {
      label: '添加帮助命令',
      run: 'db:create:app_command_runs',
      input: {
        command: '/help',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: `可点击“测试命令”查看通用命令说明；外部微信也可发送 /app ${appName} help 查询。`,
      },
    },
  ];
}
