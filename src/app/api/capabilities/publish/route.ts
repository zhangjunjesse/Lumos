import { NextRequest, NextResponse } from 'next/server';
import { deleteDraft, getDraft } from '@/lib/db/capabilities';
import { publishCapabilityDraft } from '@/lib/capability/publish';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { draftId?: string };
    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : '';

    if (!draftId) {
      return NextResponse.json(
        { error: 'draftId is required' },
        { status: 400 }
      );
    }

    const draft = getDraft(draftId);
    if (!draft) {
      return NextResponse.json(
        { error: 'Capability draft not found' },
        { status: 404 }
      );
    }

    const result = await publishCapabilityDraft(draft);
    deleteDraft(draftId);

    return NextResponse.json({
      success: true,
      capability: result.capability,
      filePath: result.filePath,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to publish capability' },
      { status: 500 }
    );
  }
}
