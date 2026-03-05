import { NextRequest, NextResponse } from 'next/server';
import { getSessionBinding, getSyncStats } from '@/lib/db/feishu-bridge';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId required', code: 'MISSING_PARAMETER' },
      { status: 400 }
    );
  }

  const binding = getSessionBinding(sessionId, 'feishu');
  if (!binding) {
    return NextResponse.json(
      { error: 'Binding not found', code: 'NOT_FOUND' },
      { status: 404 }
    );
  }

  const stats = getSyncStats(binding.id);

  return NextResponse.json({ stats });
}
