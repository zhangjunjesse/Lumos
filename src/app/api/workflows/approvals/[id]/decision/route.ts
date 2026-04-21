import { NextRequest, NextResponse } from 'next/server';
import { submitDecision, type DecisionVote } from '@/lib/workflow/approval-requests';

type Params = { params: Promise<{ id: string }> };

interface DecisionBody {
  decidedBy: string;
  decision: DecisionVote;
  note?: string;
  payload?: unknown;
}

function isValidDecision(v: unknown): v is DecisionVote {
  return v === 'approved' || v === 'rejected';
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  let body: DecisionBody;
  try {
    body = (await request.json()) as DecisionBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.decidedBy !== 'string' || !body.decidedBy) {
    return NextResponse.json({ error: 'decidedBy is required' }, { status: 400 });
  }
  if (!isValidDecision(body.decision)) {
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
    return NextResponse.json({ approval: result.approval, resolved: result.resolved });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found')
      ? 404
      : message.includes('not authorized') || message.includes('already decided')
        ? 403
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
