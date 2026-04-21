/* eslint-disable @typescript-eslint/no-require-imports -- jest.resetModules() requires sync require() to reload modules between tests */
import Database from 'better-sqlite3';

const APPROVAL_SCHEMA = `
  CREATE TABLE workflow_approval_requests (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    approvers_json TEXT NOT NULL DEFAULT '{}',
    form_schema_json TEXT NOT NULL DEFAULT '',
    timeout_config_json TEXT NOT NULL DEFAULT '',
    timeout_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','approved','rejected','timeout','cancelled')),
    final_note TEXT NOT NULL DEFAULT '',
    final_payload_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT,
    UNIQUE(workflow_run_id, step_id)
  );
  CREATE TABLE workflow_approval_decisions (
    id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
    note TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '',
    decided_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(approval_id, decided_by),
    FOREIGN KEY (approval_id) REFERENCES workflow_approval_requests(id) ON DELETE CASCADE
  );
`;

let mockDb: Database.Database;

jest.mock('@/lib/db/connection', () => ({
  getDb: () => mockDb,
  closeDb: () => {},
  dataDir: '/tmp',
  DB_PATH: '/tmp/test.db',
}));

describe('approval-requests DAO', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockDb.exec(APPROVAL_SCHEMA);
  });

  afterEach(() => {
    mockDb.close();
  });

  function load() {
    jest.resetModules();
    return require('../approval-requests') as typeof import('../approval-requests');
  }

  test('createApprovalRequest persists row and returns hydrated object', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-1',
      stepId: 'ap',
      prompt: 'please review',
      approvers: { mode: 'any', users: ['alice', 'bob'] },
    });
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.status).toBe('pending');
    expect(req.approvers.users).toEqual(['alice', 'bob']);
    const fetched = m.getApprovalRequest(req.id);
    expect(fetched?.prompt).toBe('please review');
  });

  test('findActiveApproval returns the row by (workflowRunId, stepId)', () => {
    const m = load();
    const created = m.createApprovalRequest({
      workflowRunId: 'wf-2',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    const found = m.findActiveApproval('wf-2', 'ap');
    expect(found?.id).toBe(created.id);
    expect(m.findActiveApproval('wf-2', 'unknown')).toBeNull();
  });

  test('submitDecision (mode=any): first approval finalizes', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-3',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'any', users: ['alice', 'bob'] },
    });
    const r = m.submitDecision({
      approvalId: req.id,
      decidedBy: 'alice',
      decision: 'approved',
      note: 'ok',
    });
    expect(r.resolved).toBe(true);
    expect(r.approval.status).toBe('approved');
    expect(r.approval.finalNote).toBe('ok');
  });

  test('submitDecision (mode=all): requires all approvers', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-4',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'all', users: ['alice', 'bob'] },
    });
    const r1 = m.submitDecision({ approvalId: req.id, decidedBy: 'alice', decision: 'approved' });
    expect(r1.resolved).toBe(false);
    expect(r1.approval.status).toBe('pending');

    const r2 = m.submitDecision({ approvalId: req.id, decidedBy: 'bob', decision: 'approved' });
    expect(r2.resolved).toBe(true);
    expect(r2.approval.status).toBe('approved');
  });

  test('submitDecision (mode=all): any rejection finalizes as rejected', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-5',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'all', users: ['alice', 'bob'] },
    });
    const r = m.submitDecision({ approvalId: req.id, decidedBy: 'alice', decision: 'rejected', note: 'nope' });
    expect(r.resolved).toBe(true);
    expect(r.approval.status).toBe('rejected');
  });

  test('submitDecision (mode=quorum): quorum of approvals finalizes', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-6',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'quorum', users: ['a', 'b', 'c'], quorum: 2 },
    });
    m.submitDecision({ approvalId: req.id, decidedBy: 'a', decision: 'approved' });
    const r2 = m.submitDecision({ approvalId: req.id, decidedBy: 'b', decision: 'approved' });
    expect(r2.resolved).toBe(true);
    expect(r2.approval.status).toBe('approved');
  });

  test('submitDecision rejects unauthorized user', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-7',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    expect(() =>
      m.submitDecision({ approvalId: req.id, decidedBy: 'eve', decision: 'approved' }),
    ).toThrow(/not authorized/);
  });

  test('submitDecision rejects duplicate decision from same user', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-8',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'all', users: ['alice', 'bob'] },
    });
    m.submitDecision({ approvalId: req.id, decidedBy: 'alice', decision: 'approved' });
    expect(() =>
      m.submitDecision({ approvalId: req.id, decidedBy: 'alice', decision: 'approved' }),
    ).toThrow(/already decided/);
  });

  test('cancelApproval finalizes a pending request', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-9',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    const cancelled = m.cancelApproval(req.id, 'workflow cancelled');
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.finalNote).toBe('workflow cancelled');
  });

  test('cancelApproval is no-op on finalized row', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-10',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    m.submitDecision({ approvalId: req.id, decidedBy: 'alice', decision: 'approved' });
    const afterCancel = m.cancelApproval(req.id, 'too late');
    expect(afterCancel?.status).toBe('approved');
  });

  test('listApprovals filters by status and workflowRunId', () => {
    const m = load();
    const r1 = m.createApprovalRequest({
      workflowRunId: 'wf-A', stepId: 'a1', prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    const r2 = m.createApprovalRequest({
      workflowRunId: 'wf-A', stepId: 'a2', prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    m.createApprovalRequest({
      workflowRunId: 'wf-B', stepId: 'b1', prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
    });
    m.submitDecision({ approvalId: r1.id, decidedBy: 'alice', decision: 'approved' });

    const pending = m.listApprovals({ status: 'pending' });
    expect(pending.map((r) => r.id).sort()).toContain(r2.id);
    expect(pending.map((r) => r.id)).not.toContain(r1.id);

    const wfA = m.listApprovals({ workflowRunId: 'wf-A' });
    expect(wfA.length).toBe(2);
  });

  test('listPendingTimedOut returns only past-due pending', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-T', stepId: 'ap', prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
      timeoutConfig: { duration: 'PT0S', onTimeout: 'reject' },
    });
    const future = new Date(Date.now() + 1000);
    const expired = m.listPendingTimedOut(future);
    expect(expired.map((r) => r.id)).toContain(req.id);
  });

  test('timeoutApproval finalizes with reject by default', () => {
    const m = load();
    const req = m.createApprovalRequest({
      workflowRunId: 'wf-TR', stepId: 'ap', prompt: '',
      approvers: { mode: 'any', users: ['alice'] },
      timeoutConfig: { duration: 'PT1M', onTimeout: 'reject' },
    });
    const out = m.timeoutApproval(req.id);
    expect(out?.status).toBe('rejected');
  });
});

