import { NextRequest, NextResponse } from 'next/server';

import { getEcommerceStore } from '@/lib/ecommerce-assistant/storage';
import { getBrowserFetchSettings } from '@/lib/ecommerce-assistant/discover-settings';
import { collectProductReviews } from '@/lib/ecommerce-assistant/ehunt/collect';
import { analyzeReviews } from '@/lib/ecommerce-assistant/ehunt/review-analyze';
import { createReviewIntelCache } from '@/lib/ecommerce-assistant/ehunt/review-cache';
import type { EtsyReviewBundle } from '@/lib/ecommerce-assistant/ehunt/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * EHunt 评论 on-demand 路由：仅由用户在 UI 显式触发（默认不自动跑，符合文档需求）。
 * - collect-reviews: 采集单商品全量原始评论（独立于 EHunt，需浏览器上下文已登录 Etsy）。
 * - analyze-reviews: 对已采集的 bundle 做 LLM 分析（带 AppDataStore 缓存，评论未变命中不重复调用）。
 * 业务逻辑在 lib/，本层只解析参数与回包。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { action?: string; listingUrl?: string; bundle?: EtsyReviewBundle }
      | null;
    const action = body?.action;

    if (action === 'collect-reviews') {
      const listingUrl = body?.listingUrl?.trim();
      if (!listingUrl) {
        return NextResponse.json({ error: 'listingUrl 必填' }, { status: 400 });
      }
      const { browserContextId } = getBrowserFetchSettings(getEcommerceStore());
      const bundle = await collectProductReviews(listingUrl, browserContextId);
      return NextResponse.json({ bundle });
    }

    if (action === 'analyze-reviews') {
      const bundle = body?.bundle;
      if (!bundle || typeof bundle !== 'object' || !bundle.listingId) {
        return NextResponse.json({ error: 'bundle 必填（先 collect-reviews）' }, { status: 400 });
      }
      const cache = createReviewIntelCache(getEcommerceStore());
      const intel = await analyzeReviews(bundle, { cache });
      // intel=null 不是错误：LLM 未配置 / 评论为空 → UI 据此提示，不伪装成功。
      return NextResponse.json({
        intel,
        reason: intel ? null : '未生成分析：评论为空或未配置可用模型',
      });
    }

    return NextResponse.json(
      { error: `未知 action: ${action ?? '(空)'}（collect-reviews | analyze-reviews）` },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
