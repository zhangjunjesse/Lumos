// 产品开发「图片」裁剪落盘:POST {dataUrl} → 把前端 canvas 裁好的图(base64)写进 .lumos-media,返回 serve URL。
// 裁剪像素由前端 canvas 完成(零依赖);后端只解码落盘。原图不动,新图由前端追加进图库。

import { NextRequest, NextResponse } from 'next/server';
import { saveBase64Images } from '@/lib/image/persist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { dataUrl?: string };
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/.exec(body.dataUrl ?? '');
    if (!m) return NextResponse.json({ error: 'dataUrl 无效' }, { status: 400 });
    const [, mimeType, base64] = m;
    if (base64.length > 8_000_000) {
      return NextResponse.json({ error: '裁剪图过大,请缩小原图后再裁剪' }, { status: 413 });
    }
    const [saved] = saveBase64Images([{ base64, mimeType }]);
    if (!saved) return NextResponse.json({ error: '保存失败' }, { status: 500 });
    return NextResponse.json({ ok: true, src: `/api/media/serve?path=${encodeURIComponent(saved.localPath)}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
