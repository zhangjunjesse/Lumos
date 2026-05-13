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
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
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
      const isOfficial = id.startsWith('gh_');
      const isGroup = Boolean(row.is_group);
      // 联系人元数据(_load_contacts)没加载到时, _display_name 把 display
      // 回退成 wxid 字符串(像 wxid_abc123),前端 sanitizeWechatText 又会清掉
      // → 100 行都显示同一个 "微信联系人",用户无法区分。fallback 至少展示
      // wxid 段落让用户能挑。
      const friendly = displayWechatName(row.display, id, {
        groupFallback: isGroup ? `群 #${id.split('@')[0].slice(-8)}` : '微信群聊',
        contactFallback: isOfficial
          ? `公众号 ${id.slice(3, 16)}`
          : id.startsWith('wxid_') ? id : `用户 ${id.slice(0, 16)}`,
      });
      return {
        id,
        name: friendly,
        isGroup,
        // contact / group / official_account / system 分类。前端 dialog
        // 用它做过滤(白名单/黑名单默认只看真实人和群,不展示公众号订阅)。
        kind: isGroup ? 'group'
          : isOfficial ? 'official_account'
          : id === 'notifymessage' || id === 'filehelper' ? 'system'
          : 'contact',
      };
    });
  return NextResponse.json({ ready: true, contacts });
}

function clampLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 200;
  return Math.min(1000, Math.max(20, Math.floor(value)));
}
