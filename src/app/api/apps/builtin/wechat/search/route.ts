import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { searchMessages } from '@/lib/wechat-assistant/mirror-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scopeSchema = z.enum(['all', 'personal', 'group']).catch('all');
const daysSchema = z.union([
  z.literal('all'),
  z.coerce.number().int().positive().max(3650),
]).catch(90);

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = (params.get('q') ?? '').trim().slice(0, 120);
  if (!query) {
    return NextResponse.json({
      query: '',
      scope: 'all',
      days: 90,
      results: [],
    });
  }

  const scope = scopeSchema.parse(params.get('scope') ?? 'all');
  const days = daysSchema.parse(params.get('days') ?? '90');
  const limit = clampInt(params.get('limit'), 1, 100, 50);
  const sinceTs = days === 'all'
    ? null
    : Math.floor(Date.now() / 1000) - days * 86400;

  const results = searchMessages({
    query,
    scope,
    sinceTs,
    limit,
  });

  return NextResponse.json({
    query,
    scope,
    days,
    results,
  });
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
