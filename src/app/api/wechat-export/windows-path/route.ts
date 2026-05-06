import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import {
  clearWindowsPathConfig,
  getWeChatExportPlatform,
  readWindowsPathConfig,
  writeWindowsPathConfig,
} from '@/lib/wechat-export/setup-state';
import { resolveWindowsWeChatDataRootSelection } from '@/lib/wechat-export/env-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PathKind = 'wechatExe' | 'dataDir';

function parseKind(value: unknown): PathKind | null {
  return value === 'wechatExe' || value === 'dataDir' ? value : null;
}

function resolveWindowsWechatExe(inputPath: string): string | null {
  const selected = path.resolve(inputPath.trim());
  if (!selected) return null;
  try {
    const stat = fs.statSync(selected);
    if (stat.isFile()) {
      return ['wechat.exe', 'weixin.exe'].includes(path.basename(selected).toLowerCase())
        ? selected
        : null;
    }
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const candidates = [
    path.join(selected, 'WeChat.exe'),
    path.join(selected, 'Weixin.exe'),
    path.join(selected, 'WeChat', 'WeChat.exe'),
    path.join(selected, 'Weixin', 'Weixin.exe'),
    path.join(selected, 'Tencent', 'WeChat', 'WeChat.exe'),
    path.join(selected, 'Tencent', 'Weixin', 'Weixin.exe'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep scanning */ }
  }
  return null;
}

function ensureWindows() {
  if (getWeChatExportPlatform() !== 'win32') {
    return NextResponse.json({
      error: 'unsupported_platform',
      message: '手动指定 Windows 微信路径只在 Windows 版 Lumos 中可用。',
    }, { status: 400 });
  }
  return null;
}

export async function GET() {
  const blocked = ensureWindows();
  if (blocked) return blocked;
  return NextResponse.json({ config: readWindowsPathConfig() });
}

export async function POST(request: Request) {
  const blocked = ensureWindows();
  if (blocked) return blocked;

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const kind = parseKind(body.kind);
  const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
  if (!kind || !rawPath) {
    return NextResponse.json({
      error: 'invalid_request',
      message: '请选择要保存的路径类型和路径。',
    }, { status: 400 });
  }

  if (kind === 'wechatExe') {
    const exePath = resolveWindowsWechatExe(rawPath);
    if (!exePath) {
      return NextResponse.json({
        error: 'invalid_wechat_exe',
        message: '没有找到可用的微信程序。请选择 WeChat.exe / Weixin.exe，或选择包含它们的安装目录。',
      }, { status: 400 });
    }
    const config = writeWindowsPathConfig({ wechatExePath: exePath });
    return NextResponse.json({
      ok: true,
      kind,
      path: exePath,
      config,
      message: `已保存微信程序路径: ${exePath}`,
    });
  }

  const resolved = resolveWindowsWeChatDataRootSelection(rawPath);
  if (!resolved) {
    return NextResponse.json({
      error: 'invalid_wechat_data_dir',
      message: '没有找到微信聊天数据。请选择微信设置里“文件管理”显示的保存目录，或该账号目录 / MSG / db_storage 目录。',
    }, { status: 400 });
  }
  const config = writeWindowsPathConfig({ wechatDataRoot: rawPath });
  return NextResponse.json({
    ok: true,
    kind,
    path: rawPath,
    wxid: resolved.wxid,
    wxDir: resolved.wxDir,
    msgDir: resolved.msgDir,
    messageDbDir: resolved.messageDbDir,
    rootAccount: resolved.wxid,
    config,
    message: `已保存微信数据目录: ${rawPath}`,
  });
}

export async function DELETE(request: Request) {
  const blocked = ensureWindows();
  if (blocked) return blocked;
  const url = new URL(request.url);
  const kind = parseKind(url.searchParams.get('kind'));
  const config = clearWindowsPathConfig(kind || undefined);
  return NextResponse.json({ ok: true, config });
}
