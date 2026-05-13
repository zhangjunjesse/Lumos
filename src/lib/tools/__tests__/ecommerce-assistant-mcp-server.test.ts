const mockCreateSdkMcpServer = jest.fn((cfg: { name: string; tools: Array<{ name: string }> }) => cfg);
const mockTool = jest.fn(
  (name: string, description: string, schema: unknown, handler: unknown) => ({
    name,
    description,
    schema,
    handler,
  }),
);

const mockGetEcommerceStore = jest.fn();
const mockListInputs = jest.fn();
const mockListJobs = jest.fn();
const mockStartImageJob = jest.fn();
const mockCancelImageJob = jest.fn();
const mockRetryImageJob = jest.fn();

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (...args: unknown[]) => mockCreateSdkMcpServer(...args as [never]),
  tool: (...args: unknown[]) => mockTool(...args as [never, never, never, never]),
}));

jest.mock('@/lib/ecommerce-assistant/storage', () => ({
  getEcommerceStore: (...args: unknown[]) => mockGetEcommerceStore(...args),
  listInputs: (...args: unknown[]) => mockListInputs(...args),
  listJobs: (...args: unknown[]) => mockListJobs(...args),
}));

jest.mock('@/lib/ecommerce-assistant/job-runner', () => ({
  startJob: (...args: unknown[]) => mockStartImageJob(...args),
  cancelJob: (...args: unknown[]) => mockCancelImageJob(...args),
  retryJob: (...args: unknown[]) => mockRetryImageJob(...args),
}));

jest.mock('@/lib/ecommerce-assistant/research-storage', () => ({
  listResearchReports: jest.fn(() => []),
  getResearchReport: jest.fn(() => null),
  getResearchStore: jest.fn(() => ({})),
  readReportMarkdown: jest.fn(() => null),
}));

jest.mock('@/lib/ecommerce-assistant/research-runner', () => ({
  startReport: jest.fn(async () => ({ id: 'r-1', status: 'queued' })),
  cancelReport: jest.fn(() => true),
}));

import {
  createEcommerceAssistantMcpServer,
  ECOMMERCE_ASSISTANT_MCP_SERVER_NAME,
  ECOMMERCE_ASSISTANT_MCP_SYSTEM_HINT,
} from '../ecommerce-assistant-mcp-server';

interface CapturedTool {
  name: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function findTool(name: string): CapturedTool {
  const result = mockTool.mock.results
    .map((r) => r.value as CapturedTool)
    .find((t) => t.name === name);
  if (!result) throw new Error(`tool ${name} not registered`);
  return result;
}

function bodyOf(result: unknown): { text: string; data: Record<string, unknown> } {
  const text = (result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  return { text, data: JSON.parse(text) as Record<string, unknown> };
}

describe('ecommerce assistant MCP server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEcommerceStore.mockReturnValue({ /* opaque store */ });
  });

  it('registers the expected set of tools', () => {
    const server = createEcommerceAssistantMcpServer() as {
      name: string;
      tools: Array<{ name: string }>;
    };
    expect(server.name).toBe(ECOMMERCE_ASSISTANT_MCP_SERVER_NAME);
    expect(server.tools.map((t) => t.name).sort()).toEqual([
      'cancel_image_job',
      'cancel_research_report',
      'get_ecommerce_status',
      'get_research_report',
      'list_image_jobs',
      'list_product_inputs',
      'list_research_reports',
      'resolve_product_input',
      'retry_image_job',
      'start_image_job',
      'start_research_report',
    ]);
  });

  it('system hint advertises all tool names so the model can discover them', () => {
    for (const name of [
      'get_ecommerce_status',
      'list_product_inputs',
      'resolve_product_input',
      'list_image_jobs',
      'start_image_job',
      'cancel_image_job',
      'retry_image_job',
      'start_research_report',
      'list_research_reports',
      'get_research_report',
      'cancel_research_report',
    ]) {
      expect(ECOMMERCE_ASSISTANT_MCP_SYSTEM_HINT).toContain(`mcp__${ECOMMERCE_ASSISTANT_MCP_SERVER_NAME}__${name}`);
    }
  });

