/**
 * Admin guard: extracts current user from cookie and verifies admin role.
 * Returns the user if admin, or a 403 NextResponse if not.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from './session';
import type { LumosUser } from './types';

type AdminResult =
  | { ok: true; user: LumosUser }
  | { ok: false; response: NextResponse };

export function requireAdmin(req: NextRequest): AdminResult {
  const token = req.cookies.get('lumos_session')?.value;
  if (!token) {
    return { ok: false, response: NextResponse.json({ success: false, message: '未登录' }, { status: 401 }) };
  }

  const user = validateSession(token);
  if (!user) {
    return { ok: false, response: NextResponse.json({ success: false, message: '会话已过期' }, { status: 401 }) };
  }

  if (user.role !== 'admin') {
    return { ok: false, response: NextResponse.json({ success: false, message: '无权访问' }, { status: 403 }) };
  }

  return { ok: true, user };
}
