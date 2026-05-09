import { NextRequest } from 'next/server';

const retryJobMock = jest.fn();

jest.mock('@/lib/ecommerce-assistant/job-runner', () => ({
  retryJob: retryJobMock,
}));

import { POST } from '../route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/ecommerce/jobs/job-1/retry', {
    method: 'POST',
  });
}

describe('/api/apps/builtin/ecommerce/jobs/[id]/retry', () => {
  beforeEach(() => {
    retryJobMock.mockReset();
  });

  it('returns 200 with new job on success', async () => {
    retryJobMock.mockResolvedValue({ id: 'new-job', status: 'queued', input_id: 'in-1' });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'job-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.job.id).toBe('new-job');
    expect(retryJobMock).toHaveBeenCalledWith('job-1');
  });

  it('returns 400 when retryJob throws', async () => {
    retryJobMock.mockRejectedValue(new Error('任务不存在'));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('任务不存在');
  });
});
