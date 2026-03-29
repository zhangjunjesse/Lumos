import { TaskStatus, type Task } from '@/lib/task-management/types';

const mockGetSession = jest.fn();
const mockGetSetting = jest.fn();
const mockGenerateObjectFromProvider = jest.fn();
const mockListPublishedPromptCapabilities = jest.fn();
const mockListPublishedCodeCapabilities = jest.fn();
const mockGetProvider = jest.fn();
const mockGetDefaultProvider = jest.fn();
const mockGetAllProviders = jest.fn();

jest.mock('@/lib/db/sessions', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

jest.mock('@/lib/db/providers', () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  getDefaultProvider: () => mockGetDefaultProvider(),
  getAllProviders: (...args: unknown[]) => mockGetAllProviders(...args),
}));

jest.mock('@/lib/text-generator', () => ({
  generateObjectFromProvider: (...args: unknown[]) => mockGenerateObjectFromProvider(...args),
}));

jest.mock('@/lib/db/capabilities', () => ({
  listPublishedPromptCapabilities: (...args: unknown[]) => mockListPublishedPromptCapabilities(...args),
  listPublishedCodeCapabilities: (...args: unknown[]) => mockListPublishedCodeCapabilities(...args),
}));

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-planner-test-001',
    sessionId: overrides.sessionId ?? 'session-planner-test-001',
    summary: overrides.summary ?? '整理项目结论',
    requirements: overrides.requirements ?? ['输出结论'],
    status: overrides.status ?? TaskStatus.PENDING,
    progress: overrides.progress ?? 0,
    createdAt: overrides.createdAt ?? new Date('2026-03-20T00:00:00.000Z'),
    metadata: overrides.metadata ?? {},
  };
}

