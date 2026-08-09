// POST /api/wechat-export/bind-account  { wxid }
//
// 让用户**直接点选**要用哪个微信号,而不是去文件系统里翻目录。
//
// 起因:自动检测按消息库 mtime 猜"当前登录账号",经常猜错(新号刚登录没写消息、
// 旧号文件被杀毒碰过)。猜错之后用户唯一的纠正手段是手动指定聊天数据目录 —— 可
// 那要求他知道微信把数据放哪、该选哪一层,门槛太高。但 Lumos 其实**已经扫到了
// 本机所有账号目录**,直接列出来让他点一下就行。
//
// 绑定成功后:镜像库切到该账号、取密钥以它为目标账号,不再猜。

import { NextResponse } from 'next/server';
import { getWeChatExportPlatform, writeWindowsPathConfig } from '@/lib/wechat-export/setup-state';
import { detectActiveWindowsAccount } from '@/lib/wechat-export/account-binding';
import { getWindowsWeChatRootCandidates, listWindowsAccounts } from '@/lib/wechat-export/env-check';
import { writeBoundAccount } from '@/lib/wechat-export/active-account';
import { readWindowsAccounts } from '@/lib/wechat-export/setup-state';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 在所有候选根里找这个 wxid 的账号目录。找不到说明它不是本机真实存在的账号。 */
function findAccountDir(wxid: string): string | null {
  const roots = new Set<string>([
    ...getWindowsWeChatRootCandidates(),
    ...readWindowsAccounts()
      .map((a) => (a.wx_dir?.trim() ? path.dirname(a.wx_dir.trim()) : null))
      .filter((v): v is string => Boolean(v)),
  ]);
  for (const root of roots) {
    for (const acc of listWindowsAccounts(root)) {
      if (acc.wxid === wxid) return acc.wxDir;
    }
  }
  return null;
}

export async function POST(request: Request) {
  if (getWeChatExportPlatform() !== 'win32') {
    return NextResponse.json({
      error: 'unsupported_platform',
      message: '按账号绑定目前只在 Windows 版 Lumos 中可用。',
    }, { status: 400 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const wxid = typeof body.wxid === 'string' ? body.wxid.trim() : '';
  if (!wxid) {
    return NextResponse.json({ error: 'invalid_request', message: '请选择一个微信号。' }, { status: 400 });
  }

  const wxDir = findAccountDir(wxid);
  if (!wxDir) {
    return NextResponse.json({
      error: 'account_not_found',
      message: `本机没有找到账号 ${wxid} 的聊天数据目录。如果它在别的盘,请用下面的「手动指定微信路径」选中该目录。`,
    }, { status: 400 });
  }

  const bound = writeBoundAccount(wxid);
  if (!bound) {
    return NextResponse.json({ error: 'invalid_wxid', message: '这个账号标识不合法。' }, { status: 400 });
  }
  // 数据根一并指向该账号的父目录,让后续 env 探测和取密钥都对准它。
  writeWindowsPathConfig({ wechatDataRoot: path.dirname(wxDir) });

  return NextResponse.json({ ok: true, wxid, wxDir, message: `已绑定微信号 ${wxid}。` });
}

/** 列出本机检测到的所有账号,给界面做选择列表。 */
export async function GET() {
  if (getWeChatExportPlatform() !== 'win32') {
    return NextResponse.json({ accounts: [] });
  }
  const { detectedWxids, activeWxid } = detectActiveWindowsAccount();
  return NextResponse.json({ accounts: detectedWxids, guessedActive: activeWxid });
}
