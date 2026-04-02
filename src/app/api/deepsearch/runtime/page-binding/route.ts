import { NextRequest, NextResponse } from 'next/server';
import { getDeepSearchBrowserBindingPreview } from '@/lib/deepsearch/service';

export async function GET(request: NextRequest) {
  try {
    const pageMode = request.nextUrl.searchParams.get('pageMode') === 'managed_page'
      ? 'managed_page'
      : 'takeover_active_page';

    const preview = await getDeepSearchBrowserBindingPreview(pageMode);
    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load DeepSearch browser binding preview' },
      { status: 500 }
    );
  }
}
