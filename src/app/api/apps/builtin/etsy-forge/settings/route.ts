// /api/apps/builtin/etsy-forge/settings
// GET: 读应用设置（浏览器上下文 + AI 标注开关）
// PUT: 更新（browser_context_id 趋势抓取接通后才生效）

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import { COLLECTIONS } from '@/lib/etsy-forge/types';
import { listAnalysisProviderOptions, isChatProviderLocked } from '@/lib/etsy-forge/provider-options';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BROWSER_CONTEXT = 'embedded:default';

export async function GET() {
  try {
    const store = getEtsyForgeStore();
    const row = store.query<{
      browser_context_id?: string;
      auto_tag_ai_generated?: boolean;
      ai_provider_id?: string;
      ai_model?: string;
      vision_provider_id?: string;
      vision_model?: string;
      image_concurrency?: number;
      max_pose?: number;
    }>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
    return NextResponse.json({
      browser_context_id: row?.browser_context_id ?? DEFAULT_BROWSER_CONTEXT,
      auto_tag_ai_generated: row?.auto_tag_ai_generated ?? true,
      ai_provider_id: row?.ai_provider_id ?? '',
      ai_model: row?.ai_model ?? '',
      vision_provider_id: row?.vision_provider_id ?? '',
      vision_model: row?.vision_model ?? '',
      image_concurrency: typeof row?.image_concurrency === 'number' ? row.image_concurrency : 5,
      max_pose: typeof row?.max_pose === 'number' ? row.max_pose : 3,
      // 服务端筛好的「可做评论分析/识图」服务商（已脱敏）；锁定时只含 system origin。识图复用同一池子。
      ai_providers: listAnalysisProviderOptions(),
      // 后台是否锁定了自定义服务商（锁定时只能用 Lumos 托管服务商，前端据此调提示文案）。
      ai_locked: isChatProviderLocked(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      browser_context_id?: string;
      auto_tag_ai_generated?: boolean;
      ai_provider_id?: string;
      ai_model?: string;
      vision_provider_id?: string;
      vision_model?: string;
      image_concurrency?: number;
      max_pose?: number;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.browser_context_id === 'string') patch.browser_context_id = body.browser_context_id;
    if (typeof body.auto_tag_ai_generated === 'boolean') patch.auto_tag_ai_generated = body.auto_tag_ai_generated;
    if (typeof body.ai_provider_id === 'string') patch.ai_provider_id = body.ai_provider_id.trim();
    if (typeof body.ai_model === 'string') patch.ai_model = body.ai_model.trim();
    if (typeof body.vision_provider_id === 'string') patch.vision_provider_id = body.vision_provider_id.trim();
    if (typeof body.vision_model === 'string') patch.vision_model = body.vision_model.trim();
    if (typeof body.image_concurrency === 'number' && Number.isFinite(body.image_concurrency)) {
      patch.image_concurrency = Math.max(1, Math.min(20, Math.floor(body.image_concurrency)));
    }
    if (typeof body.max_pose === 'number' && Number.isFinite(body.max_pose)) {
      patch.max_pose = Math.max(1, Math.min(20, Math.floor(body.max_pose)));
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    }

    const store = getEtsyForgeStore();
    const row = store.query<{ id: string }>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
    if (row) {
      store.update(COLLECTIONS.APP_SETTINGS, row.id, patch);
    } else {
      store.create(COLLECTIONS.APP_SETTINGS, patch);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
