import {
  waitForApprovalResolution,
  notifyApprovalResolved,
  __clearApprovalWaiters,
} from '../approval-waiter';
import type { ApprovalRequest } from '../approval-requests';

describe('approval-waiter', () => {
  afterEach(() => __clearApprovalWaiters());

  function stubApproval(id: string, status: ApprovalRequest['status']): ApprovalRequest {
    return {
      id,
      workflowRunId: 'wf',
      stepId: 'ap',
      prompt: '',
      approvers: { mode: 'any', users: ['x'] },
      formSchema: null,
      timeoutConfig: null,
      timeoutAt: null,
      status,
      finalNote: '',
      finalPayload: null,
      createdAt: '',
      decidedAt: null,
      decisions: [],
    };
  }

  test('waiter resolves when notify is emitted', async () => {
    const pending = waitForApprovalResolution('a-1');
    notifyApprovalResolved(stubApproval('a-1', 'approved'));
    const got = await pending;
    expect(got.id).toBe('a-1');
    expect(got.status).toBe('approved');
  });

  test('notify to unrelated id does not resolve waiter', async () => {
    let resolved = false;
    const pending = waitForApprovalResolution('a-2').then((v) => { resolved = true; return v; });
    notifyApprovalResolved(stubApproval('other', 'approved'));
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    notifyApprovalResolved(stubApproval('a-2', 'rejected'));
    const got = await pending;
    expect(got.status).toBe('rejected');
  });
});
