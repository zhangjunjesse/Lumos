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
import { getSetupStatus, getWeChatExportPlatform, readWindowsPathConfig } from '@/lib/wechat-export/setup-state';
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
  return NextResponse.json({
    supported: true,
    platform,
    env,
    windowsPathConfig: platform === 'win32' ? readWindowsPathConfig() : undefined,
    status,
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
