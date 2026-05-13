import { NextResponse } from 'next/server';
import { logout } from '@/lib/x-platform/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  await logout();
  return NextResponse.json({ ok: true });
}
