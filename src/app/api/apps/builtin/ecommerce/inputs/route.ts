import { NextRequest, NextResponse } from 'next/server';

import {
  getEcommerceStore,
  listInputs,
  ensureBuiltinStylePresets,
} from '@/lib/ecommerce-assistant/storage';
import { persistUploadedImage } from '@/lib/ecommerce-assistant/upload';
import type { ProductInputRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const items = listInputs(store);
    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.startsWith('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Content-Type 必须是 multipart/form-data。' },
        { status: 400 },
      );
    }
    const form = await req.formData();
    const title = String(form.get('title') ?? '').trim();
    if (!title) {
      return NextResponse.json({ error: '商品标题不能为空。' }, { status: 400 });
    }
    const categoryHint = String(form.get('category_hint') ?? '').trim() || null;
    const note = String(form.get('note') ?? '').trim() || null;

    const mainImage = form.get('main_image');
    if (!(mainImage instanceof File) || !mainImage.size) {
      return NextResponse.json({ error: '必须上传商品主图。' }, { status: 400 });
    }
    const persistedMain = await persistUploadedImage(mainImage);

    const referenceImagePaths: string[] = [];
    const refs = form.getAll('reference_images');
    for (const ref of refs) {
      if (!(ref instanceof File) || !ref.size) continue;
      const persisted = await persistUploadedImage(ref);
      referenceImagePaths.push(persisted.absolutePath);
      if (referenceImagePaths.length >= 4) break;
    }

    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const now = new Date().toISOString();
    const created = store.create<ProductInputRecord>('product_inputs', {
      title,
      category_hint: categoryHint,
      main_image_path: persistedMain.absolutePath,
      reference_image_paths:
        referenceImagePaths.length > 0 ? JSON.stringify(referenceImagePaths) : null,
      note,
      status: 'ready',
      created_at: now,
      updated_at: now,
    });
    return NextResponse.json({ input: created });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

function errorResponse(err: unknown, fallbackStatus: number): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: fallbackStatus });
}
