import type { BuilderSession } from './session';
import {
  buildNativeShellPages,
  withNativeShellCollections,
  withNativeShellRoutes,
} from './native-shell-blueprint';

interface BuildOpts {
  now?: number;
}

export function buildEcommerceAssistantFiles(
  session: BuilderSession,
  opts: BuildOpts = {},
): Record<string, string> {
  const app = baseApp(session, opts);
  const routes = withNativeShellRoutes({
    default: 'studio',
    menu: [
      { id: 'studio', label: '工坊', icon: 'wand-sparkles', page: 'pages/studio.json' },
      { id: 'jobs', label: '任务', icon: 'list-checks', page: 'pages/jobs.json' },
      { id: 'library', label: '资料库', icon: 'package-search', page: 'pages/library.json' },
      { id: 'presets', label: '风格预设', icon: 'palette', page: 'pages/presets.json' },
    ],
  });
  const dataSchema = withNativeShellCollections({ collections: buildEcommerceCollections() });
  const businessPages = buildEcommercePages();
  return stringifyFiles({
    'app.json': app,
    'native-app-spec.json': buildEcommerceNativeAppSpec(app.name),
    'routes.json': routes,
    'data-schema.json': dataSchema,
    ...businessPages,
    ...buildNativeShellPages({
      appName: app.name,
      primaryPageId: 'studio',
      primaryCollection: 'product_inputs',
      primaryCollectionLabel: '商品输入',
      automationPresets: buildEcommerceAutomationPresets(),
      commandPresets: buildEcommerceCommandPresets(),
    }),
  });
}

function baseApp(session: BuilderSession, opts: BuildOpts) {
  const appName = session.appName ?? '电商商品助手';
  const description =
    session.appDescription ??
    '一键生成电商商品图、识别商品资料、批量出图、风格预设和场景方向调整。';
  return {
    id: session.appId ?? 'ecommerce-assistant',
    name: appName,
    version: `0.1.${Math.floor((opts.now ?? Date.now()) / 1000) % 100000}`,
    description,
    icon: './icon.png',
    category: 'creative',
    entry: 'studio',
    requires: { knowledge: 'none', llm: 'chat' },
    permissions: { data: 'isolated', system: ['notification', 'schedule', 'im-notification'] },
    tags: ['电商', '商品图', 'AI 出图'],
  };
}

function buildEcommerceCollections(): unknown[] {
  return [
    buildProductInputsCollection(),
    buildProductBriefsCollection(),
    buildImageJobsCollection(),
    buildImageOutputsCollection(),
    buildStylePresetsCollection(),
  ];
}

function buildProductInputsCollection() {
  return {
    name: 'product_inputs',
    label: '商品输入',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'title', type: 'string', label: '商品标题', required: true, indexed: true },
      { name: 'category_hint', type: 'string', label: '类目提示', indexed: true },
      { name: 'main_image_path', type: 'string', label: '主图路径', required: true },
      { name: 'reference_image_paths', type: 'text', label: '参考图路径（JSON）' },
      { name: 'note', type: 'text', label: '备注' },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: ['ready', 'archived'],
        default: 'ready',
        indexed: true,
      },
      { name: 'created_at', type: 'datetime', label: '创建时间' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['status'], ['updated_at']],
  };
}

function buildProductBriefsCollection() {
  return {
    name: 'product_briefs',
    label: '商品资料',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'input_id', type: 'string', label: '关联输入', required: true, indexed: true },
      { name: 'product_type', type: 'string', label: '商品类型', indexed: true },
      { name: 'category_bucket', type: 'string', label: '类目', indexed: true },
      { name: 'size_class', type: 'string', label: '体积' },
      { name: 'core_selling_points', type: 'text', label: '核心卖点（JSON）' },
      { name: 'target_audience', type: 'text', label: '目标用户（JSON）' },
      { name: 'recommended_aspect_ratio', type: 'string', label: '推荐比例', default: '4:5' },
      { name: 'recommended_shot_type', type: 'string', label: '推荐机位' },
      { name: 'fidelity_focus', type: 'text', label: '保真要点（JSON）' },
      { name: 'consistency_anchors', type: 'text', label: '一致性锚点（JSON）' },
      { name: 'avoid_elements', type: 'text', label: '禁止元素（JSON）' },
      { name: 'raw_brief', type: 'text', label: 'Brief 原始 JSON' },
      { name: 'confidence', type: 'integer', label: '置信度' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['input_id'], ['updated_at']],
  };
}

