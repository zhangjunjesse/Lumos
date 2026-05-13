import { NextResponse } from 'next/server';
import { readCookies, hasRequiredCookies } from '@/lib/x-platform/cookies-store';
import { saveDeepSearchSite } from '@/lib/deepsearch/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/x/auth/sync-deepsearch
 *
 * 强制把本机 X cookies-store 里的 cookies 同步到 DeepSearch
 * (deepsearch_sites.cookie_value),并触发一次 probe。返回完整的 site state
 * 让前端能直接展示 loginState / blockingReason / lastError。
 *
 * 用户老的 paste 状态(同步代码加之前的)可以靠这个一次性修复。
 */
export async function POST() {
  const stored = readCookies();
  if (!stored || !hasRequiredCookies(stored.cookies)) {
    return NextResponse.json({
      ok: false,
      message: '本机没有 X cookies,先到 X 面板登录或粘贴',
    }, { status: 400 });
  }
  const raw = Object.entries(stored.cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  console.log('[x-auth/sync] forcing saveDeepSearchSite, cookie length:', raw.length);
  try {
    const site = await saveDeepSearchSite({
      siteKey: 'x',
      displayName: 'X / Twitter',
      baseUrl: 'https://x.com',
      cookieValue: raw,
    });
    console.log('[x-auth/sync] done:', {
      siteKey: site.siteKey,
      hasCookie: site.hasCookie,
      cookieStatus: site.cookieStatus,
      liveState: site.liveState,
    });
    return NextResponse.json({
      ok: true,
      site: {
        siteKey: site.siteKey,
        hasCookie: site.hasCookie,
        cookieStatus: site.cookieStatus,
        loginState: site.liveState?.loginState ?? null,
        blockingReason: site.liveState?.blockingReason ?? '',
        lastError: site.liveState?.lastError ?? '',
      },
    });
  } catch (err) {
    console.error('[x-auth/sync] FAILED:', err);
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
