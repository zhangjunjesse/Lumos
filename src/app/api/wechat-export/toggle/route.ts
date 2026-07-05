import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { runEnvProbes } from '@/lib/wechat-export/env-check';
import { getWeChatExportPlatform, hasRecoveredKey, wipeFeatureData } from '@/lib/wechat-export/setup-state';
import {
  getMcpServerByNameAndScope,
  updateMcpServer,
} from '@/lib/db';
import { ensureWeChatExportPythonEnv } from '@/lib/wechat-export/python-env';
import { verifyWeChatReadable } from '@/lib/wechat-export/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.enum(['enable', 'disable', 'uninstall']),
});

/**
 * POST /api/wechat-export/toggle
 *
 * Single endpoint for the panel's "enable / pause / fully uninstall" button:
 *   - enable: turn the wechat-export MCP `is_enabled = 1` (panel verifies
 *     consent + env + key are all green first via /status)
 *   - disable: flip `is_enabled = 0` but keep the recovered key on disk
 *     (user can re-enable later without re-running the lldb sweep)
 *   - uninstall: disable AND wipe ~/.lumos/wechat-export so no key bytes
 *     linger on the box
 */
export async function POST(request: NextRequest) {
  const platform = getWeChatExportPlatform();
  if (!platform) {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const mcp = getMcpServerByNameAndScope('wechat-export', 'builtin');
  if (!mcp) {
    return NextResponse.json({
      error: 'mcp_not_installed',
      message: '内置 MCP 配置未找到。请重启 lumos 让 init-builtin-resources 重新加载。',
    }, { status: 500 });
  }

  if (parsed.data.action === 'enable') {
    if (!hasValidConsent()) {
      return NextResponse.json({ error: 'consent_required' }, { status: 400 });
    }
    const env = runEnvProbes(platform);
    if (!env.allOk) {
      return NextResponse.json({ error: 'env_not_ready', detail: env }, { status: 400 });
    }
    if (!hasRecoveredKey()) {
      return NextResponse.json({ error: 'no_key', message: '请先完成密钥提取。' }, { status: 400 });
    }
    try {
      await ensureWeChatExportPythonEnv({ includeMcp: true });
    } catch (err) {
      return NextResponse.json({
        error: 'venv_install_failed',
        message: err instanceof Error ? err.message : String(err),
      }, { status: 500 });
    }
    const readiness = await verifyWeChatReadable();
    if (!readiness.ok) {
      return NextResponse.json({
        error: 'wechat_unreadable',
        message: readiness.message,
        diagnostics: readiness.diagnostics,
      }, { status: 400 });
    }
    updateMcpServer(mcp.id, { is_enabled: true });
    return NextResponse.json({ success: true, enabled: true });
  }

  if (parsed.data.action === 'disable') {
    updateMcpServer(mcp.id, { is_enabled: false });
    return NextResponse.json({ success: true, enabled: false });
  }

  // uninstall
  updateMcpServer(mcp.id, { is_enabled: false });
  wipeFeatureData();
  return NextResponse.json({ success: true, enabled: false, wiped: true });
}
