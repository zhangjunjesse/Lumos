import { NextResponse } from 'next/server';
import { resolveBillingTarget } from '@/lib/tools/image-gen-billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET: 查当前云端图片服务商 + 模型 + 计费连通性。
 * 真实剩余配额需要从 lumos-web /api/quota/image/balance 拉（MVP 待接入）；
 * 这里先返回 provider 和 model 元数据，UI 可以据此显示「需联系管理员」/「已连接」。
 */
export async function GET() {
  try {
    const target = resolveBillingTarget();
    if ('error' in target) {
      return NextResponse.json({
        ok: false,
        connected: false,
        reason: target.error,
      });
    }
    return NextResponse.json({
      ok: true,
      connected: true,
      provider: target.provider.name,
      model: target.model,
      remoteProviderId: target.remoteProviderId,
      remaining_quota: null,
      remaining_quota_status: 'not_implemented',
      remaining_quota_reason:
        '剩余配额查询接入 lumos-web /api/quota/image/balance — MVP 阶段尚未接入，UI 显示「请到 Lumos 网页端 → 个人中心查看」即可。',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
