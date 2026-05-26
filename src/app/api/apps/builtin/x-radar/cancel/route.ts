import { NextResponse } from 'next/server';

import { markRunCancelled } from '@/lib/app/runtime/run-control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/apps/builtin/x-radar/cancel — 取消当前正在跑的 patrol。
 *
 * x-radar 不像 etsy/pinterest 是 per-run 模型, 它是"patrol 全队列"模式
 * (一次循环跑所有 enabled task), 所以用固定 key 'patrol' 表示"当前那次 patrol"。
 * patrol.ts 的 runQueue 在每条 task 顶部 check isRunCancelled, true 就 break。
 *
 * 不会停掉 in-flight 的 X API 请求(没传 AbortSignal 给 fetch),
 * 但会让队列里**剩下**的 task 不再消耗 X 配额——这是最常用的"我不想继续跑了"语义。
 */
export async function POST() {
  markRunCancelled('x-radar', 'patrol');
  return NextResponse.json({ ok: true, message: '已请求取消当前巡逻，剩余任务不会再跑。' });
}
