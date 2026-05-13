import { NextResponse } from 'next/server';

import { probeCookie } from '@/lib/douyin-collector/cookie-probe';
import { getDouyinCollectorSettings, markCookieOk } from '@/lib/douyin-collector/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Manual cookie liveness probe (Settings → 测试 Cookie button). Delegates
 * the actual fetch to `probeCookie` so behavior stays in sync with the
 * scheduled patrol probe. On success, also stamps cookieLastOkAt.
 */
export async function POST() {
  const settings = getDouyinCollectorSettings();
  const cookie = settings.cookie.trim();
  if (!cookie) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        message: '尚未配置 Cookie。先在「设置 → 抖音 Cookie」粘贴一份。',
      },
      { status: 400 },
    );
  }

  const r = await probeCookie(cookie);
  if (r.ok) markCookieOk();
  return NextResponse.json({
    ok: r.ok,
    configured: true,
    probeStatus: r.status,
    bodyPreview: r.bodyPreview,
    message: r.message,
  });
}
