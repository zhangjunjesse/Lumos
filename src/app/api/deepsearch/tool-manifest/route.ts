import { NextResponse } from 'next/server';
import { getDeepSearchToolManifest } from '@/lib/deepsearch/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const manifest = getDeepSearchToolManifest();
    return NextResponse.json(manifest);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build DeepSearch tool manifest' },
      { status: 500 }
    );
  }
}
