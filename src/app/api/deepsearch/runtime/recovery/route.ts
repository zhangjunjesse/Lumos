import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { reconcileDeepSearchWaitingRunsView } from '@/lib/deepsearch/service';

const deepSearchRecoveryRequestSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  runIds: z.array(z.string().trim().min(1)).optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = deepSearchRecoveryRequestSchema.parse(body);
    const result = await reconcileDeepSearchWaitingRunsView(input);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reconcile DeepSearch waiting-login runs' },
      { status: 400 },
    );
  }
}
