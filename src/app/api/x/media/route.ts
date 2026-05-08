import { NextRequest, NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';
import { uploadImage } from '@/lib/x-platform/media';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/x/media
 *
 * multipart/form-data: file=<binary>。返回 { mediaId } 给前端塞到 postTweet。
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, message: 'invalid multipart' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: 'file is required' }, { status: 400 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const mediaId = await uploadImage({
      data: buffer,
      mimeType: file.type || 'image/jpeg',
      filename: file.name,
    });
    return NextResponse.json({ ok: true, mediaId });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
