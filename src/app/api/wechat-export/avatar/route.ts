import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { dataDir } from '@/lib/db';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { hasRecoveredKey } from '@/lib/wechat-export/setup-state';
import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AVATAR_DIR = path.join(dataDir, 'wechat-export', 'avatars');

function sniffMime(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return 'application/octet-stream';
}

/**
 * GET /api/wechat-export/avatar?wxid=X
 *
 * Cache-first: read the per-wxid file in ~/.lumos/wechat-export/avatars.
 * On miss, ask api.py to extract bytes from head_image.db and try again.
 */
export async function GET(request: NextRequest) {
  if (process.platform !== 'darwin') return new Response('macOS only', { status: 400 });
  if (!hasValidConsent() || !hasRecoveredKey()) return new Response('not_ready', { status: 403 });

  const url = new URL(request.url);
  const wxid = url.searchParams.get('wxid');
  if (!wxid || !/^[\w@.\-]+$/.test(wxid)) {
    return new Response('bad_params', { status: 400 });
  }

  const safeName = wxid.replace(/[\\/]/g, '_');
  let cachedPath = path.join(AVATAR_DIR, `${safeName}.bin`);

  if (!fs.existsSync(cachedPath)) {
    const result = await queryWeChatApi<{ path?: string; error?: string }>('avatar', { wxid });
    if (!result.ok || !result.data.path) {
      return new Response('no_avatar', { status: 404 });
    }
    cachedPath = path.resolve(result.data.path);
    if (!cachedPath.startsWith(AVATAR_DIR)) {
      return new Response('forbidden', { status: 403 });
    }
  }

  if (!fs.existsSync(cachedPath)) return new Response('not_found', { status: 404 });

  const buf = fs.readFileSync(cachedPath);
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': sniffMime(buf),
      'Cache-Control': 'private, max-age=86400',
      'Content-Length': String(buf.length),
    },
  });
}