  it('get_ecommerce_status aggregates inputs and jobs by status', async () => {
    createEcommerceAssistantMcpServer();
    mockListInputs.mockReturnValueOnce([{ id: 'a', title: 'A', status: 'ready' }]);
    mockListJobs.mockReturnValueOnce([
      { id: 'j1', input_id: 'a', status: 'completed', stage: 'qc', updated_at: 't1' },
      { id: 'j2', input_id: 'a', status: 'failed', stage: 'error', failure_reason: 'boom' },
      { id: 'j3', input_id: 'a', status: 'generating' },
    ]);
    const { data } = bodyOf(await findTool('get_ecommerce_status').handler({}));

    expect(mockListInputs).toHaveBeenCalledWith(expect.anything(), { status: 'ready' });
    expect((data.inputs as Record<string, number>).ready_count).toBe(1);
    const jobs = data.jobs as { total: number; by_status: Record<string, number>; latest: { id: string } };
    expect(jobs.total).toBe(3);
    expect(jobs.by_status).toEqual({ completed: 1, failed: 1, generating: 1 });
    expect(jobs.latest.id).toBe('j1');
  });

  it('list_product_inputs respects status filter and limit', async () => {
    createEcommerceAssistantMcpServer();
    mockListInputs.mockReturnValueOnce(
      Array.from({ length: 15 }, (_, i) => ({
        id: `inp-${i}`,
        title: `产品 ${i}`,
        status: 'archived',
      })),
    );
    const { data } = bodyOf(
      await findTool('list_product_inputs').handler({ status: 'archived', limit: 3 }),
    );

    expect(mockListInputs).toHaveBeenCalledWith(expect.anything(), { status: 'archived' });
    expect(data.count).toBe(3);
    expect(data.total).toBe(15);
    expect((data.inputs as Array<{ id: string }>).length).toBe(3);
  });

  it('resolve_product_input scores title matches above hint/note matches', async () => {
    createEcommerceAssistantMcpServer();
    mockListInputs.mockReturnValueOnce([
      { id: 'a', title: '手作陶瓷杯', category_hint: 'mug', note: '', status: 'ready' },
      { id: 'b', title: '马克杯', category_hint: '手作', note: '', status: 'ready' },
      { id: 'c', title: '不相关商品', category_hint: '', note: '配套手作礼盒', status: 'ready' },
    ]);
    const { data } = bodyOf(
      await findTool('resolve_product_input').handler({ query: '手作' }),
    );

    const ids = (data.candidates as Array<{ id: string }>).map((c) => c.id);
    expect(ids[0]).toBe('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });

  it('start_image_job passes through preset_id and aspect_ratio', async () => {
    createEcommerceAssistantMcpServer();
    mockStartImageJob.mockResolvedValueOnce({
      id: 'job-1',
      input_id: 'inp-1',
      status: 'queued',
      stage: 'preprocessing',
      preset_id: 'p1',
      aspect_ratio: '3:4',
    });
    const { data } = bodyOf(
      await findTool('start_image_job').handler({
        input_id: 'inp-1',
        preset_id: 'p1',
        aspect_ratio: '3:4',
      }),
    );

    expect(mockStartImageJob).toHaveBeenCalledWith({
      inputId: 'inp-1',
      presetId: 'p1',
      aspectRatio: '3:4',
    });
    expect(data.success).toBe(true);
    expect((data.job as { id: string }).id).toBe('job-1');
  });

  it('start_image_job returns isError when underlying call throws', async () => {
    createEcommerceAssistantMcpServer();
    mockStartImageJob.mockRejectedValueOnce(new Error('quota exhausted'));
    const result = (await findTool('start_image_job').handler({ input_id: 'inp-1' })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('quota exhausted');
  });

  it('cancel_image_job reports success=false when no running job is found', async () => {
    createEcommerceAssistantMcpServer();
    mockCancelImageJob.mockReturnValueOnce(false);
    const { data } = bodyOf(
      await findTool('cancel_image_job').handler({ job_id: 'job-999' }),
    );
    expect(mockCancelImageJob).toHaveBeenCalledWith('job-999');
    expect(data.success).toBe(false);
  });

  it('retry_image_job returns the new job summary', async () => {
    createEcommerceAssistantMcpServer();
    mockRetryImageJob.mockResolvedValueOnce({
      id: 'new-job-2',
      input_id: 'inp-1',
      status: 'queued',
    });
    const { data } = bodyOf(
      await findTool('retry_image_job').handler({ job_id: 'old-job-1' }),
    );
    expect(mockRetryImageJob).toHaveBeenCalledWith('old-job-1');
    expect(data.success).toBe(true);
    expect((data.new_job as { id: string }).id).toBe('new-job-2');
    expect(data.retried_from).toBe('old-job-1');
  });
});
