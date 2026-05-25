import { startCollectJob } from '../start-collect';

const ensureKeywordForAi = jest.fn();
const ensureCreatorForAi = jest.fn();
const resolveAwemeInput = jest.fn();
const createJob = jest.fn();
const findActiveDuplicateJob = jest.fn();
const runJob = jest.fn();

jest.mock('../ai-tools', () => ({
  ensureKeywordForAi: (...a: unknown[]) => ensureKeywordForAi(...a),
  ensureCreatorForAi: (...a: unknown[]) => ensureCreatorForAi(...a),
  resolveAwemeInput: (...a: unknown[]) => resolveAwemeInput(...a),
}));
jest.mock('../jobs', () => ({
  createJob: (...a: unknown[]) => createJob(...a),
  findActiveDuplicateJob: (...a: unknown[]) => findActiveDuplicateJob(...a),
  runJob: (...a: unknown[]) => runJob(...a),
}));

beforeEach(() => {
  ensureKeywordForAi.mockReset();
  ensureCreatorForAi.mockReset();
  resolveAwemeInput.mockReset();
  createJob.mockReset();
  findActiveDuplicateJob.mockReset();
  findActiveDuplicateJob.mockReturnValue(null);
  runJob.mockReset();
});

describe('startCollectJob', () => {
  it('rejects empty input without touching the pipeline', async () => {
    const r = await startCollectJob({ kind: 'keyword', input: '   ' });
    expect(r).toEqual({ ok: false, error: 'input 不能为空。', phase: 'input' });
    expect(createJob).not.toHaveBeenCalled();
  });

  it('keyword: ensures record, creates job, launches runJob WITHOUT awaiting it', async () => {
    ensureKeywordForAi.mockReturnValue({ ok: true, keyword: { id: 'kw-1' } });
    createJob.mockReturnValue({ id: 'job-1', kind: 'keyword' });
    let runJobSettled = false;
    runJob.mockReturnValue(
      new Promise((resolve) => setTimeout(() => { runJobSettled = true; resolve(null); }, 50)),
    );

    const r = await startCollectJob({ kind: 'keyword', input: '电商SOP' });

    expect(r).toEqual({ ok: true, job: { id: 'job-1', kind: 'keyword' } });
    expect(createJob).toHaveBeenCalledWith({
      kind: 'keyword',
      targetRef: 'kw-1',
      autoProcess: undefined,
      publishToKnowledge: true,
    });
    expect(runJob).toHaveBeenCalledWith('job-1');
    // Returned before the background job finished — non-blocking contract.
    expect(runJobSettled).toBe(false);
  });

  it('keyword: surfaces ensure failure, no job created', async () => {
    ensureKeywordForAi.mockReturnValue({ ok: false, error: '关键词不能为空。', phase: 'keyword-input' });
    const r = await startCollectJob({ kind: 'keyword', input: 'x' });
    expect(r).toEqual({ ok: false, error: '关键词不能为空。', phase: 'keyword-input' });
    expect(createJob).not.toHaveBeenCalled();
  });

  it('keyword: reuses an active duplicate job without launching another run', async () => {
    const duplicate = { id: 'job-existing', kind: 'keyword' };
    ensureKeywordForAi.mockReturnValue({ ok: true, keyword: { id: 'kw-duplicate' } });
    findActiveDuplicateJob.mockReturnValue(duplicate);

    const r = await startCollectJob({ kind: 'keyword', input: '电商SOP' });

    expect(r).toEqual({ ok: true, job: duplicate });
    expect(findActiveDuplicateJob).toHaveBeenCalledWith({
      kind: 'keyword',
      targetRef: 'kw-duplicate',
      autoProcess: undefined,
      publishToKnowledge: true,
    });
    expect(createJob).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  });

  it('creator: awaits ensureCreatorForAi then launches', async () => {
    ensureCreatorForAi.mockResolvedValue({ ok: true, creator: { id: 'cr-1' } });
    createJob.mockReturnValue({ id: 'job-2', kind: 'creator' });
    runJob.mockResolvedValue(null);
    const r = await startCollectJob({ kind: 'creator', input: 'https://www.douyin.com/user/MS4x' });
    expect(r).toEqual({ ok: true, job: { id: 'job-2', kind: 'creator' } });
    expect(createJob).toHaveBeenCalledWith({
      kind: 'creator',
      targetRef: 'cr-1',
      autoProcess: undefined,
      publishToKnowledge: true,
    });
  });

  it('link: resolves aweme input then launches', async () => {
    resolveAwemeInput.mockResolvedValue({
      ok: true,
      awemeId: '7',
      targetRef: 'https://www.douyin.com/video/7',
    });
    createJob.mockReturnValue({ id: 'job-3', kind: 'link' });
    runJob.mockResolvedValue(null);
    const r = await startCollectJob({ kind: 'link', input: 'https://v.douyin.com/abc' });
    expect(r).toEqual({ ok: true, job: { id: 'job-3', kind: 'link' } });
    expect(createJob).toHaveBeenCalledWith({
      kind: 'link',
      targetRef: 'https://www.douyin.com/video/7',
      autoProcess: undefined,
      publishToKnowledge: true,
    });
  });

  it('passes explicit auto_process / publish_to_knowledge flags to the job', async () => {
    ensureKeywordForAi.mockReturnValue({ ok: true, keyword: { id: 'kw-2' } });
    createJob.mockReturnValue({ id: 'job-4', kind: 'keyword' });
    runJob.mockResolvedValue(null);

    await startCollectJob({
      kind: 'keyword',
      input: '电商SOP',
      autoProcess: false,
      publishToKnowledge: false,
    });

    expect(createJob).toHaveBeenCalledWith({
      kind: 'keyword',
      targetRef: 'kw-2',
      autoProcess: false,
      publishToKnowledge: false,
    });
  });

  it('link: surfaces resolve failure', async () => {
    resolveAwemeInput.mockResolvedValue({ ok: false, error: '需要抖音视频链接。', phase: 'video-input' });
    const r = await startCollectJob({ kind: 'link', input: 'garbage' });
    expect(r).toEqual({ ok: false, error: '需要抖音视频链接。', phase: 'video-input' });
    expect(createJob).not.toHaveBeenCalled();
  });
});
