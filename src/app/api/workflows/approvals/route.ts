import { NextRequest, NextResponse } from 'next/server';
import { listApprovals, type ApprovalStatus } from '@/lib/workflow/approval-requests';

const VALID_STATUS: ApprovalStatus[] = ['pending', 'approved', 'rejected', 'timeout', 'cancelled'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get('status');
  const workflowRunId = searchParams.get('workflowRunId') ?? undefined;

  const status = statusParam && VALID_STATUS.includes(statusParam as ApprovalStatus)
    ? (statusParam as ApprovalStatus)
    : undefined;

  const items = listApprovals({
    ...(status ? { status } : {}),
    ...(workflowRunId ? { workflowRunId } : {}),
  });
  return NextResponse.json({ items });
}
