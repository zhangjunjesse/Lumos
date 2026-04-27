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
import { getSetupStatus } from '@/lib/wechat-export/setup-state';
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
  if (process.platform !== 'darwin') {
    return NextResponse.json({
      supported: false,
      platform: process.platform,
      message: '微信导出能力目前仅支持 macOS。Windows 支持在路线图上。',
    });
  }
  const env = runEnvProbes();
  const status = getSetupStatus(env.allOk, env.signed);
  const mcp = getMcpServerByNameAndScope('wechat-export', 'builtin');
  return NextResponse.json({
    supported: true,
    platform: 'darwin',
    env,
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
