import { NextRequest, NextResponse } from 'next/server';
import { listDrafts } from '@/lib/db/capabilities';

export async function GET(request: NextRequest) {
  try {
    const drafts = listDrafts();
    return NextResponse.json(drafts);
  } catch (error) {
    console.error('Failed to list drafts:', error);
    return NextResponse.json(
      { error: 'Failed to list drafts' },
      { status: 500 }
    );
  }
}
