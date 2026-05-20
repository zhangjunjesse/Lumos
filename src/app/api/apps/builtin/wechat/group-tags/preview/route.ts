import { NextRequest, NextResponse } from 'next/server';

import { resolveGroupTag } from '@/lib/wechat-assistant/group-tag-resolver';
import type { GroupTag } from '@/components/apps/builtin/wechat/app-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { tag: GroupTag } → resolve the tag rule to concrete groups now.
 * Read-only; backs the 设置 → 群标签 "当前 N 群 / 展开核对 / 重新计算" UI.
 * Business logic lives in group-tag-resolver; this route only parses/responds.
 */
export async function POST(req: NextRequest) {
  let body: { tag?: GroupTag };
  try {
    body = (await req.json()) as { tag?: GroupTag };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const tag = body?.tag;
  if (!tag || typeof tag !== 'object' || !tag.rule) {
    return NextResponse.json({ error: 'missing_tag' }, { status: 400 });
  }
  try {
    const resolved = await resolveGroupTag(tag);
    return NextResponse.json({ resolved });
  } catch (err) {
    return NextResponse.json(
      { error: 'resolve_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