function buildImageJobsCollection() {
  return {
    name: 'image_jobs',
    label: '出图任务',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'input_id', type: 'string', label: '关联输入', required: true, indexed: true },
      { name: 'preset_id', type: 'string', label: '风格预设', indexed: true },
      { name: 'aspect_ratio', type: 'string', label: '画面比例' },
      {
        name: 'status',
        type: 'enum',
        label: '状态',
        options: [
          'queued',
          'preprocessing',
          'identifying',
          'cutting',
          'planning',
          'generating',
          'scoring',
          'refining',
          'qc',
          'completed',
          'failed',
          'cancelled',
        ],
        default: 'queued',
        indexed: true,
      },
      { name: 'stage', type: 'string', label: '当前阶段' },
      { name: 'progress', type: 'integer', label: '进度（0-100）', default: 0 },
      { name: 'cutout_path', type: 'string', label: '抠图路径' },
      { name: 'final_image_path', type: 'string', label: '终版图路径' },
      { name: 'winner_direction', type: 'string', label: '选中方向' },
      { name: 'fallback_used', type: 'boolean', label: '是否走兜底', default: false },
      { name: 'cutout_attempts', type: 'integer', label: '抠图重试次数', default: 0 },
      { name: 'scene_attempts', type: 'integer', label: '场景重试次数', default: 0 },
      { name: 'refine_attempts', type: 'integer', label: '精修重试次数', default: 0 },
      { name: 'failure_reason', type: 'text', label: '失败原因' },
      { name: 'failure_stage', type: 'string', label: '失败阶段' },
      { name: 'summary', type: 'text', label: '运行摘要' },
      { name: 'created_at', type: 'datetime', label: '创建时间' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['input_id'], ['status'], ['updated_at']],
  };
}

function buildImageOutputsCollection() {
  return {
    name: 'image_outputs',
    label: '出图结果',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'job_id', type: 'string', label: '关联任务', required: true, indexed: true },
      { name: 'input_id', type: 'string', label: '关联输入', indexed: true },
      {
        name: 'kind',
        type: 'enum',
        label: '类型',
        options: ['cutout', 'catalog', 'lifestyle', 'campaign', 'final', 'fallback'],
        required: true,
        indexed: true,
      },
      { name: 'iteration', type: 'integer', label: '迭代轮次', default: 1 },
      { name: 'image_path', type: 'string', label: '图片路径', required: true },
      { name: 'thumbnail_path', type: 'string', label: '缩略图路径' },
      { name: 'aspect_ratio', type: 'string', label: '画面比例' },
      { name: 'qc_pass', type: 'boolean', label: '质检通过', default: false },
      { name: 'qc_score', type: 'integer', label: '质检评分' },
      { name: 'qc_summary', type: 'text', label: '质检结果' },
      { name: 'qc_fail_reason', type: 'text', label: '质检失败原因' },
      { name: 'prompt', type: 'text', label: '使用提示词' },
      { name: 'is_winner', type: 'boolean', label: '是否选中', default: false, indexed: true },
      { name: 'created_at', type: 'datetime', label: '创建时间' },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['job_id'], ['kind'], ['is_winner']],
  };
}

