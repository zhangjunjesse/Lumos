import { NextRequest } from 'next/server';

const cancelJobMock = jest.fn();
const fakeStore = {};
const fakeGetJob = jest.fn();
const fakePatchJob = jest.fn();

jest.mock('@/lib/ecommerce-assistant/job-runner', () => ({
  cancelJob: cancelJobMock,
}));

jest.mock('@/lib/ecommerce-assistant/storage', () => ({
  getEcommerceStore: () => fakeStore,
  getJob: (...args: unknown[]) => fakeGetJob(...args),
  patchJob: (...args: unknown[]) => fakePatchJob(...args),
}));

import { POST } from '../route';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/apps/builtin/ecommerce/jobs/job-1/cancel', {
    method: 'POST',
  });
}

describe('/api/apps/builtin/ecommerce/jobs/[id]/cancel', () => {
  beforeEach(() => {
    cancelJobMock.mockReset();
    fakeGetJob.mockReset();
    fakePatchJob.mockReset();
  });

  it('404 when job not found', async () => {
    fakeGetJob.mockReturnValue(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'job-1' }) });
    expect(res.status).toBe(404);
  });

  it('aborts running job via in-memory controller', async () => {
    fakeGetJob.mockReturnValueOnce({ id: 'job-1', status: 'cutting' });
    cancelJobMock.mockReturnValue(true);
    fakeGetJob.mockReturnValueOnce({ id: 'job-1', status: 'cutting' });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'job-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.aborted).toBe(true);
    expect(fakePatchJob).not.toHaveBeenCalled();
  });

  it('falls back to DB-write cancel when no in-memory controller exists', async () => {
    fakeGetJob.mockReturnValueOnce({ id: 'job-1', status: 'queued' });
    cancelJobMock.mockReturnValue(false);
    fakeGetJob.mockReturnValueOnce({ id: 'job-1', status: 'cancelled' });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'job-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.aborted).toBe(false);
    expect(fakePatchJob).toHaveBeenCalledWith(
      fakeStore,
      'job-1',
      expect.objectContaining({ status: 'cancelled' }),
    );
  });

  it('does not touch terminal jobs (completed/failed)', async () => {
    fakeGetJob.mockReturnValueOnce({ id: 'job-1', status: 'completed' });
    cancelJobMock.mockReturnValue(false);
    fakeGetJob.mockReturnValueOnce({ id: 'job-1', status: 'completed' });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'job-1' }) });
    expect(res.status).toBe(200);
    expect(fakePatchJob).not.toHaveBeenCalled();
  });
});
