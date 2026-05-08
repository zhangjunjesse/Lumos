import { type NextRequest, NextResponse } from 'next/server';

import { getNativeAppStatus } from '@/lib/app/status-service';
import { getAppPlatformService } from '@/lib/app/service';

/**
 * GET /api/apps/<id>/status
 *
 * First native-grade status service for user-created apps. It derives a
 * conservative product-facing state from app settings, visible run history,
 * engine run rows, and native-app-spec capability declarations.
 */

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const { db } = getAppPlatformService();
    const status = getNativeAppStatus(db, id);
    if (!status) {
      return NextResponse.json({ error: 'Not installed' }, { status: 404 });
    }
    return NextResponse.json({ status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
