import { NextResponse } from 'next/server';
import { buildMemoryV2ReflectionReport } from '@/lib/memory-v2/reflection';
import { runMemoryV2Consolidation } from '@/lib/memory-v2/consolidation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ report: buildMemoryV2ReflectionReport() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build Memory v2 reflection report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 手动「立即自省」按底线①不再写体检单记忆：实际去做收敛（去重归档），
// 返回收敛结果 + 收敛后的报告。
export async function POST() {
  try {
    const consolidation = runMemoryV2Consolidation();
    return NextResponse.json({
      report: buildMemoryV2ReflectionReport(),
      consolidation,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run Memory v2 reflection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