function buildStylePresetsCollection() {
  return {
    name: 'style_presets',
    label: '风格预设',
    fields: [
      { name: 'id', type: 'uuid', primary: true, auto: 'uuid' },
      { name: 'name', type: 'string', label: '名称', required: true, indexed: true },
      {
        name: 'direction',
        type: 'enum',
        label: '方向',
        options: ['catalog', 'lifestyle', 'campaign', 'custom'],
        default: 'custom',
        indexed: true,
      },
      { name: 'scene', type: 'text', label: '场景描述' },
      { name: 'composition', type: 'text', label: '构图描述' },
      { name: 'lighting', type: 'text', label: '灯光描述' },
      { name: 'mood', type: 'text', label: '情绪描述' },
      { name: 'negative_rules', type: 'text', label: '负面规则（JSON 数组）' },
      { name: 'is_builtin', type: 'boolean', label: '内置', default: false },
      { name: 'enabled', type: 'boolean', label: '启用', default: true, indexed: true },
      { name: 'updated_at', type: 'datetime', label: '更新时间', auto: 'now' },
    ],
    indexes: [['direction'], ['enabled']],
  };
}

function buildEcommercePages(): Record<string, unknown> {
  return {
    'pages/studio.json': buildStudioPage(),
    'pages/jobs.json': buildJobsPage(),
    'pages/library.json': buildLibraryPage(),
    'pages/presets.json': buildPresetsPage(),
  };
}

