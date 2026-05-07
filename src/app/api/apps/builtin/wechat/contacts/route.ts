import { NextRequest, NextResponse } from 'next/server';

import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { hasRecoveredKey } from '@/lib/wechat-export/setup-state';
import { displayWechatName } from '@/lib/wechat-assistant/wechat-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionRow {
  wxid?: string;
  display?: string;
  is_group?: boolean;
}

export async function GET(req: NextRequest) {
  if (process.platform !== 'darwin') {
    return NextResponse.json({ ready: false, reason: 'unsupported_platform', contacts: [] });
  }
  if (!hasValidConsent()) {
    return NextResponse.json({ ready: false, reason: 'consent_required', contacts: [] });
  }
  if (!hasRecoveredKey()) {
    return NextResponse.json({ ready: false, reason: 'no_key', contacts: [] });
  }

  const limit = clampLimit(req.nextUrl.searchParams.get('limit'));
  const result = await queryWeChatApi<{ items?: SessionRow[] }>(
    'list_sessions',
    { limit },
  );
  if (!result.ok) {
    return NextResponse.json(
      { ready: false, reason: result.error.code, contacts: [] },
      { status: 500 },
    );
  }
  const contacts = (result.data.items ?? [])
    .filter((row) => row.wxid)
    .map((row) => {
      const id = String(row.wxid);
      return {
        id,
        name: displayWechatName(row.display, id, {
          groupFallback: '微信群聊',
          contactFallback: '微信联系人',
        }),
        isGroup: Boolean(row.is_group),
      };
    });
  return NextResponse.json({ ready: true, contacts });
}

function clampLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 200;
  return Math.min(1000, Math.max(20, Math.floor(value)));
}
