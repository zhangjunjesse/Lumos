import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { getDeepSearchRunView, updateDeepSearchRunEntry, deleteDeepSearchRunEntry } from '@/lib/deepsearch/service';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const runActionSchema = z.object({
  action: z.enum(['pause', 'resume', 'cancel']),
}).strict();

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const run = await getDeepSearchRunView(id);
    if (!run) {
      return NextResponse.json({ error: 'DeepSearch run not found' }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load DeepSearch run' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json();
    const input = runActionSchema.parse(body);
    const run = await updateDeepSearchRunEntry(id, input.action, {
      importConfiguredCookie: input.action === 'resume' ? false : undefined,
    });
    return NextResponse.json({ run });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update DeepSearch run';
    const status = message === 'DeepSearch run not found' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const deleted = await deleteDeepSearchRunEntry(id);
    if (!deleted) {
      return NextResponse.json({ error: 'DeepSearch run not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete DeepSearch run' },
      { status: 500 },
    );
  }
}
