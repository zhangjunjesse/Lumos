import { NextRequest } from 'next/server';

const startJobMock = jest.fn();
const fakeStore = {
  query: jest.fn(),
};
const fakeOutputs = jest.fn();
const fakeJobs = jest.fn();

jest.mock('@/lib/ecommerce-assistant/job-runner', () => ({
  startJob: startJobMock,
}));

jest.mock('@/lib/ecommerce-assistant/storage', () => ({
  getEcommerceStore: () => fakeStore,
  listJobs: (...args: unknown[]) => fakeJobs(...args),
  listOutputs: (...args: unknown[]) => fakeOutputs(...args),
}));

import { GET, POST } from '../route';

describe('/api/apps/builtin/ecommerce/jobs', () => {
  beforeEach(() => {
    startJobMock.mockReset();
    fakeJobs.mockReset();
    fakeOutputs.mockReset();
    fakeStore.query.mockReset();
  });

  it('GET returns jobs without outputs by default', async () => {
    fakeJobs.mockReturnValue([{ id: 'j1', status: 'completed' }]);
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/jobs');
    const res = await GET(req);
    const json = await res.json();
    expect(json.jobs).toHaveLength(1);
    expect(json.outputs).toBeUndefined();
  });

  it('GET supports outputs=1 query', async () => {
    fakeJobs.mockReturnValue([]);
    fakeOutputs.mockReturnValue([{ id: 'o1', kind: 'final' }]);
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/jobs?outputs=1');
    const res = await GET(req);
    const json = await res.json();
    expect(json.outputs).toEqual([{ id: 'o1', kind: 'final' }]);
  });

  it('GET filters by status when provided', async () => {
    fakeJobs.mockReturnValue([]);
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/jobs?status=running&input_id=xyz');
    await GET(req);
    expect(fakeJobs).toHaveBeenCalledWith(fakeStore, { status: 'running', input_id: 'xyz' });
  });

  it('POST 400 when input_id missing', async () => {
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/jobs', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/input_id/);
  });

  it('POST starts a job and returns it', async () => {
    startJobMock.mockResolvedValue({ id: 'job-1', status: 'queued' });
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/jobs', {
      method: 'POST',
      body: JSON.stringify({ input_id: 'in-1', preset_id: 'p1', aspect_ratio: '4:5' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.job.id).toBe('job-1');
    expect(startJobMock).toHaveBeenCalledWith({
      inputId: 'in-1',
      presetId: 'p1',
      aspectRatio: '4:5',
    });
  });

  it('POST 400 when startJob throws (e.g. provider missing)', async () => {
    startJobMock.mockRejectedValue(new Error('图像服务商未配置'));
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/jobs', {
      method: 'POST',
      body: JSON.stringify({ input_id: 'in-1' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('图像服务商');
  });
});
