import { NextRequest, NextResponse } from 'next/server';
import { getMessageMemories } from '@/lib/db/message-memories';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: messageId } = await context.params;
    const memories = getMessageMemories(messageId);
    return NextResponse.json({ memories });
  } catch (error) {
    console.error('[messages/memories] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get message memories' },
      { status: 500 }
    );
  }
}
