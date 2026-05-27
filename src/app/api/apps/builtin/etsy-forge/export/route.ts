import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ImageRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST: 导出选中的图。
 * - target='download': 返回 image file paths（前端用浏览器逐个下载，MVP 阶段；
 *   后续可加 zip 流式打包，需引入 archiver/jszip）
 * - target='printful': MVP 显式 not-implemented；需要 Printful OAuth 接入
 *
 * 所有导出图都按 Etsy 2024 新规标记 AI-generated（auto_tag_ai_generated 设置控制）。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { image_ids?: string[]; target?: 'download' | 'printful' };
    if (!Array.isArray(body.image_ids) || body.image_ids.length === 0) {
      return NextResponse.json({ error: 'image_ids[] required' }, { status: 400 });
    }
    const target = body.target ?? 'download';

    const store = getEtsyForgeStore();
    const rows = body.image_ids
      .map((id) => store.get<ImageRow>(COLLECTIONS.IMAGES, id))
      .filter((r): r is ImageRow & { id: string } => r !== null);

    if (target === 'printful') {
      return NextResponse.json({
        ok: false,
        notImplemented: true,
        reason:
          'Printful 一键传 MVP 阶段尚未接入 — 需要 Printful OAuth 授权 + product create API 集成。请先用下载功能。',
        image_count: rows.length,
      });
    }

    // download：列出可下载文件元数据
    const items = rows.map((r) => {
      const exists = fs.existsSync(r.file_path);
      return {
        id: r.id,
        url: `/api/media/serve?path=${encodeURIComponent(r.file_path)}`,
        filename: path.basename(r.file_path),
        theme: r.theme,
        style: r.style,
        source_type: r.source_type,
        ai_generated_tag: r.ai_generated_tag,
        exists,
      };
    });

    return NextResponse.json({
      ok: true,
      target: 'download',
      count: items.length,
      items,
      note: 'Etsy 2024 新规要求 AI 生成商品在 listing 中标注；本应用导出图 metadata 已带 ai_generated=true 标识，上架时请在 Etsy listing 表单勾选「AI-generated」。',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
