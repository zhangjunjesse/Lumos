import { NextResponse } from 'next/server';
import { runEnvProbes } from '@/lib/wechat-export/env-check';
import {
  DISCLAIMER_BODY,
  DISCLAIMER_SUMMARY,
  DISCLAIMER_VERSION,
  DISCLAIMER_EFFECTIVE_AT,
  getDisclaimerHash,
  hasValidConsent,
  getConsent,
} from '@/lib/wechat-export/disclaimer';
import { getSetupStatus, getWeChatExportPlatform, readWindowsAccounts, readWindowsPathConfig } from '@/lib/wechat-export/setup-state';
import { getWindowsAccountBinding } from '@/lib/wechat-export/account-binding';
import { getLastMirrorSyncAt } from '@/lib/wechat-assistant/mirror-store';
import { listMirrorAccounts } from '@/lib/wechat-assistant/mirror-db';
import { backfillBoundAccount, readBoundAccount } from '@/lib/wechat-export/active-account';
import { getMcpServerByNameAndScope } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/wechat-export/status
 *
 * One-shot snapshot for the panel: env probes, consent, setup phase, and
 * whether the MCP entry itself is currently enabled. The panel polls this
 * endpoint on focus / after each user action.
 */
export async function GET() {
  const platform = getWeChatExportPlatform();
  if (!platform) {
    return NextResponse.json({
      supported: false,
      platform: process.platform,
      message: '微信导出能力目前支持 macOS 和 Windows。',
    });
  }
  const env = runEnvProbes(platform);
  const status = getSetupStatus(env.allOk, env.signed, platform);
  const mcp = getMcpServerByNameAndScope('wechat-export', 'builtin');
  // 老用户升级补一次绑定:早就配好数据目录/取过密钥的,不该还显示"尚未绑定"。
  if (platform === 'win32') {
    backfillBoundAccount({
      dataRootWxid: 'wxDir' in env.dataDir ? env.dataDir.wxid : null,
      keyedWxids: readWindowsAccounts()
        .filter((a) => a.key || (a.keys && Object.keys(a.keys).length > 0))
        .map((a) => a.wxid || ''),
    });
  }
  const bound = readBoundAccount();
  // 挑「当前绑定账号」那条记录,而不是无脑取第一条。
  // 旧写法 readWindowsAccounts()[0] 是这次故障的直接原因:顺序取决于写入先后,
  // 换号后永远命中旧账号,于是"重新检查"点多少次界面都纹丝不动。
  const accounts = platform === 'win32' ? readWindowsAccounts() : [];
  const pathHint = bound
    ? accounts.find((a) => a.wxid?.trim() === bound.wxid)
    : undefined;
  const dataDirHint = platform === 'win32' && 'wxDir' in env.dataDir ? env.dataDir : undefined;
  // #40:切换微信账号/微信升级后旧密钥失效——结构级检测(纯文件系统,轮询可低成本调)。
  // 微信升级(wxid 不变但密钥变)的功能级信号是 session.db 密钥不匹配,由 UI 结合报错文案一起判。
  // 无条件计算:以前只在"存过账号记录"时才算,可没记录恰恰是最需要提示的时候。
  const accountBinding = platform === 'win32' ? getWindowsAccountBinding() : undefined;
  return NextResponse.json({
    supported: true,
    platform,
    env,
    windowsPathConfig: platform === 'win32' ? readWindowsPathConfig() : undefined,
    windowsAccountBinding: accountBinding,
    // 当前绑定账号 + 本机存过数据的账号列表:让界面能直说"现在认的是哪个号",
    // 而不是让用户从一堆路径里自己推断。
    boundAccount: bound,
    mirrorAccounts: listMirrorAccounts(),
    windowsPathHint: pathHint ? {
      path: pathHint.wx_dir,
      wxid: pathHint.wxid,
      wxDir: pathHint.wx_dir,
      msgDir: pathHint.msg_dir,
      messageDbDir: pathHint.message_db_dir,
    } : dataDirHint ? {
      path: dataDirHint.wxDir || dataDirHint.root,
      wxid: dataDirHint.wxid,
      wxDir: dataDirHint.wxDir,
      msgDir: dataDirHint.msgDir,
      messageDbDir: dataDirHint.messageDbDir,
    } : undefined,
    status: { ...status, lastSyncedAt: getLastMirrorSyncAt() },
    consent: {
      version: DISCLAIMER_VERSION,
      effectiveAt: DISCLAIMER_EFFECTIVE_AT,
      summary: DISCLAIMER_SUMMARY,
      body: DISCLAIMER_BODY,
      hash: getDisclaimerHash(),
      hasValidConsent: hasValidConsent(),
      record: getConsent(),
    },
    mcp: {
      installed: !!mcp,
      enabled: !!mcp && mcp.is_enabled === 1,
    },
  });
}
