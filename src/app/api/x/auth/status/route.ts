import { NextResponse } from 'next/server';
import { getAuthStatus, isBuiltinBrowserAvailable } from '@/lib/x-platform/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = await getAuthStatus({ refreshFromGraphQL: true });
  return NextResponse.json({
    ...status,
    builtinBrowserReady: isBuiltinBrowserAvailable(),
  });
}
