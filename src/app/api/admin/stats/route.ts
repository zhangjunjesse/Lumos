import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getDb } from '@/lib/db/connection';

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  const db = getDb();

  const totalUsers = (db.prepare('SELECT COUNT(*) AS c FROM lumos_users').get() as { c: number }).c;
  const todayUsers = (db.prepare(
    "SELECT COUNT(*) AS c FROM lumos_users WHERE created_at >= date('now')",
  ).get() as { c: number }).c;
  const totalRevenue = (db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS s FROM lumos_orders WHERE status = 'paid'",
  ).get() as { s: number }).s;
  const todayRevenue = (db.prepare(
    "SELECT COALESCE(SUM(amount), 0) AS s FROM lumos_orders WHERE status = 'paid' AND paid_at >= date('now')",
  ).get() as { s: number }).s;
  const totalOrders = (db.prepare(
    "SELECT COUNT(*) AS c FROM lumos_orders WHERE status = 'paid'",
  ).get() as { c: number }).c;
  const todayImages = (db.prepare(
    "SELECT COALESCE(SUM(count), 0) AS s FROM lumos_image_usage WHERE created_at >= date('now')",
  ).get() as { s: number }).s;

  return NextResponse.json({
    success: true,
    data: { totalUsers, todayUsers, totalRevenue, todayRevenue, totalOrders, todayImages },
  });
}
