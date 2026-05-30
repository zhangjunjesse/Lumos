import { NextRequest, NextResponse } from 'next/server';
import { clampPages, clampPrice, deleteTask, getTask, updateTask } from '@/lib/etsy-forge/collection-task';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import type { TaskSchedule } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SCHEDULES: TaskSchedule[] = ['manual', 'hourly', 'daily', 'weekly'];

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      enabled?: boolean;
      schedule?: string;
      max_products?: number;
      min_sales?: number;
      min_favorites?: number;
      min_price?: number;
      max_price?: number;
      max_pages?: number;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.schedule === 'string' && VALID_SCHEDULES.includes(body.schedule as TaskSchedule)) {
      patch.schedule = body.schedule;
    }
    if (typeof body.max_products === 'number' && body.max_products >= 1) {
      patch.max_products = Math.min(Math.floor(body.max_products), 500);
    }
    if (typeof body.min_sales === 'number') patch.min_sales = Math.max(0, Math.floor(body.min_sales));
    if (typeof body.min_favorites === 'number') patch.min_favorites = Math.max(0, Math.floor(body.min_favorites));
    if (typeof body.min_price === 'number') patch.min_price = clampPrice(body.min_price);
    if (typeof body.max_price === 'number') patch.max_price = clampPrice(body.max_price);
    if (typeof body.max_pages === 'number') patch.max_pages = clampPages(body.max_pages);
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
