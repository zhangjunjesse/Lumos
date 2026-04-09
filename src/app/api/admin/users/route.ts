import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-guard';
import { getDb } from '@/lib/db/connection';

/** GET /api/admin/users?page=1&size=20&q=keyword */
export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size')) || 20));
  const q = url.searchParams.get('q')?.trim() || '';
  const offset = (page - 1) * size;

  const db = getDb();
  const where = q ? "WHERE (email LIKE ? OR nickname LIKE ?)" : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const total = (db.prepare(
    `SELECT COUNT(*) AS c FROM lumos_users ${where}`,
  ).get(...params) as { c: number }).c;

  const users = db.prepare(
    `SELECT id, email, nickname, role, membership, membership_expires_at,
            image_quota_monthly, status, last_login_at, created_at
     FROM lumos_users ${where}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, size, offset);

  return NextResponse.json({ success: true, data: { users, total, page, size } });
}

/** PATCH /api/admin/users -- update user fields */
export async function PATCH(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;

  const { userId, ...fields } = await req.json();
  if (!userId) {
    return NextResponse.json({ success: false, message: '缺少 userId' }, { status: 400 });
  }

  const allowed = ['nickname', 'role', 'membership', 'image_quota_monthly', 'status'] as const;
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ success: false, message: '无可更新字段' }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  vals.push(userId);

  const db = getDb();
  db.prepare(`UPDATE lumos_users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  return NextResponse.json({ success: true });
}
