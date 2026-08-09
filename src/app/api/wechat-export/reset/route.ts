// POST /api/wechat-export/reset
//
// 「清空微信配置,重新来过」——用户自助的兜底出口。
//
// 存在的理由:此前所有自救入口(重新绑定、手动指路径)都是**条件显示**的,而换微信号
// 恰好让这些条件同时不成立(旧目录还在→检测"成功"→手动入口藏起来;新号数据少→
// 猜不出换了号→重新绑定入口也藏起来)。用户界面上一个能点的都没有,只能找开发。
// 所以这个接口不设任何前置条件,任何时候都能调用。
//
// scope=keys 只清密钥绑定(等价旧的 reset-key);scope=all 连手动路径和该账号的
// 镜像数据一起清 —— 后者才是"界面还显示上一个号的聊天数据"的根源。
// 同意记录始终保留:那是法律声明,与账号无关。

import { NextResponse } from 'next/server';
import {
  clearRecoveredKeys,
  clearWindowsPathConfig,
  getWeChatExportPlatform,
} from '@/lib/wechat-export/setup-state';
import {
  clearBoundAccount,
  getActiveAccountKey,
  readBoundAccount,
} from '@/lib/wechat-export/active-account';
import { deleteMirrorForAccount, listMirrorAccounts } from '@/lib/wechat-assistant/mirror-db';
import { getMcpServerByNameAndScope, updateMcpServer } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ResetScope = 'keys' | 'all';

function parseScope(value: unknown): ResetScope {
  return value === 'keys' ? 'keys' : 'all';
}

export async function POST(request: Request) {
  const platform = getWeChatExportPlatform();
  if (!platform) {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const scope = parseScope(body.scope);
  // 只清指定账号(默认当前绑定账号)。传 allAccounts 才会连历史账号的镜像一起删。
  const allAccounts = body.allAccounts === true;
  const target = typeof body.account === 'string' && body.account.trim()
    ? body.account.trim()
    : getActiveAccountKey();

  const before = readBoundAccount();

  // 停用 MCP:密钥已清,继续同步只会反复报"密钥不匹配"。用户重新取密钥后再启用。
  const mcp = getMcpServerByNameAndScope('wechat-export', 'builtin');
  if (mcp) updateMcpServer(mcp.id, { is_enabled: false });

  clearRecoveredKeys();
  clearBoundAccount();

  const clearedMirrors: string[] = [];
  if (scope === 'all') {
    // 手动路径无条件清掉:留着它会把"重新检测"钉死在旧账号目录上,
    // 正是用户反复遇到的"怎么点都还是上一个号"。
    clearWindowsPathConfig();
    for (const account of allAccounts ? listMirrorAccounts() : [target]) {
      deleteMirrorForAccount(account);
      clearedMirrors.push(account);
    }
  }

  return NextResponse.json({
    success: true,
    scope,
    previousAccount: before?.wxid ?? null,
    clearedMirrors,
  });
}
