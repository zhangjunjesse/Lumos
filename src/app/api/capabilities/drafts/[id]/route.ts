import { NextRequest, NextResponse } from 'next/server';
import { getDraft } from '@/lib/db/capabilities';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = getDraft(id);
    if (!draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }
    return NextResponse.json(draft);
  } catch (error) {
    console.error('Failed to get draft:', error);
    return NextResponse.json(
      { error: 'Failed to get draft' },
      { status: 500 }
    );
  }
}
