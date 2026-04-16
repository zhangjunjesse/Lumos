import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

describe('workflow debug session repo', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-debug-session-'));
    delete process.env.LUMOS_DATA_DIR;
    process.env.CLAUDE_GUI_DATA_DIR = tmpDir;
    jest.resetModules();
  });

  afterEach(async () => {
    const { closeDb } = await import('../connection');
    closeDb();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_GUI_DATA_DIR;
    jest.resetModules();
  });

  async function loadRepo() {
    return import('../debug-session');
  }

  function stubOutput(stepId: string, sessionId: string, overrides: Partial<{ configHash: string; status: 'success' | 'error'; output: unknown }> = {}) {
    return {
      sessionId,
      stepId,
      output: overrides.output ?? { hello: 'world' },
      metadata: {},
      status: overrides.status ?? 'success',
      durationMs: 123,
      configHash: overrides.configHash ?? crypto.randomUUID(),
      completedAt: new Date().toISOString(),
    };
  }

  it('creates a session exactly once per workflow and returns the same row thereafter', async () => {
    const { getOrCreateDebugSession, getDebugSessionByWorkflow } = await loadRepo();
    const a = getOrCreateDebugSession('wf-1');
    const b = getOrCreateDebugSession('wf-1');
    expect(a.id).toBe(b.id);
    expect(getDebugSessionByWorkflow('wf-1')?.id).toBe(a.id);
    expect(getDebugSessionByWorkflow('wf-missing')).toBeNull();
  });

  it('upserts small outputs inline and round-trips output / metadata / configHash', async () => {
    const { getOrCreateDebugSession, upsertCachedStep, loadCachedSteps } = await loadRepo();
    const session = getOrCreateDebugSession('wf-2');
    upsertCachedStep(session.id, stubOutput('s1', session.id, { configHash: 'hash-a' }));

    const rows = loadCachedSteps(session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].stepId).toBe('s1');
    expect(rows[0].configHash).toBe('hash-a');
    expect(rows[0].output).toEqual({ hello: 'world' });
    expect(rows[0].outputBlobPath).toBeNull();
  });

  it('spills outputs larger than 64 KB to disk and reads them back transparently', async () => {
    const { getOrCreateDebugSession, upsertCachedStep, loadCachedSteps } = await loadRepo();
    const session = getOrCreateDebugSession('wf-3');
    const big = { blob: 'x'.repeat(70_000) };
    upsertCachedStep(session.id, stubOutput('big', session.id, { output: big, configHash: 'h' }));

    const rows = loadCachedSteps(session.id);
    expect(rows[0].outputBlobPath).toBeTruthy();
    expect(rows[0].output).toEqual(big);
    const blobPath = path.join(tmpDir, 'debug', session.id, rows[0].outputBlobPath!);
    expect(fs.existsSync(blobPath)).toBe(true);
  });

  it('deleteCachedStep also removes the blob file on disk', async () => {
    const { getOrCreateDebugSession, upsertCachedStep, deleteCachedStep, loadCachedSteps } = await loadRepo();
    const session = getOrCreateDebugSession('wf-4');
    const big = { blob: 'y'.repeat(70_000) };
    upsertCachedStep(session.id, stubOutput('big', session.id, { output: big }));
    const blobs = loadCachedSteps(session.id);
    const blobPath = path.join(tmpDir, 'debug', session.id, blobs[0].outputBlobPath!);
    expect(fs.existsSync(blobPath)).toBe(true);

    deleteCachedStep(session.id, 'big');
    expect(loadCachedSteps(session.id)).toHaveLength(0);
    expect(fs.existsSync(blobPath)).toBe(false);
  });

  it('deleteCachedStepsAndDownstream runs in a transaction and removes all listed ids + blobs', async () => {
    const { getOrCreateDebugSession, upsertCachedStep, deleteCachedStepsAndDownstream, loadCachedSteps } = await loadRepo();
    const session = getOrCreateDebugSession('wf-5');
    upsertCachedStep(session.id, stubOutput('a', session.id));
    upsertCachedStep(session.id, stubOutput('b', session.id));
    upsertCachedStep(session.id, stubOutput('c', session.id));

    deleteCachedStepsAndDownstream(session.id, ['b', 'c']);
    const rows = loadCachedSteps(session.id);
    expect(rows.map(r => r.stepId).sort()).toEqual(['a']);
  });

  it('clearDebugSession removes all rows and the blob directory', async () => {
    const { getOrCreateDebugSession, upsertCachedStep, clearDebugSession, loadCachedSteps } = await loadRepo();
    const session = getOrCreateDebugSession('wf-6');
    upsertCachedStep(session.id, stubOutput('a', session.id));
    upsertCachedStep(session.id, stubOutput('big', session.id, { output: { blob: 'z'.repeat(70_000) } }));
    const sessDir = path.join(tmpDir, 'debug', session.id);
    expect(fs.existsSync(sessDir)).toBe(true);

    clearDebugSession(session.id);
    expect(loadCachedSteps(session.id)).toHaveLength(0);
    expect(fs.existsSync(sessDir)).toBe(false);
  });

  it('loadStepCacheMetas returns lightweight rows (status / durationMs / stale:false)', async () => {
    const { getOrCreateDebugSession, upsertCachedStep, loadStepCacheMetas } = await loadRepo();
    const session = getOrCreateDebugSession('wf-7');
    upsertCachedStep(session.id, stubOutput('a', session.id, { status: 'error' }));
    const metas = loadStepCacheMetas(session.id);
    expect(metas).toHaveLength(1);
    expect(metas[0].status).toBe('error');
    expect(metas[0].stale).toBe(false);
  });
});