describe('computeConsensus (pure)', () => {
  function load() {
    jest.resetModules();
    return require('../approval-requests') as typeof import('../approval-requests');
  }

  const mkDec = (by: string, d: 'approved' | 'rejected') => ({
    id: by, approvalId: 'x', decidedBy: by, decision: d, note: '', payload: null, decidedAt: '',
  });

  test('mode=any', () => {
    const { computeConsensus } = load();
    expect(computeConsensus({ mode: 'any', users: ['a', 'b'] }, [])).toBe('pending');
    expect(computeConsensus({ mode: 'any', users: ['a', 'b'] }, [mkDec('a', 'approved')])).toBe('approved');
    expect(computeConsensus({ mode: 'any', users: ['a', 'b'] }, [mkDec('a', 'rejected')])).toBe('pending');
    expect(computeConsensus(
      { mode: 'any', users: ['a', 'b'] },
      [mkDec('a', 'rejected'), mkDec('b', 'rejected')],
    )).toBe('rejected');
  });

  test('mode=quorum', () => {
    const { computeConsensus } = load();
    expect(computeConsensus({ mode: 'quorum', users: ['a', 'b', 'c'], quorum: 2 },
      [mkDec('a', 'approved')])).toBe('pending');
    expect(computeConsensus({ mode: 'quorum', users: ['a', 'b', 'c'], quorum: 2 },
      [mkDec('a', 'approved'), mkDec('b', 'approved')])).toBe('approved');
    expect(computeConsensus({ mode: 'quorum', users: ['a', 'b', 'c'], quorum: 2 },
      [mkDec('a', 'rejected'), mkDec('b', 'rejected')])).toBe('rejected');
  });
});

describe('parseIsoDurationMs (pure)', () => {
  function load() {
    jest.resetModules();
    return require('../approval-requests') as typeof import('../approval-requests');
  }

  test('parses various durations', () => {
    const { parseIsoDurationMs } = load();
    expect(parseIsoDurationMs('PT1H')).toBe(60 * 60 * 1000);
    expect(parseIsoDurationMs('PT30M')).toBe(30 * 60 * 1000);
    expect(parseIsoDurationMs('P1D')).toBe(24 * 60 * 60 * 1000);
    expect(parseIsoDurationMs('P1DT2H')).toBe((24 + 2) * 60 * 60 * 1000);
    expect(parseIsoDurationMs('PT0S')).toBe(0);
  });

  test('returns 0 for garbage', () => {
    const { parseIsoDurationMs } = load();
    expect(parseIsoDurationMs('not a duration')).toBe(0);
    expect(parseIsoDurationMs('')).toBe(0);
  });
});
