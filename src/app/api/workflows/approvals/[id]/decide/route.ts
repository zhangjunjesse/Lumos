import { NextRequest, NextResponse } from 'next/server';
import { submitDecision } from '@/lib/workflow/approval-requests';
import { notifyApprovalResolved } from '@/lib/workflow/approval-waiter';

type Params = { params: Promise<{ id: string }> };

interface DecideBody {
  decidedBy?: string;
  decision?: 'approved' | 'rejected';
  note?: string;
  payload?: unknown;
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as DecideBody;

  if (!body.decidedBy?.trim()) {
    return NextResponse.json({ error: 'decidedBy is required' }, { status: 400 });
  }
  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be "approved" or "rejected"' }, { status: 400 });
  }

  try {
    const result = submitDecision({
      approvalId: id,
      decidedBy: body.decidedBy,
      decision: body.decision,
      note: body.note,
      payload: body.payload,
    });
    if (result.resolved) {
      notifyApprovalResolved(result.approval);
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Decision failed';
    const status = message.includes('not found') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
