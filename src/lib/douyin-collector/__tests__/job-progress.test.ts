import {
  _resetJobProgressForTests,
  describeJobProgress,
  getJobProgress,
  reportJobProgress,
  clearJobProgress,
} from '../job-progress';

beforeEach(() => {
  _resetJobProgressForTests();
});

describe('reportJobProgress / getJobProgress', () => {
  it('auto-initialises and merges patches (absolute counters)', () => {
    reportJobProgress('j1', { phase: 'backfilling', total: 20 });
    reportJobProgress('j1', { processed: 3, added: 2, risk: 1 });
    const p = getJobProgress('j1');
    expect(p).toMatchObject({
      jobId: 'j1',
      phase: 'backfilling',
      total: 20,
      processed: 3,
      added: 2,
      risk: 1,
    });
  });

  it('returns null for unknown / empty jobId', () => {
    expect(getJobProgress('nope')).toBeNull();
    expect(getJobProgress('')).toBeNull();
  });

  it('never throws on empty jobId emit', () => {
    expect(() => reportJobProgress('', { phase: 'done' })).not.toThrow();
  });

  it('clearJobProgress drops the entry', () => {
    reportJobProgress('j2', { phase: 'processing' });
    clearJobProgress('j2');
    expect(getJobProgress('j2')).toBeNull();
  });

  it('prunes oldest entries past the cap', () => {
    for (let i = 0; i < 230; i++) reportJobProgress(`job-${i}`, { processed: i });
    expect(getJobProgress('job-0')).toBeNull(); // oldest evicted
    expect(getJobProgress('job-229')).not.toBeNull(); // newest kept
  });
});

describe('describeJobProgress', () => {
  it('prefers an explicit message', () => {
    expect(
      describeJobProgress({
        jobId: 'x',
        phase: 'backfilling',
        total: 9,
        processed: 1,
        added: 0,
        risk: 0,
        skipped: 0,
        message: '正在采集"电商SOP"…',
        updatedAt: '',
      }),
    ).toBe('正在采集"电商SOP"…');
  });

  it('phrases backfilling with counts', () => {
    const s = describeJobProgress({
      jobId: 'x',
      phase: 'backfilling',
      total: 20,
      processed: 7,
      added: 5,
      risk: 2,
      skipped: 0,
      message: '',
      updatedAt: '',
    });
    expect(s).toContain('7/20');
    expect(s).toContain('已入库 5');
    expect(s).toContain('被风控 2');
  });

  it('summarises the done phase', () => {
    const s = describeJobProgress({
      jobId: 'x',
      phase: 'done',
      total: 10,
      processed: 10,
      added: 8,
      risk: 1,
      skipped: 1,
      message: '',
      updatedAt: '',
    });
    expect(s).toContain('已入库 8');
    expect(s).toContain('被风控 1');
    expect(s).toContain('跳过 1');
  });
});
