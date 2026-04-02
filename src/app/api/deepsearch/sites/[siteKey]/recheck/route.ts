import { NextRequest, NextResponse } from 'next/server';
import { recheckDeepSearchSiteView } from '@/lib/deepsearch/service';

interface RouteContext {
  params: Promise<{ siteKey: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const { siteKey } = await context.params;

  try {
    const site = await recheckDeepSearchSiteView(siteKey);
    if (!site) {
      return NextResponse.json({ error: 'DeepSearch site not found' }, { status: 404 });
    }

    return NextResponse.json({ site });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to recheck DeepSearch site' },
      { status: 400 },
    );
  }
}
