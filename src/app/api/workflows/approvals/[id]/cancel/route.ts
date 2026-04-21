import { NextRequest, NextResponse } from 'next/server';
import { cancelApproval } from '@/lib/workflow/approval-requests';
import { notifyApprovalResolved } from '@/lib/workflow/approval-waiter';

type Params = { params: Promise<{ id: string }> };

interface CancelBody {
  reason?: string;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as CancelBody;
  const approval = cancelApproval(id, body.reason ?? '');
  if (!approval) {
    return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  }
  if (approval.status === 'cancelled') {
    notifyApprovalResolved(approval);
  }
  return NextResponse.json(approval);
}
