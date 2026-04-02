import { NextRequest, NextResponse } from 'next/server';
import { openDeepSearchSiteLoginView } from '@/lib/deepsearch/service';

interface RouteContext {
  params: Promise<{ siteKey: string }>;
}

export async function POST(_request: NextRequest, context: RouteContext) {
  const { siteKey } = await context.params;

  try {
    const result = await openDeepSearchSiteLoginView(siteKey);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open DeepSearch site login';
    const status = message.startsWith('Unknown DeepSearch site:') ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
