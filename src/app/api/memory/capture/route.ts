import { NextRequest, NextResponse } from 'next/server';
import { captureExplicitMemoryFromUserInput } from '@/lib/memory/runtime';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, projectPath, userInput } = body;

    if (!sessionId || !userInput) {
      return NextResponse.json(
        { error: 'sessionId and userInput are required' },
        { status: 400 }
      );
    }

    const memory = captureExplicitMemoryFromUserInput({
      sessionId,
      projectPath,
      userInput,
    });

    if (!memory) {
      return NextResponse.json({ captured: false });
    }

    return NextResponse.json({
      captured: true,
      memory,
      action: memory.updated_at === memory.created_at ? 'created' : 'updated',
    });
  } catch (error) {
    console.error('[memory/capture] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to capture memory' },
      { status: 500 }
    );
  }
}
