import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { runEnvProbes } from '@/lib/wechat-export/env-check';
import { hasRecoveredKey, wipeFeatureData } from '@/lib/wechat-export/setup-state';
import {
  getMcpServerByNameAndScope,
  updateMcpServer,
} from '@/lib/db';
import { ensureVenv, installPackage, listPackages } from '@/lib/python-venv';

const REQUIRED_PYPI_PACKAGES = ['mcp[cli]>=1.0.0', 'zstandard>=0.23'];

/**
 * Make sure the lumos-managed Python venv has every package the wechat-export
 * MCP server imports. Idempotent — listPackages tells us what's already there.
 * Errors out only when a real install fails, not when packages are present.
 */
async function ensureVenvPackages(): Promise<{ ok: boolean; error?: string }> {
  try {
    await ensureVenv();
  } catch (err) {
    return { ok: false, error: `venv 创建失败: ${err instanceof Error ? err.message : String(err)}` };
  }
  let installed: string[];
  try {
    installed = await listPackages();
  } catch {
    installed = [];
  }
  const installedNames = new Set(
    installed.map((spec) => spec.split('==')[0].toLowerCase().replace(/\[.*\]$/, '')),
  );
  for (const spec of REQUIRED_PYPI_PACKAGES) {
    const baseName = spec.split('[')[0].split('>=')[0].split('==')[0].toLowerCase();
    if (installedNames.has(baseName)) continue;
    try {
      await installPackage(spec);
    } catch (err) {
      return {
        ok: false,
        error: `安装 ${spec} 失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  return { ok: true };
}

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
  if (process.platform !== 'darwin') {
    return NextResponse.json({ error: 'macOS only' }, { status: 400 });
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
    const env = runEnvProbes();
    if (!env.allOk) {
      return NextResponse.json({ error: 'env_not_ready', detail: env }, { status: 400 });
    }
    if (!hasRecoveredKey()) {
      return NextResponse.json({ error: 'no_key', message: '请先完成密钥提取。' }, { status: 400 });
    }
    const venvResult = await ensureVenvPackages();
    if (!venvResult.ok) {
      return NextResponse.json({
        error: 'venv_install_failed',
        message: venvResult.error,
      }, { status: 500 });
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
