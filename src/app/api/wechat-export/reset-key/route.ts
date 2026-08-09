// POST /api/wechat-export/reset-key
//
// #40:切换微信账号或微信升级后旧密钥失效,提供"清旧密钥+重新绑定当前账号"的入口。
// 动作:停用 MCP(旧密钥下同步只会持续失败)→ 清掉旧密钥/账号绑定 → 若手动数据根指向
// 旧账号目录一并清掉(让重新检测挑到当前活跃账号)。保留同意记录。之后用户重新取密钥即可。

import { NextResponse } from 'next/server';
import { getWeChatExportPlatform, clearRecoveredKeys, clearWindowsPathConfig, readWindowsAccounts } from '@/lib/wechat-export/setup-state';
import { shouldClearStaleDataRoot } from '@/lib/wechat-export/account-binding';
import { clearBoundAccount } from '@/lib/wechat-export/active-account';
import { getMcpServerByNameAndScope, updateMcpServer } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const platform = getWeChatExportPlatform();
  if (!platform) {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }

  const storedWxDir = readWindowsAccounts()[0]?.wx_dir?.trim() || null;

  // 停用 MCP:旧密钥失效下继续同步只会反复报"密钥不匹配"。
  const mcp = getMcpServerByNameAndScope('wechat-export', 'builtin');
  if (mcp) updateMcpServer(mcp.id, { is_enabled: false });

  clearRecoveredKeys();
  // 密钥没了,绑定也必须跟着解除 —— 否则镜像库还认着旧账号,重新取密钥前
  // 界面依旧显示上一个号的数据(正是用户反馈的"点了没反应")。
  clearBoundAccount();
  // 手动数据根若正指向旧账号目录,清掉它,让 env 重新检测挑到当前活跃账号。
  if (platform === 'win32' && shouldClearStaleDataRoot(storedWxDir)) {
    clearWindowsPathConfig('dataDir');
  }

  return NextResponse.json({ success: true });
}