function buildProvider(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Provider ${id}`,
    provider_type: 'anthropic',
    capabilities: '["agent-chat"]',
    api_key: 'sk-test',
    auth_mode: 'api_key',
    model_catalog: '[]',
    model_catalog_source: 'default',
    model_catalog_updated_at: null,
    ...overrides,
  };
}

describe('scheduling planner', () => {
  beforeEach(() => {
    jest.resetModules();
    mockGetSession.mockReset();
    mockGetSetting.mockReset();
    mockGenerateObjectFromProvider.mockReset();
    mockListPublishedPromptCapabilities.mockReset();
    mockListPublishedCodeCapabilities.mockReset();
    mockGetProvider.mockReset();
    mockGetDefaultProvider.mockReset();
    mockGetAllProviders.mockReset();
    mockGetSession.mockReturnValue(undefined);
    mockGetSetting.mockReturnValue('');
    mockListPublishedPromptCapabilities.mockReturnValue([]);
    mockListPublishedCodeCapabilities.mockReturnValue([]);
    mockGetProvider.mockImplementation((id: string) => (
      id ? buildProvider(id) : undefined
    ));
    mockGetDefaultProvider.mockReturnValue(undefined);
    mockGetAllProviders.mockReturnValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses heuristic simple strategy for narrow single-step tasks', async () => {
    const task = buildTask({
      summary: '输出一句简短摘要',
      requirements: ['一句话即可'],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'simple',
      source: 'heuristic',
      analysis: {
        complexity: 'simple',
        needsBrowser: false,
        needsNotification: false,
        needsMultipleSteps: false,
        needsParallel: false,
      },
    });
    expect(plan.workflowDsl).toBeUndefined();
  });

  test('does not infer notification workflow from negated notification context', async () => {
    const task = buildTask({
      summary: '把“Lumos 工作流主链已打通，但仍需继续收口”改写成一句更自然的话',
      requirements: ['只输出一句中文，不要分点，不要解释'],
      metadata: {
        relevantMessages: ['这是简单执行验收任务，不需要浏览器，不需要通知，不需要联网'],
      },
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'simple',
      source: 'heuristic',
      analysis: {
        needsBrowser: false,
        needsNotification: false,
        needsMultipleSteps: false,
        needsParallel: false,
      },
    });
    expect(plan.workflowDsl).toBeUndefined();
  });

  test('builds agent workflow handoff prompt as executable instructions instead of meta summary', async () => {
    const task = buildTask({
      summary: '先整理需求，再给出行动方案，最后输出交付清单',
      requirements: [
        '先用3条要点总结目标',
        '然后列出3个主要风险',
        '最后给出5步执行计划',
      ],
      metadata: {
        relevantMessages: ['这是多步代理工作流验收任务，不需要浏览器，不需要通知，不需要联网'],
      },
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan.strategy).toBe('workflow');
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual(['analyze', 'draft', 'finalize']);
    expect(plan.workflowDsl?.steps[0]?.input).toMatchObject({
      role: 'researcher',
    });
    expect(String(plan.workflowDsl?.steps[0]?.input?.prompt || '')).toContain('报告任务的目标');
    expect(String(plan.workflowDsl?.steps[0]?.input?.prompt || '')).toContain('不要写元描述');
    expect(plan.workflowDsl?.steps[1]?.input).toMatchObject({
      role: 'researcher',
      context: {
        analysis: 'steps.analyze.output.summary',
      },
    });
    expect(String(plan.workflowDsl?.steps[1]?.input?.prompt || '')).toContain('精简 Markdown 提纲');
    expect(plan.workflowDsl?.steps[2]?.input).toMatchObject({
      role: 'integration',
      context: {
        analysis: 'steps.analyze.output.summary',
        outline: 'steps.draft.output.summary',
      },
    });
  });

  test('uses staged implementation workflow for implementation requests from main agent chat', async () => {
    const task = buildTask({
      summary: '实现用户管理系统',
      requirements: [],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Implementation work should be staged across analysis, execution, and final delivery.',
      analysis: {
        complexity: 'complex',
        needsMultipleSteps: true,
        needsParallel: false,
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual(['analyze', 'implement', 'finalize']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'implement')?.input).toMatchObject({
      prompt: 'steps.analyze.output.summary',
      role: 'coder',
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'finalize')?.input).toMatchObject({
      role: 'integration',
      context: {
        implementation: 'steps.implement.output.summary',
      },
    });
  });

  test('uses heuristic browser workflow when a concrete url and screenshot intent are present', async () => {
    const task = buildTask({
      summary: '打开 https://example.com 并截图，然后通知我',
      requirements: ['打开页面', '截图', '通知结果'],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      analysis: {
        needsBrowser: true,
        needsNotification: true,
        needsParallel: false,
        detectedUrl: 'https://example.com',
        detectedUrls: ['https://example.com'],
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual(['draft', 'browse', 'capture', 'notify']);
  });

  test('uses search workflow when the task asks to search the web without an explicit url', async () => {
    const task = buildTask({
      summary: '打开百度',
      requirements: ['搜索 数据安全', '截图给我'],
      metadata: {
        relevantMessages: ['打开 百度。搜索 数据安全。截图给我。'],
      },
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      analysis: {
        complexity: 'complex',
        needsBrowser: true,
        needsMultipleSteps: true,
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual([
      'analyze',
      'search',
      'capture',
      'summarize',
    ]);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'search')?.input).toMatchObject({
      action: 'navigate',
      url: 'https://www.baidu.com/s?wd=%E6%95%B0%E6%8D%AE%E5%AE%89%E5%85%A8',
      createPage: true,
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'summarize')?.input).toMatchObject({
      role: 'integration',
      context: {
        searchPlan: {
          engine: '百度',
          query: '数据安全',
        },
        searchResult: {
          lines: 'steps.search.output.lines',
          screenshotPath: 'steps.capture.output.screenshotPath',
        },
      },
    });
  });

  test('uses browser search plus synthesis workflow for report tasks that require search and export', async () => {
    const task = buildTask({
      summary: '给我一份 claude 的使用的高级技巧的报告',
      requirements: ['要网上搜索', '整理报告', '变成 pdf 给我'],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Task needs browser search plus downstream synthesis, so it should run as a workflow.',
      analysis: {
        complexity: 'complex',
        needsBrowser: true,
        needsMultipleSteps: true,
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual([
      'analyze',
      'search',
      'summarize',
    ]);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'search')?.input).toMatchObject({
      action: 'navigate',
      url: 'https://www.baidu.com/s?wd=claude%20%E7%9A%84%E4%BD%BF%E7%94%A8%E7%9A%84%E9%AB%98%E7%BA%A7%E6%8A%80%E5%B7%A7',
      createPage: true,
    });
    expect(String(plan.workflowDsl?.steps.find((step) => step.id === 'summarize')?.input?.prompt || '')).toContain('PDF 导出需求已记录');
  });

  test('prefers search and evidence collection workflow for security research plus remediation tasks', async () => {
    mockListPublishedCodeCapabilities.mockReturnValue([
      {
        id: 'md-converter',
        name: 'Markdown 文件转换器',
        description: '将 Markdown 文件转换为 Word、PDF 等多种格式',
        summary: '把 markdown 转成 pdf/docx/html',
        usageExamples: [],
        inputSchema: {
          mdContent: { type: 'string', required: true },
          targetFormat: { type: 'string', required: true },
          outputPath: { type: 'string', required: false },
        },
        outputSchema: {
          filePath: { type: 'string' },
          success: { type: 'boolean' },
        },
      },
    ]);

    const task = buildTask({
      summary: '调研一下 openclaw 的安全问题',
      requirements: ['生成 pdf 报告', '然后再给一份针对性的安全方案', '也是 pdf 格式'],
      metadata: {
        relevantMessages: ['调研一下 openclaw 的安全问题，生成 pdf 报告。然后再给一份针对性的安全方案，也是 pdf 格式。'],
      },
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Task needs browser search/evidence collection plus downstream synthesis, so it should run as a workflow.',
      analysis: {
        complexity: 'complex',
        needsBrowser: true,
        needsMultipleSteps: true,
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual([
      'analyze',
      'search',
      'capture',
      'summarize',
      'export_file',
      'deliver_export',
    ]);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'search')?.input).toMatchObject({
      action: 'navigate',
      url: 'https://www.baidu.com/s?wd=openclaw%20%E7%9A%84%E5%AE%89%E5%85%A8%E9%97%AE%E9%A2%98',
      createPage: true,
    });
    expect(String(plan.workflowDsl?.steps.find((step) => step.id === 'summarize')?.input?.prompt || '')).toContain('安全问题');
    expect(String(plan.workflowDsl?.steps.find((step) => step.id === 'summarize')?.input?.prompt || '')).toContain('安全整改');
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'export_file')).toMatchObject({
      type: 'capability',
      input: {
        capabilityId: 'md-converter',
        input: {
          mdContent: 'steps.summarize.output.summary',
          targetFormat: 'pdf',
        },
      },
    });
  });

  test('uses heuristic parallel browser workflow when multiple concrete urls can be handled independently', async () => {
    const task = buildTask({
      summary: '同时打开 https://example.com 和 https://openai.com 并分别截图，然后通知我',
      requirements: ['同时打开两个页面', '分别截图', '通知结果'],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      analysis: {
        needsBrowser: true,
        needsNotification: true,
        needsMultipleSteps: true,
        needsParallel: true,
        detectedUrl: 'https://example.com',
        detectedUrls: ['https://example.com', 'https://openai.com'],
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual([
      'draft',
      'browse_1',
      'browse_2',
      'capture_1',
      'capture_2',
      'notify',
    ]);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'browse_1')?.dependsOn).toEqual(['draft']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'browse_2')?.dependsOn).toEqual(['draft']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'browse_1')?.input).toMatchObject({
      action: 'navigate',
      url: 'https://example.com',
      createPage: true,
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'capture_1')?.dependsOn).toEqual(['browse_1']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'capture_2')?.dependsOn).toEqual(['browse_2']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'capture_1')?.input).toMatchObject({
      action: 'screenshot',
      pageId: 'steps.browse_1.output.pageId',
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'capture_1')?.when).toEqual({
      op: 'exists',
      ref: 'steps.browse_1.output.pageId',
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'notify')?.dependsOn).toEqual(['capture_1', 'capture_2']);
  });

  test('extracts multiple urls separated by chinese punctuation into distinct parallel branches', async () => {
    const task = buildTask({
      summary: '同时打开 https://example.com、https://example.org 和 https://example.net，分别截图后再通知我',
      requirements: ['同时打开三个页面', '分别截图', '通知结果'],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      analysis: {
        needsBrowser: true,
        needsNotification: true,
        needsMultipleSteps: true,
        needsParallel: true,
        detectedUrl: 'https://example.com',
        detectedUrls: ['https://example.com', 'https://example.org', 'https://example.net'],
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual([
      'draft',
      'browse_1',
      'browse_2',
      'browse_3',
      'capture_1',
      'capture_2',
      'capture_3',
      'notify',
    ]);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'notify')?.dependsOn).toEqual([
      'capture_1',
      'capture_2',
      'capture_3',
    ]);
  });

  test('uses mixed workflow when parallel browser branches must be aggregated afterwards', async () => {
    const task = buildTask({
      summary: '先整理比较维度，然后同时打开 https://example.com、https://example.org 和 https://example.net，分别截图，最后汇总结论并通知我',
      requirements: ['先整理比较维度', '同时打开三个页面', '分别截图', '最后汇总结论并通知结果'],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Task needs parallel browser branches plus a downstream synthesis step, so it should run as a mixed workflow.',
      analysis: {
        needsBrowser: true,
        needsNotification: true,
        needsMultipleSteps: true,
        needsParallel: true,
        detectedUrls: ['https://example.com', 'https://example.org', 'https://example.net'],
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual([
      'analyze',
      'browse_1',
      'browse_2',
      'browse_3',
      'capture_1',
      'capture_2',
      'capture_3',
      'aggregate',
      'notify',
    ]);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'browse_1')?.dependsOn).toEqual(['analyze']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'aggregate')?.dependsOn).toEqual([
      'capture_1',
      'capture_2',
      'capture_3',
    ]);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'aggregate')?.input).toMatchObject({
      role: 'integration',
      context: {
        analysis: 'steps.analyze.output.summary',
        branch_1: {
          url: 'steps.browse_1.output.url',
          title: 'steps.browse_1.output.title',
          screenshotPath: 'steps.capture_1.output.screenshotPath',
        },
      },
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'notify')?.dependsOn).toEqual(['aggregate']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'notify')?.input).toMatchObject({
      message: 'steps.aggregate.output.summary',
    });
  });

  test('injects explicitly referenced published prompt capabilities into agent workflow steps', async () => {
    mockListPublishedPromptCapabilities.mockReturnValue([
      {
        id: 'prompt.summarize_contract',
        name: '合同总结助手',
        description: '总结合同重点',
        summary: '把合同内容整理成简洁要点',
        usageExamples: [],
      },
    ]);

    const task = buildTask({
      summary: '使用能力 prompt.summarize_contract 处理这段合同内容',
      requirements: ['输出一句简短结论'],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Task explicitly references published prompt capabilities (prompt.summarize_contract), so it should run as a workflow with agent capability injection.',
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual(['analyze', 'main']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'main')?.input).toMatchObject({
      role: 'worker',
      tools: ['prompt.summarize_contract'],
    });
  });

  test('builds capability workflow for explicitly referenced published code capability with structured input', async () => {
    mockListPublishedCodeCapabilities.mockReturnValue([
      {
        id: 'doc.convert_to_markdown',
        name: '文档转 Markdown',
        description: '把文档转换成 markdown',
        summary: '把 docx 文件转换成 markdown 文本',
        usageExamples: [],
        inputSchema: {
          sourcePath: 'string',
          targetFormat: 'string',
        },
        outputSchema: {
          summary: 'string',
          markdown: 'string',
        },
      },
    ]);

    const task = buildTask({
      summary: '使用能力 doc.convert_to_markdown 转换这个文件',
      requirements: [
        '```json\n{"sourcePath":"./demo.docx","targetFormat":"markdown"}\n```',
      ],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
      reason: 'Task explicitly references published code capability doc.convert_to_markdown with structured input, so it should run as a capability workflow.',
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual(['run_capability', 'finalize']);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'run_capability')).toMatchObject({
      type: 'capability',
      input: {
        capabilityId: 'doc.convert_to_markdown',
        input: {
          sourcePath: './demo.docx',
          targetFormat: 'markdown',
        },
      },
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'finalize')?.input).toMatchObject({
      role: 'integration',
      context: {
        capabilityId: 'doc.convert_to_markdown',
        capabilityOutput: 'steps.run_capability.output',
      },
    });
  });

  test('uses a discoverable export capability for report to pdf requests', async () => {
    mockListPublishedCodeCapabilities.mockReturnValue([
      {
        id: 'md-converter',
        name: 'Markdown 文件转换器',
        description: '将 Markdown 文件转换为 Word、PDF 等多种格式',
        summary: '把 markdown 转成 pdf/docx/html',
        usageExamples: [],
        inputSchema: {
          mdContent: { type: 'string', required: true },
          targetFormat: { type: 'string', required: true },
          outputPath: { type: 'string', required: false },
        },
        outputSchema: {
          filePath: { type: 'string' },
          success: { type: 'boolean' },
        },
      },
    ]);

    const task = buildTask({
      summary: '给我一份 Claude 使用技巧报告，并导出 PDF',
      requirements: ['整理报告', '导出 pdf'],
    });

    const { buildPreviewSchedulingPlan } = await import('../planner');
    const plan = buildPreviewSchedulingPlan(task);

    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'heuristic',
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual([
      'analyze',
      'draft',
      'finalize',
      'export_file',
      'deliver_export',
    ]);
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'export_file')).toMatchObject({
      type: 'capability',
      input: {
        capabilityId: 'md-converter',
        input: {
          mdContent: 'steps.finalize.output.summary',
          targetFormat: 'pdf',
        },
      },
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'draft')).toMatchObject({
      type: 'agent',
      input: {
        role: 'researcher',
        context: {
          analysis: 'steps.analyze.output.summary',
        },
      },
      policy: {
        timeoutMs: 90_000,
      },
    });
    expect(String(plan.workflowDsl?.steps.find((step) => step.id === 'draft')?.input?.prompt || '')).toContain('精简 Markdown 提纲');
    expect(String(plan.workflowDsl?.steps.find((step) => step.id === 'finalize')?.input?.prompt || '')).not.toContain('PDF 导出需求已记录');
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'finalize')).toMatchObject({
      input: {
        outputMode: 'plain-text',
        context: {
          analysis: 'steps.analyze.output.summary',
          outline: 'steps.draft.output.summary',
        },
      },
      policy: {
        timeoutMs: 420_000,
      },
    });
    expect(plan.workflowDsl?.steps.find((step) => step.id === 'deliver_export')?.input).toMatchObject({
      role: 'integration',
      context: {
        deliverableContent: 'steps.finalize.output.summary',
        exportCapabilityId: 'md-converter',
        exportResult: 'steps.export_file.output',
      },
    });
  });

  test('prefers a valid llm plan when model planning is available', async () => {
    const task = buildTask({
      summary: '整理实现状态并在完成后通知',
      requirements: ['整理状态', '给出最终结论', '通知结果'],
    });

    mockGetSession.mockReturnValue({
      provider_id: 'provider-test-001',
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
    });
    mockGenerateObjectFromProvider.mockResolvedValue({
      strategy: 'workflow',
      reason: 'The task needs staged execution and a visible completion notification.',
      analysis: {
        complexity: 'moderate',
        needsBrowser: false,
        needsNotification: true,
        needsMultipleSteps: true,
        needsParallel: false,
      },
      workflowDsl: {
        version: 'v1',
        name: 'task-planner-llm',
        steps: [
          {
            id: 'analyze',
            type: 'agent',
            input: {
              prompt: '先分析任务，并给出可交接说明。',
              role: 'researcher',
            },
          },
          {
            id: 'main',
            type: 'agent',
            dependsOn: ['analyze'],
            input: {
              prompt: 'steps.analyze.output.summary',
              role: 'worker',
            },
          },
          {
            id: 'notify',
            type: 'notification',
            dependsOn: ['main'],
            input: {
              message: 'steps.main.output.summary',
              level: 'info',
              channel: 'system',
              sessionId: task.sessionId,
            },
          },
        ],
      },
    });

    const { buildPreviewSchedulingPlan, resolveSchedulingPlan } = await import('../planner');
    const previewPlan = buildPreviewSchedulingPlan(task);
    const plan = await resolveSchedulingPlan(task, previewPlan);

    expect(mockGenerateObjectFromProvider).toHaveBeenCalledTimes(1);
    expect(mockGenerateObjectFromProvider).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-4-6',
      providerId: 'provider-test-001',
    }));
    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'llm',
      reason: 'The task needs staged execution and a visible completion notification.',
      model: 'claude-sonnet-4-6',
      analysis: {
        needsNotification: true,
        needsMultipleSteps: true,
        needsParallel: false,
      },
    });
    expect(plan.workflowDsl?.steps.map((step) => step.id)).toEqual(['analyze', 'main', 'notify']);
  });

  test('uses default provider model fallback so llm planning still runs when the session model is blank', async () => {
    const task = buildTask({
      summary: '整理一份执行策略摘要',
      requirements: ['输出最终建议'],
    });

    mockGetSession.mockReturnValue({
      provider_id: '',
      requested_model: '',
      model: '',
    });
    mockGetDefaultProvider.mockReturnValue(buildProvider('provider-default-001'));
    mockGenerateObjectFromProvider.mockResolvedValue({
      strategy: 'simple',
      reason: 'The task can be completed directly.',
      analysis: {
        complexity: 'simple',
        needsBrowser: false,
        needsNotification: false,
        needsMultipleSteps: false,
        needsParallel: false,
      },
    });

    const { buildPreviewSchedulingPlan, resolveSchedulingPlan } = await import('../planner');
    const previewPlan = buildPreviewSchedulingPlan(task);
    const plan = await resolveSchedulingPlan(task, previewPlan);

    expect(mockGenerateObjectFromProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerId: 'provider-default-001',
    }));
    expect(plan).toMatchObject({
      strategy: 'simple',
      source: 'llm',
      model: 'claude-sonnet-4-6',
    });
  });

  test('retries llm planning failures and keeps diagnostics on eventual success', async () => {
    jest.useFakeTimers();

    const task = buildTask({
      summary: '整理当前实现状态并输出摘要',
      requirements: ['整理状态', '输出摘要'],
    });

    mockGetSession.mockReturnValue({
      provider_id: 'provider-test-002',
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
    });
    mockGenerateObjectFromProvider
      .mockRejectedValueOnce(new Error('temporary planner failure'))
      .mockResolvedValueOnce({
        strategy: 'simple',
        reason: 'The task can be handled directly after a retry.',
        analysis: {
          complexity: 'simple',
          needsBrowser: false,
          needsNotification: false,
          needsMultipleSteps: false,
          needsParallel: false,
        },
      });

    const { buildPreviewSchedulingPlan, resolveSchedulingPlan } = await import('../planner');
    const previewPlan = buildPreviewSchedulingPlan(task);
    const planPromise = resolveSchedulingPlan(task, previewPlan);

    await jest.advanceTimersByTimeAsync(1_000);
    const plan = await planPromise;

    expect(mockGenerateObjectFromProvider).toHaveBeenCalledTimes(2);
    expect(plan).toMatchObject({
      strategy: 'simple',
      source: 'llm',
      diagnostics: {
        llmAttempted: true,
        llmAttempts: 2,
        llmErrors: ['temporary planner failure'],
      },
    });
  });

  test('planner response schema tolerates null and empty url fields from llm output', async () => {
    const { plannerResponseSchema } = await import('../planner');

    const parsed = plannerResponseSchema.parse({
      strategy: 'simple',
      reason: 'No concrete url is present for this research task.',
      analysis: {
        complexity: 'moderate',
        needsBrowser: true,
        needsNotification: false,
        needsMultipleSteps: true,
        needsParallel: false,
        detectedUrl: null,
        detectedUrls: [],
      },
    });

    expect(parsed).toEqual({
      strategy: 'simple',
      reason: 'No concrete url is present for this research task.',
      analysis: {
        complexity: 'moderate',
        needsBrowser: true,
        needsNotification: false,
        needsMultipleSteps: true,
        needsParallel: false,
      },
    });
  });

  test('retries invalid workflow dsl with prior validation feedback embedded in the next prompt', async () => {
    jest.useFakeTimers();

    const task = buildTask({
      summary: '搜一下 openclaw 的安全风险资料并给我结论',
      requirements: ['先搜索资料', '再汇总结论'],
    });

    mockGetSession.mockReturnValue({
      provider_id: 'provider-test-invalid-dsl-retry',
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
    });
    mockGenerateObjectFromProvider
      .mockResolvedValueOnce({
        strategy: 'workflow',
        reason: 'Need a research workflow.',
        analysis: {
          complexity: 'complex',
          needsBrowser: true,
          needsNotification: false,
          needsMultipleSteps: true,
          needsParallel: false,
        },
        workflowDsl: {
          version: 'v1',
          name: 'task-invalid-dsl',
          steps: [
            {
              id: 'search',
              type: 'browser',
              input: {
                action: 'search',
                query: 'openclaw security risk',
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        strategy: 'workflow',
        reason: 'Need browser evidence collection before summarization.',
        analysis: {
          complexity: 'complex',
          needsBrowser: true,
          needsNotification: false,
          needsMultipleSteps: true,
          needsParallel: false,
        },
        workflowDsl: {
          version: 'v1',
          name: 'task-valid-dsl',
          steps: [
            {
              id: 'search',
              type: 'browser',
              input: {
                action: 'navigate',
                url: 'https://www.bing.com/search?q=openclaw%20security%20risk',
                createPage: true,
              },
            },
          ],
        },
      });

    const { resolveSchedulingPlan } = await import('../planner');
    const planPromise = resolveSchedulingPlan(task);

    await jest.advanceTimersByTimeAsync(1_000);
    const plan = await planPromise;

    expect(mockGenerateObjectFromProvider).toHaveBeenCalledTimes(2);
    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'llm',
      diagnostics: {
        llmAttempted: true,
        llmAttempts: 2,
        llmErrors: [
          expect.stringContaining('Planner returned invalid workflow DSL'),
        ],
      },
    });

    const secondPrompt = String(mockGenerateObjectFromProvider.mock.calls[1][0]?.prompt || '');
    expect(secondPrompt).toContain('previousAttemptFeedback');
    expect(secondPrompt).toContain('Planner returned invalid workflow DSL');
    expect(secondPrompt).toContain('Do not use unsupported browser fields such as query or prompt.');
  });

  test('retries semantically invalid report workflow when planner uses short synthesis timeout and temp-file handoff', async () => {
    jest.useFakeTimers();

    const task = buildTask({
      summary: '搜一下openclaw的安全风险的资料',
      requirements: ['评估解决方案', '输出 pdf 报告'],
      metadata: {
        relevantMessages: ['帮我搜一下openclaw的安全风险的资料，评估解决方案，然后给我一份报告，要pdf格式的报告；'],
      },
    });

    mockGetSession.mockReturnValue({
      provider_id: 'provider-test-semantic-retry',
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
    });

    mockGenerateObjectFromProvider
      .mockResolvedValueOnce({
        strategy: 'workflow',
        reason: 'Need browser research, synthesis, and export.',
        analysis: {
          complexity: 'complex',
          needsBrowser: true,
          needsNotification: true,
          needsMultipleSteps: true,
          needsParallel: true,
        },
        workflowDsl: {
          version: 'v1',
          name: 'openclaw-security-risk-report',
          steps: [
            {
              id: 'search-general',
              type: 'browser',
              policy: {
                timeoutMs: 15000,
              },
              input: {
                action: 'navigate',
                url: 'https://www.bing.com/search?q=OpenClaw+security+risk',
                createPage: true,
              },
            },
            {
              id: 'synthesize-report',
              type: 'agent',
              dependsOn: ['search-general'],
              policy: {
                timeoutMs: 60000,
                retry: {
                  maximumAttempts: 2,
                },
              },
              input: {
                prompt: '将完整的 Markdown 报告内容写入文件 /tmp/openclaw-security-report.md。',
                role: 'researcher',
                outputMode: 'plain-text',
                context: {
                  searchResult: {
                    url: 'steps.search-general.output.url',
                  },
                },
              },
            },
            {
              id: 'export-pdf',
              type: 'capability',
              dependsOn: ['synthesize-report'],
              input: {
                capabilityId: 'md-converter',
                input: {
                  mdContent: '/tmp/openclaw-security-report.md',
                  targetFormat: 'pdf',
                },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        strategy: 'workflow',
        reason: 'Need browser research, synthesis, and export.',
        analysis: {
          complexity: 'complex',
          needsBrowser: true,
          needsNotification: true,
          needsMultipleSteps: true,
          needsParallel: false,
        },
        workflowDsl: {
          version: 'v1',
          name: 'openclaw-security-risk-report',
          steps: [
            {
              id: 'search-general',
              type: 'browser',
              input: {
                action: 'navigate',
                url: 'https://www.bing.com/search?q=OpenClaw+security+risk',
                createPage: true,
              },
            },
            {
              id: 'synthesize-report',
              type: 'agent',
              dependsOn: ['search-general'],
              policy: {
                timeoutMs: 240000,
                retry: {
                  maximumAttempts: 2,
                },
              },
              input: {
                prompt: '根据搜索证据输出最终 Markdown 报告。',
                role: 'integration',
                outputMode: 'plain-text',
                context: {
                  searchResult: {
                    url: 'steps.search-general.output.url',
                  },
                },
              },
            },
            {
              id: 'export-pdf',
              type: 'capability',
              dependsOn: ['synthesize-report'],
              input: {
                capabilityId: 'md-converter',
                input: {
                  mdContent: 'steps.synthesize-report.output.summary',
                  targetFormat: 'pdf',
                },
              },
            },
          ],
        },
      });

    const { resolveSchedulingPlan } = await import('../planner');
    const planPromise = resolveSchedulingPlan(task);

    await jest.advanceTimersByTimeAsync(1_000);
    const plan = await planPromise;

    expect(mockGenerateObjectFromProvider).toHaveBeenCalledTimes(2);
    expect(plan).toMatchObject({
      strategy: 'workflow',
      source: 'llm',
      diagnostics: {
        llmAttempted: true,
        llmAttempts: 2,
        llmErrors: [
          expect.stringContaining('Planner returned semantically invalid workflow DSL'),
        ],
      },
    });

    const secondPrompt = String(mockGenerateObjectFromProvider.mock.calls[1][0]?.prompt || '');
    expect(secondPrompt).toContain('previousAttemptFeedback');
    expect(secondPrompt).toContain(`long-form plain-text report synthesis agent steps must use timeoutMs >= 240000`);
    expect(secondPrompt).toContain('researcher steps are read-only and must not be instructed to write files');
    expect(secondPrompt).toContain('md-converter should consume markdown text from an upstream step output reference');
  });

  test('throws a planning error after repeated llm failures instead of falling back to heuristic output', async () => {
    jest.useFakeTimers();

    const task = buildTask({
      summary: '同时打开 https://example.com 和 https://openai.com 并分别截图',
      requirements: ['同时打开两个页面', '分别截图'],
    });

    mockGetSession.mockReturnValue({
      provider_id: 'provider-test-003',
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
    });
    mockGenerateObjectFromProvider
      .mockRejectedValueOnce(new Error('planner timeout 1'))
      .mockRejectedValueOnce(new Error('planner timeout 2'))
      .mockRejectedValueOnce(new Error('planner timeout 3'));

    const { resolveSchedulingPlan, SchedulingPlannerError } = await import('../planner');
    const planPromise = resolveSchedulingPlan(task);
    const rejectionExpectation = expect(planPromise).rejects.toMatchObject({
      diagnostics: {
        llmAttempted: true,
        llmAttempts: 3,
        llmErrors: ['planner timeout 1', 'planner timeout 2', 'planner timeout 3'],
      },
    });
    const instanceExpectation = expect(planPromise).rejects.toBeInstanceOf(SchedulingPlannerError);

    await jest.advanceTimersByTimeAsync(3_000);
    await instanceExpectation;
    await rejectionExpectation;

    expect(mockGenerateObjectFromProvider).toHaveBeenCalledTimes(3);
  });

  test('surfaces provider status and body excerpt when structured planning returns invalid json', async () => {
    jest.useFakeTimers();

    const task = buildTask({
      summary: '调研一下 openclaw 的安全问题',
      requirements: ['生成 pdf 报告', '再给一份针对性的安全方案'],
    });

    mockGetSession.mockReturnValue({
      provider_id: 'provider-test-structured-json',
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
    });

    const providerError = Object.assign(new Error('Invalid JSON response'), {
      statusCode: 502,
      responseBody: '<html><body>upstream gateway returned non-json</body></html>',
    });

    mockGenerateObjectFromProvider
      .mockRejectedValueOnce(providerError)
      .mockRejectedValueOnce(providerError)
      .mockRejectedValueOnce(providerError);

    const { resolveSchedulingPlan, SchedulingPlannerError } = await import('../planner');
    const planningPromise = resolveSchedulingPlan(task);
    const instanceExpectation = expect(planningPromise).rejects.toBeInstanceOf(SchedulingPlannerError);
    const detailExpectation = expect(planningPromise).rejects.toMatchObject({
      diagnostics: {
        llmErrors: [
          'Invalid JSON response from planner provider (status 502, body: <html><body>upstream gateway returned non-json</body></html>)',
          'Invalid JSON response from planner provider (status 502, body: <html><body>upstream gateway returned non-json</body></html>)',
          'Invalid JSON response from planner provider (status 502, body: <html><body>upstream gateway returned non-json</body></html>)',
        ],
      },
    });

    await jest.advanceTimersByTimeAsync(3_000);

    await instanceExpectation;
    await detailExpectation;
  });

  test('maps claude sdk aborted-by-user timeout wording back to a planner timeout diagnosis', async () => {
    jest.useFakeTimers();

    const task = buildTask({
      summary: '搜一下 openclaw 的安全风险资料',
      requirements: ['整理资料'],
    });

    mockGetSession.mockReturnValue({
      provider_id: 'provider-test-timeout-abort',
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
    });

    mockGenerateObjectFromProvider.mockRejectedValue(
      new Error('Claude Code process aborted by user'),
    );

    const { resolveSchedulingPlan, SchedulingPlannerError } = await import('../planner');
    const planningPromise = resolveSchedulingPlan(task);
    const instanceExpectation = expect(planningPromise).rejects.toBeInstanceOf(SchedulingPlannerError);
    const detailExpectation = expect(planningPromise).rejects.toMatchObject({
      diagnostics: {
        llmTimeoutMs: 90_000,
        llmErrors: [
          'LLM planning timed out after 90000ms',
          'LLM planning timed out after 90000ms',
          'LLM planning timed out after 90000ms',
        ],
      },
    });

    await jest.advanceTimersByTimeAsync(3_000);

    await instanceExpectation;
    await detailExpectation;
  });

  test('uses scheduling agent overrides for planner prompt, timeout, and retry budget', async () => {
    jest.useFakeTimers();

    const task = buildTask({
      summary: '输出一句简短摘要',
      requirements: ['一句话即可'],
    });

    mockGetSession.mockReturnValue({
      provider_id: 'provider-test-004',
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
    });
    mockGetSetting.mockImplementation((key: string) => {
      if (key === 'workflow_agent_role_overrides_v1') {
        return JSON.stringify({
          version: 'v1',
          roles: {
            scheduling: {
              systemPrompt: 'Custom scheduling prompt',
              plannerTimeoutMs: 45_000,
              plannerMaxRetries: 0,
            },
          },
        });
      }
      return '';
    });
    mockGenerateObjectFromProvider.mockRejectedValue(new Error('planner override failure'));

    const { resolveSchedulingPlan, SchedulingPlannerError } = await import('../planner');
    const planningPromise = resolveSchedulingPlan(task);
    await expect(planningPromise).rejects.toBeInstanceOf(SchedulingPlannerError);
    await expect(planningPromise).rejects.toMatchObject({
      diagnostics: {
        llmAttempted: true,
        llmAttempts: 1,
        llmTimeoutMs: 45_000,
        llmErrors: ['planner override failure'],
      },
    });

    expect(mockGenerateObjectFromProvider).toHaveBeenCalledTimes(1);
    expect(mockGenerateObjectFromProvider).toHaveBeenCalledWith(expect.objectContaining({
      system: 'Custom scheduling prompt',
    }));
  });

  test('records why llm planning was skipped when no usable planner model can be resolved', async () => {
    const task = buildTask({
      summary: '整理一句最终结论',
      requirements: ['一句话即可'],
    });

    mockGetSession.mockReturnValue({
      provider_id: '',
      requested_model: '',
      model: '',
    });

    const { resolveSchedulingPlan, SchedulingPlannerError } = await import('../planner');
    const planningPromise = resolveSchedulingPlan(task);
    await expect(planningPromise).rejects.toBeInstanceOf(SchedulingPlannerError);
    await expect(planningPromise).rejects.toMatchObject({
      diagnostics: {
        llmAttempted: false,
        llmAttempts: 0,
        llmSkippedReason: expect.stringContaining('no usable provider/model configuration'),
      },
    });

    expect(mockGenerateObjectFromProvider).not.toHaveBeenCalled();
  });
});
