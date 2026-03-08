import { NextRequest, NextResponse } from 'next/server';
import { getMemory } from '@/lib/db/memories';
import { getMemoryUsageLog } from '@/lib/db/memory-usage-log';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const memoryId = params.id;
    const memory = getMemory(memoryId);

    if (!memory) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    }

    const usageLog = getMemoryUsageLog(memoryId, 50);

    return NextResponse.json({ memory, usageLog });
  } catch (error) {
    console.error('[memory/detail] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get memory detail' },
      { status: 500 }
    );
  }
}
