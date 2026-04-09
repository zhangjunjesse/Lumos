import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getDb } from '@/lib/db/connection';

/** GET /api/admin/orders?page=1&size=20&status=paid */
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size')) || 20));
  const status = url.searchParams.get('status') || '';
  const offset = (page - 1) * size;

  const db = getDb();
  const where = status ? "WHERE o.status = ?" : '';
  const params = status ? [status] : [];

  const total = (db.prepare(
    `SELECT COUNT(*) AS c FROM lumos_orders o ${where}`,
  ).get(...params) as { c: number }).c;

  const orders = db.prepare(
    `SELECT o.*, u.email AS user_email, u.nickname AS user_nickname
     FROM lumos_orders o
     LEFT JOIN lumos_users u ON u.id = o.user_id
     ${where}
     ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, size, offset);

  return NextResponse.json({ success: true, data: { orders, total, page, size } });
}
