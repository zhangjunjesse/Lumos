import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import {
  getWeChatExportPlatform,
  hasRecoveredKey,
  WINDOWS_ACCOUNTS_FILE,
} from '@/lib/wechat-export/setup-state';
import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_PREFIX = path.join(
  process.env.HOME || '/',
  'Library',
  'Containers',
  'com.tencent.xinWeChat',
  'Data',
  'Documents',
  'xwechat_files',
);

function isAllowedWindowsWeChatPath(filePath: string): boolean {
  try {
    if (!fs.existsSync(WINDOWS_ACCOUNTS_FILE)) return false;
    const accounts = JSON.parse(fs.readFileSync(WINDOWS_ACCOUNTS_FILE, 'utf8')) as Array<{ wx_dir?: string }>;
    return accounts.some((account) => {
      if (!account.wx_dir) return false;
      const root = path.resolve(account.wx_dir);
      return filePath === root || filePath.startsWith(root + path.sep);
    });
  } catch {
    return false;
  }
}

function sniffMime(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf.toString('ascii', 0, 6).startsWith('GIF8')) return 'image/gif';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

/**
 * GET /api/wechat-export/image?wxid=X&ts=N
 *
 * Resolves the message → local _M.dat path through api.py, sandboxes the
 * result to the WeChat container, and streams the bytes back. Despite
 * the .dat extension these files are unencrypted PNG/JPEG, so the browser
 * just needs the right Content-Type.
 */
export async function GET(request: NextRequest) {
  const platform = getWeChatExportPlatform();
  if (!platform) {
    return new Response('unsupported_platform', { status: 400 });
  }
  if (!hasValidConsent() || !hasRecoveredKey()) {
    return new Response('not_ready', { status: 403 });
  }

  const url = new URL(request.url);
  const wxid = url.searchParams.get('wxid');
  const ts = url.searchParams.get('ts');
  if (!wxid || !ts || !/^\d+$/.test(ts)) {
    return new Response('bad_params', { status: 400 });
  }

  const result = await queryWeChatApi<{ path?: string; error?: string }>('resolve_image', {
    wxid,
    ts: Number(ts),
  });
  if (!result.ok || !result.data.path) {
    return new Response(result.ok ? (result.data.error || 'not_found') : result.error.message, { status: 404 });
  }

  const filePath = path.resolve(result.data.path);
  const allowed = platform === 'darwin'
    ? filePath.startsWith(ALLOWED_PREFIX)
    : isAllowedWindowsWeChatPath(filePath);
  if (!allowed) {
    return new Response('forbidden', { status: 403 });
  }
  if (!fs.existsSync(filePath)) {
    return new Response('not_found', { status: 404 });
  }

  const buf = fs.readFileSync(filePath);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': sniffMime(buf),
      'Cache-Control': 'private, max-age=86400',
      'Content-Length': String(buf.length),
    },
  });
}
