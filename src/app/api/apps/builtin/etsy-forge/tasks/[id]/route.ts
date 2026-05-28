import { NextRequest, NextResponse } from 'next/server';
import { deleteTask, getTask, updateTask } from '@/lib/etsy-forge/collection-task';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import type { TaskSchedule } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SCHEDULES: TaskSchedule[] = ['manual', 'hourly', 'daily', 'weekly'];

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { enabled?: boolean; schedule?: string; max_products?: number };
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.schedule === 'string' && VALID_SCHEDULES.includes(body.schedule as TaskSchedule)) {
      patch.schedule = body.schedule;
    }
    if (typeof body.max_products === 'number' && body.max_products >= 1 && body.max_products <= 48) {
      patch.max_products = Math.floor(body.max_products);
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: '无可更新字段' }, { status: 400 });

    const store = getEtsyForgeStore();
    const updated = updateTask(store, id, patch);
    if (!updated) return NextResponse.json({ error: 'task not found' }, { status: 404 });
    return NextResponse.json({ task: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getEtsyForgeStore();
    if (!getTask(store, id)) return NextResponse.json({ error: 'task not found' }, { status: 404 });
    return NextResponse.json({ ok: deleteTask(store, id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
