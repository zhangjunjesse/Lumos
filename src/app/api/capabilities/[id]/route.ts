import { NextResponse } from 'next/server';
import { getDraft, getPackage } from '@/lib/db/capabilities';
import { initializeCapabilities } from '@/lib/capability/init';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeCapabilities();
    const { id } = await params;
    const capability = getPackage(id);
    if (capability) {
      return NextResponse.json(capability);
    }

    const draft = getDraft(id);
    if (draft) {
      return NextResponse.json({
        ...draft,
        status: 'draft',
        version: '待发布',
      });
    }

    return NextResponse.json(
      { error: 'Capability not found' },
      { status: 404 }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load capability' },
      { status: 500 }
    );
  }
}
