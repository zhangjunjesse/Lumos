import { NextRequest, NextResponse } from 'next/server';
import { getApprovalRequest } from '@/lib/workflow/approval-requests';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const approval = getApprovalRequest(id);
  if (!approval) {
    return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
  }
  return NextResponse.json(approval);
}
