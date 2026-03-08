import { NextRequest, NextResponse } from 'next/server';
import { upsertMemory, updateMemory, getMemory } from '@/lib/db/memories';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { conflictingMemoryId, newContent, action, sessionId, projectPath, scope, category } = body;

    if (!conflictingMemoryId || !newContent || !action) {
      return NextResponse.json(
        { error: 'conflictingMemoryId, newContent, and action are required' },
        { status: 400 }
      );
    }

    if (action === 'cancel') {
      return NextResponse.json({ resolved: false });
    }

    if (action === 'replace') {
      const result = updateMemory(conflictingMemoryId, { content: newContent });
      return NextResponse.json({ resolved: result.changed, memory: getMemory(conflictingMemoryId) });
    }

    if (action === 'keep_both') {
      const newMemory = upsertMemory({
        sessionId,
        projectPath,
        scope,
        category,
        content: newContent,
        evidence: newContent,
        source: 'user_explicit',
        confidence: 1,
      });
      return NextResponse.json({ resolved: true, memory: newMemory });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[memory/resolve-conflict] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve conflict' },
      { status: 500 }
    );
  }
}
