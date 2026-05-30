import { NextRequest, NextResponse } from 'next/server';
import { clampPages, clampPrice, createTask, listTasks } from '@/lib/etsy-forge/collection-task';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import type { TaskSchedule } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SCHEDULES: TaskSchedule[] = ['manual', 'hourly', 'daily', 'weekly'];

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const tasks = listTasks(store, getStorageUserId(req));
    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      keyword?: string;
      schedule?: string;
      max_products?: number;
      min_sales?: number;
      min_favorites?: number;
      min_price?: number;
      max_price?: number;
      max_pages?: number;
    };
    const keyword = (body.keyword ?? '').trim();
    if (!keyword || keyword.length > 120) {
      return NextResponse.json({ error: '关键词必填（≤120 字）' }, { status: 400 });
    }
    const schedule =
      typeof body.schedule === 'string' && VALID_SCHEDULES.includes(body.schedule as TaskSchedule)
        ? (body.schedule as TaskSchedule)
        : 'manual';
    const maxProducts =
      typeof body.max_products === 'number' && body.max_products >= 1
        ? Math.min(Math.floor(body.max_products), 500)
        : undefined;
    const minSales = typeof body.min_sales === 'number' ? Math.max(0, Math.floor(body.min_sales)) : undefined;
    const minFavorites =
      typeof body.min_favorites === 'number' ? Math.max(0, Math.floor(body.min_favorites)) : undefined;
    const minPrice = typeof body.min_price === 'number' ? clampPrice(body.min_price) : undefined;
    const maxPrice = typeof body.max_price === 'number' ? clampPrice(body.max_price) : undefined;
    const maxPages = typeof body.max_pages === 'number' ? clampPages(body.max_pages) : undefined;

    const store = getEtsyForgeStore();
    const task = createTask(store, {
      userId: getStorageUserId(req),
      keyword,
      schedule,
      maxProducts,
      minSales,
      minFavorites,
      minPrice,
      maxPrice,
      maxPages,
    });
    return NextResponse.json({ task });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
