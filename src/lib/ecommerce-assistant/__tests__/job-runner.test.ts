const fakeStore = {
  query: jest.fn(),
};
const mockCreateJobRecord = jest.fn();
const mockEnsureBuiltinStylePresets = jest.fn();
const mockGetInput = jest.fn();
const mockGetJob = jest.fn();
const mockPatchJob = jest.fn();
const mockRunSop = jest.fn();

jest.mock('../storage', () => ({
  createJobRecord: (...args: unknown[]) => mockCreateJobRecord(...args),
  ensureBuiltinStylePresets: (...args: unknown[]) => mockEnsureBuiltinStylePresets(...args),
  getEcommerceStore: () => fakeStore,
  getInput: (...args: unknown[]) => mockGetInput(...args),
  getJob: (...args: unknown[]) => mockGetJob(...args),
  patchJob: (...args: unknown[]) => mockPatchJob(...args),
}));

jest.mock('../sop-engine', () => ({
  runSop: (...args: unknown[]) => mockRunSop(...args),
  SopAbortError: class SopAbortError extends Error {},
}));

import { startJob } from '../job-runner';

describe('startJob', () => {
  beforeEach(() => {
    fakeStore.query.mockReset();
    mockCreateJobRecord.mockReset();
    mockEnsureBuiltinStylePresets.mockReset();
    mockGetInput.mockReset();
    mockGetJob.mockReset();
    mockPatchJob.mockReset();
    mockRunSop.mockReset();
  });

  it('rejects AI concept images as SOP main images', async () => {
    mockGetInput.mockReturnValue({
      id: 'input-1',
      title: 'Promoted candidate',
      main_image_path: '/tmp/concept.png',
      status: 'ready',
    });
    fakeStore.query.mockReturnValue([{
      id: 'candidate-1',
      promoted_input_id: 'input-1',
      concept_image_path: '/tmp/concept.png',
    }]);

    await expect(startJob({ inputId: 'input-1' })).rejects.toThrow('真实样品图');
    expect(mockCreateJobRecord).not.toHaveBeenCalled();
    expect(mockRunSop).not.toHaveBeenCalled();
  });

  it('starts a job when the main image is a real uploaded image', async () => {
    mockGetInput.mockReturnValue({
      id: 'input-1',
      title: 'Real product',
      main_image_path: '/tmp/real-photo.png',
      status: 'ready',
    });
    fakeStore.query.mockReturnValue([{
      id: 'candidate-1',
      promoted_input_id: 'input-1',
      concept_image_path: '/tmp/concept.png',
    }]);
    mockCreateJobRecord.mockReturnValue({
      id: 'job-1',
      input_id: 'input-1',
      status: 'queued',
    });
    mockRunSop.mockResolvedValue({
      id: 'job-1',
      input_id: 'input-1',
      status: 'completed',
    });

    const job = await startJob({ inputId: 'input-1' });
    expect(job.id).toBe('job-1');
    expect(mockCreateJobRecord).toHaveBeenCalledWith(fakeStore, { input_id: 'input-1' });
    expect(mockRunSop).toHaveBeenCalled();
  });
});
