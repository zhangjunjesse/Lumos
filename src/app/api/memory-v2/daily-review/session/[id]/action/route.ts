import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  generateEventImprovement,
  generateEventExperience,
  sinkInsight,
} from '@/lib/memory-v2/digest-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.enum(['improvement', 'experience', 'insight']),
  index: z.number().int().min(0),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { action, index } = schema.parse(await request.json().catch(() => ({})));
    const result =
      action === 'improvement'
        ? await generateEventImprovement(id, index)
        : action === 'experience'
          ? await generateEventExperience(id, index)
          : sinkInsight(id, index);
    return NextResponse.json(result, { status: result.status === 'error' ? 422 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ status: 'error', error: message }, { status: 400 });
  }
}