function buildStudioPage() {
  return {
    title: '商品图工坊',
    description: '上传商品主图和参考图，一键生成电商商品图。任务状态、失败原因和重跑入口都在这里。',
    layout: 'single',
    blocks: [
      {
        type: 'card',
        title: '出图流程',
        children: [
          {
            type: 'markdown',
            content: [
              '- 上传 1 张主图，最多 4 张参考图（商品保真用）。',
              '- AI 自动筛参考图、识别商品 brief、抠图、生成 3 个方向第一轮图、自动评分选最优、终版精修、终版质检。',
              '- 抠图最多重试 2 次，场景最多 3 轮，精修最多 2 次；失败时自动降级到白底兜底。',
              '- 生成的图片保存在应用内集合，可重跑、下载、对比。',
            ].join('\n'),
          },
          {
            type: 'button',
            label: '新建出图任务',
            primary: true,
            run: 'native:ecommerce:create-job',
            confirm: '确认开始一次商品图生成？任务会按 SOP 流程自动执行。',
          },
          { type: 'button', label: '查看任务进度', open: 'page:jobs' },
        ],
      },
      {
        type: 'card',
        title: '商品输入',
        children: [
          {
            type: 'markdown',
            content: '所有输入会先保留在应用内集合，可重复出图、对比方向、修改备注。',
          },
        ],
      },
      {
        type: 'table',
        data: '{{ db.product_inputs }}',
        columns: [
          { field: 'title', label: '商品', search: true },
          { field: 'category_hint', label: '类目', search: true },
          { field: 'status', label: '状态', render: 'tag' },
          { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
        ],
        search: { fields: ['title', 'category_hint', 'note'] },
        filter: [{ field: 'status', options: ['ready', 'archived'] }],
        actions: {
          toolbar: [
            {
              label: '记录新商品输入',
              run: 'db:create:product_inputs',
              input: {
                title: '新商品',
                category_hint: '',
                main_image_path: '',
                status: 'ready',
                note: '主图路径必须填写后才能开始出图任务。',
              },
            },
          ],
          row: [
            {
              label: '基于此输入出图',
              run: 'native:ecommerce:create-job',
              confirm: '确认基于这条商品输入开始一次商品图生成任务？',
            },
            {
              label: '归档',
              run: 'db:update:product_inputs',
              input: { status: 'archived' },
              confirm: '归档后此条不再出现在新建任务列表，可在筛选 archived 后恢复。',
            },
          ],
        },
      },
    ],
  };
}

function buildJobsPage() {
  return {
    title: '出图任务',
    description: '查看任务运行状态、阶段、进度、失败原因和重跑入口。',
    layout: 'list-detail',
    list: {
      type: 'table',
      data: '{{ db.image_jobs }}',
      columns: [
        { field: 'input_id', label: '商品输入', search: true },
        { field: 'status', label: '状态', render: 'tag' },
        { field: 'stage', label: '阶段', search: true },
        { field: 'progress', label: '进度', sortable: true },
        { field: 'winner_direction', label: '选中方向', render: 'tag' },
        { field: 'failure_reason', label: '失败原因', search: true },
        { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
      ],
      filter: [
        {
          field: 'status',
          options: [
            'queued',
            'preprocessing',
            'identifying',
            'cutting',
            'planning',
            'generating',
            'scoring',
            'refining',
            'qc',
            'completed',
            'failed',
            'cancelled',
          ],
        },
      ],
      actions: {
        row: [
          {
            label: '取消任务',
            run: 'native:ecommerce:cancel-job',
            confirm: '确认取消这条任务？已生成的中间图会保留，状态变为 cancelled。',
          },
          {
            label: '重新运行',
            run: 'native:ecommerce:retry-job',
            confirm: '确认重新运行这条任务？会重新执行整个 SOP 流程，已有结果会保留。',
          },
        ],
      },
    },
    detail: {
      view: {
        form: [
          { type: 'text', name: 'input_id', label: '商品输入' },
          {
            type: 'select',
            name: 'status',
            label: '状态',
            options: [
              'queued',
              'preprocessing',
              'identifying',
              'cutting',
              'planning',
              'generating',
              'scoring',
              'refining',
              'qc',
              'completed',
              'failed',
              'cancelled',
            ],
          },
          { type: 'text', name: 'stage', label: '当前阶段' },
          { type: 'number', name: 'progress', label: '进度（0-100）' },
          { type: 'text', name: 'final_image_path', label: '终版图路径' },
          { type: 'text', name: 'winner_direction', label: '选中方向' },
          { type: 'textarea', name: 'failure_reason', label: '失败原因', rows: 3 },
          { type: 'textarea', name: 'summary', label: '摘要', rows: 4 },
        ],
        submit: { label: '保存任务', run: 'db:update:image_jobs' },
      },
    },
  };
}

function buildLibraryPage() {
  return {
    title: '资料库',
    description: '查看 AI 识别的商品 brief 和已生成的图片资源；可用于重复出图或导出。',
    layout: 'single',
    blocks: [
      {
        type: 'card',
        title: '商品资料',
        children: [
          {
            type: 'markdown',
            content: '资料 = AI 识别后的 productType、卖点、目标用户、推荐拍摄风格。每条 brief 对应一份 product_input。',
          },
        ],
      },
      {
        type: 'table',
        data: '{{ db.product_briefs }}',
        columns: [
          { field: 'product_type', label: '商品类型', search: true },
          { field: 'category_bucket', label: '类目', render: 'tag' },
          { field: 'size_class', label: '体积', render: 'tag' },
          { field: 'recommended_aspect_ratio', label: '推荐比例', render: 'tag' },
          { field: 'confidence', label: '置信度', sortable: true },
          { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
        ],
        search: { fields: ['product_type', 'category_bucket'] },
      },
      {
        type: 'card',
        title: '已生成图片',
        children: [
          {
            type: 'markdown',
            content: '记录所有阶段的产物（抠图、第一轮、终版、兜底），用于追溯、对比、二次出图。',
          },
        ],
      },
      {
        type: 'table',
        data: '{{ db.image_outputs }}',
        columns: [
          { field: 'job_id', label: '任务', search: true },
          { field: 'kind', label: '类型', render: 'tag' },
          { field: 'iteration', label: '轮次', sortable: true },
          { field: 'qc_pass', label: '质检', render: 'tag' },
          { field: 'qc_score', label: '评分', sortable: true },
          { field: 'is_winner', label: '是否选中', render: 'tag' },
          { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
        ],
        filter: [
          { field: 'kind', options: ['cutout', 'catalog', 'lifestyle', 'campaign', 'final', 'fallback'] },
        ],
      },
    ],
  };
}

function buildPresetsPage() {
  return {
    title: '风格预设',
    description: '管理 catalog/lifestyle/campaign 三个内置方向，以及用户自定义预设。',
    layout: 'list-detail',
    list: {
      type: 'table',
      data: '{{ db.style_presets }}',
      columns: [
        { field: 'name', label: '名称', search: true },
        { field: 'direction', label: '方向', render: 'tag' },
        { field: 'is_builtin', label: '内置', render: 'tag' },
        { field: 'enabled', label: '启用', render: 'tag' },
        { field: 'updated_at', label: '更新时间', render: 'date', sortable: true },
      ],
      filter: [
        { field: 'direction', options: ['catalog', 'lifestyle', 'campaign', 'custom'] },
      ],
      actions: {
        toolbar: [
          {
            label: '新增预设',
            primary: true,
            run: 'db:create:style_presets',
            input: {
              name: '新预设',
              direction: 'custom',
              scene: '',
              composition: '',
              lighting: '',
              mood: '',
              negative_rules: '[]',
              is_builtin: false,
              enabled: true,
            },
          },
        ],
        row: [
          {
            label: '禁用',
            run: 'db:update:style_presets',
            input: { enabled: false },
            confirm: '禁用后该预设不会被自动选用，可重新启用。',
          },
        ],
      },
    },
    detail: {
      view: {
        form: [
          { type: 'text', name: 'name', label: '名称', required: true },
          {
            type: 'select',
            name: 'direction',
            label: '方向',
            options: ['catalog', 'lifestyle', 'campaign', 'custom'],
          },
          { type: 'textarea', name: 'scene', label: '场景描述', rows: 4 },
          { type: 'textarea', name: 'composition', label: '构图描述', rows: 4 },
          { type: 'textarea', name: 'lighting', label: '灯光描述', rows: 4 },
          { type: 'textarea', name: 'mood', label: '情绪描述', rows: 3 },
          {
            type: 'textarea',
            name: 'negative_rules',
            label: '负面规则（JSON 数组）',
            rows: 4,
            placeholder: '["no clutter","no human","no pet"]',
          },
          { type: 'switch', name: 'enabled', label: '启用' },
        ],
        submit: { label: '保存预设', run: 'db:update:style_presets' },
      },
    },
  };
}

function buildEcommerceAutomationPresets() {
  return [
    {
      label: '添加批量出图自动化',
      primary: true,
      input: {
        title: '批量出图（每日）',
        enabled: false,
        schedule: '每天 09:00',
        native_action: 'ecommerce:batch-generate',
        description: '扫描所有 ready 状态且没有 final_image_path 的商品输入，逐条排队执行 SOP；并发数受应用设置控制。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请先在设置页确认默认风格预设、并发上限和图像服务商配置。',
      },
    },
    {
      label: '添加失败任务复跑',
      input: {
        title: '失败任务复跑',
        enabled: false,
        schedule: '每 30 分钟',
        native_action: 'ecommerce:retry-failed',
        description: '扫描 status=failed 且 1 小时内的任务，按 SOP 回路规则自动重跑（最多 1 次）。',
        last_status: 'idle',
        schedule_status: 'not_connected',
        last_run_summary: '默认禁用。开启前请确认失败原因可见，避免重复消耗图像配额。',
      },
    },
  ];
}

function buildEcommerceCommandPresets() {
  return [
    {
      label: '添加电商状态命令',
      primary: true,
      input: {
        command: '/ecommerce status',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看应用是否就绪、图像服务商配置和最近一条任务的状态摘要。',
      },
    },
    {
      label: '添加出图任务命令',
      input: {
        command: '/ecommerce jobs',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看最近出图任务和阶段；外部微信也可发送 /app 电商商品助手 runs 查询。',
      },
    },
    {
      label: '添加商品输入命令',
      input: {
        command: '/ecommerce inputs',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看应用内的商品输入数量和最近一条输入的标题。',
      },
    },
    {
      label: '添加资料命令',
      input: {
        command: '/ecommerce briefs',
        risk_level: 'read',
        confirmation_required: false,
        status: 'draft',
        result_summary: '查看最近识别的商品 brief 摘要（productType、推荐比例、置信度）。',
      },
    },
  ];
}

function buildEcommerceNativeAppSpec(appName: string) {
  return {
    version: 1,
    summary: `${appName}：基于 SOP 流程一键生成电商商品图，自动识别商品 brief、抠图、3 个方向第一轮图、AI 评分、终版精修、终版质检和白底兜底；商品输入、风格预设和任务历史在应用内可见可重跑。`,
    userVisibleScope: buildEcommerceUserVisibleScope(),
    status: buildEcommerceStatus(),
    settings: buildEcommerceSettings(),
    data: {
      entities: [
        'product_inputs',
        'product_briefs',
        'image_jobs',
        'image_outputs',
        'style_presets',
        'app_settings',
        'app_automations',
        'run_history',
        'assistant_messages',
        'app_notifications',
        'app_command_runs',
        'acceptance_checks',
      ],
      reusableStores: ['settings', 'run_history', 'notifications', 'command_runs'],
    },
    ai: {
      enabled: true,
      promptSettings: true,
      draftBeforeWrite: true,
      visibleFailureHandling: true,
    },
    automations: {
      enabled: true,
      controls: ['enable', 'pause', 'run_now', 'edit', 'delete'],
      visibleRunResults: true,
    },
    runResults: {
      visible: true,
      states: ['running', 'success', 'failed', 'cancelled'],
      failureReasons: true,
      retry: true,
    },
    im: buildEcommerceIm(),
    risk: buildEcommerceRisk(),
    acceptance: buildEcommerceAcceptance(),
  };
}

function buildEcommerceUserVisibleScope() {
  return [
    '在工坊页上传 1 张商品主图和最多 4 张参考图，记录类目和备注。',
    '点击「新建出图任务」基于商品输入和当前默认风格预设启动一次 SOP 流程；任务进度、阶段和失败原因在任务页可见。',
    '在任务页可取消、重跑、查看详情；每个任务保留所有阶段产物（抠图、3 个方向第一轮图、终版、可能的兜底白底图）。',
    '在资料库页查看 AI 识别的商品 brief、已生成图片记录和评分。',
    '在风格预设页管理 catalog/lifestyle/campaign 内置方向和用户自定义预设。',
    '在设置页保存默认画面比例、并发上限、AI 提示词和风险边界。',
    '通过应用内通用通知命令页可记录 IM 通知目标、查询任务、查看运行结果摘要；高风险写操作必须回到应用内确认。',
    '图像服务商未配置或调用失败时，任务状态进入 failed 并显示明确失败原因，不展示假图。',
  ];
}

function buildEcommerceStatus() {
  return {
    states: ['not_configured', 'needs_auth', 'ready', 'running', 'failed', 'not_connected'],
    readyCriteria: [
      '应用页面可打开，设置页已保存基础风险边界。',
      '至少配置一个支持 image:generate 能力的服务商（Gemini / 国产兼容 / DashScope 等）。',
      '商品输入、出图任务、出图结果、商品资料和风格预设集合可读写。',
      '图像服务商不可达或配额耗尽时，必须显示 failed 和具体失败原因，不展示假图。',
    ],
    notConnectedBehavior:
      '缺图像服务商、API Key 或 Claude 服务商时，工坊页和任务页必须显示 not_connected / failed 和原因；用户尚未上传任何商品输入时显示空态引导而不是假数据。',
  };
}

function buildEcommerceSettings() {
  return [
    { id: 'image-provider', label: '图像服务商', fields: ['默认 Provider', '默认模型', '兜底模型'] },
    { id: 'sop-defaults', label: '出图默认值', fields: ['默认画面比例', '默认风格预设', '并发上限', '保留中间图'] },
    { id: 'sop-retries', label: '回路控制', fields: ['抠图重试上限', '场景重试上限', '精修重试上限', '是否启用白底兜底'] },
    { id: 'ai-prompts', label: 'AI 提示词', fields: ['Brief 识别提示', '方向规划提示', '评分提示', '终版精修提示', '失败回路提示'] },
    { id: 'risk', label: '风险边界', fields: ['写操作确认', '高风险不做项', '失败时保留中间图'] },
  ];
}

function buildEcommerceIm() {
  return {
    enabled: true,
    lowRiskCommands: [
      '/ecommerce status',
      '/ecommerce jobs',
      '/ecommerce inputs',
      '/ecommerce briefs',
    ],
    confirmationRequiredFor: [
      '通过 IM 命令触发新出图任务（必须在应用内确认输入合法且配额充足）',
      '通过 IM 命令重跑失败任务',
    ],
    visibleCommandResults: true,
  };
}

function buildEcommerceRisk() {
  return {
    writeActionsRequireConfirmation: true,
    highRiskActions: [
      '启动新出图任务（消耗图像配额）',
      '批量启动出图任务',
      '重新运行失败任务（再次消耗配额）',
      '删除商品输入或任务记录',
    ],
    outOfScope: [
      '自动发布到淘宝 / 拼多多 / 京东 / 亚马逊（无平台账号集成）',
      '自动改价、上下架、修改库存（不在第一阶段）',
      '把生成图片回写到第三方电商后台',
      '绕过用户确认批量调用图像服务商接口',
      '在未登录用户图像服务商时使用 mock 数据冒充已生成',
    ],
  };
}

function buildEcommerceAcceptance() {
  return [
    {
      id: 'installation-self-check',
      label: '安装自检',
      howToVerify:
        '安装完成后查看安装自检结果，或在状态页点击重新运行安装自检；通过或失败会自动写入本验收项。',
    },
    {
      id: 'open-studio',
      label: '打开工坊',
      howToVerify: '打开工坊页，能看到出图流程说明、新建出图入口和商品输入空态引导。',
    },
    {
      id: 'create-input',
      label: '记录商品输入',
      howToVerify: '在工坊页点击「记录新商品输入」，输入商品标题和主图路径后保存，列表里出现新输入。',
    },
    {
      id: 'create-job',
      label: '新建出图任务',
      howToVerify:
        '基于一条 ready 状态的商品输入点击「基于此输入出图」，任务页出现 running 任务；运行过程中阶段和进度可见，失败时 failure_reason 可见。',
    },
    {
      id: 'view-job-detail',
      label: '查看任务详情',
      howToVerify:
        '在任务页打开任意任务，能看到状态、阶段、进度、抠图路径、终版图路径、失败原因和摘要字段。',
    },
    {
      id: 'cancel-job',
      label: '取消任务',
      howToVerify:
        '对一个 running / queued 任务点击「取消任务」，状态变为 cancelled，已生成的中间图保留。',
    },
    {
      id: 'retry-job',
      label: '重新运行任务',
      howToVerify:
        '对一个 failed / cancelled 任务点击「重新运行」，会创建一条新任务记录复用原始输入和预设。',
    },
    {
      id: 'view-library',
      label: '查看资料库',
      howToVerify: '在资料库页能看到 product_briefs 和 image_outputs 两张表；至少跑过 1 次任务后两张表非空。',
    },
    {
      id: 'manage-presets',
      label: '管理风格预设',
      howToVerify:
        '在风格预设页能看到内置 catalog/lifestyle/campaign 三个方向，能新增、编辑、启用 / 禁用自定义预设。',
    },
    {
      id: 'save-settings',
      label: '保存提示词和风险边界',
      howToVerify:
        '进入设置页，保存默认画面比例、并发上限、AI 提示词和风险边界；保存成功后再次打开仍能看到。',
    },
    {
      id: 'image-provider-failure-visible',
      label: '图像服务商失败可见',
      howToVerify:
        '在未配置图像服务商或 API Key 失效时启动任务，任务进入 failed 状态并显示「图像服务商未配置」或具体失败原因，不展示假图。',
    },
    {
      id: 'review-im-commands',
      label: '查看 IM 命令模板',
      howToVerify:
        '进入通知命令页，能看到 /ecommerce status、/ecommerce jobs、/ecommerce inputs、/ecommerce briefs 命令模板；高风险命令必须在应用内确认。',
    },
    {
      id: 'review-automations',
      label: '查看自动化',
      howToVerify: '进入自动化页，能看到批量出图、失败复跑等自动化的未接入或运行状态。',
    },
    {
      id: 'review-run-history',
      label: '查看运行结果',
      howToVerify: '进入运行结果页，能看到出图任务的运行状态、摘要、失败原因和重试入口说明。',
    },
  ];
}

function stringifyFiles(files: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([filePath, content]) => [
      filePath,
      `${JSON.stringify(content, null, 2)}\n`,
    ]),
  );
}
