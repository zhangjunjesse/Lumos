import { NextRequest, NextResponse } from 'next/server';
import { getUserBySession } from '@/lib/auth/user-service';
import { createOrder } from '@/lib/payment/order-service';

/**
 * POST /api/payment/create  -- Create payment order (requires login)
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('lumos_session')?.value;
    if (!token) {
      return NextResponse.json(
        { success: false, message: '请先登录' },
        { status: 401 },
      );
    }

    const user = await getUserBySession(token);
    if (!user) {
      return NextResponse.json(
        { success: false, message: '会话已过期，请重新登录' },
        { status: 401 },
      );
    }

    const { planId, payType } = await req.json();
    if (!planId || !payType) {
      return NextResponse.json(
        { success: false, message: '缺少支付参数' },
        { status: 400 },
      );
    }

    const order = await createOrder(user.id, planId, payType);
    return NextResponse.json({ success: true, data: order });
  } catch (err) {
    const message = err instanceof Error ? err.message : '创建订单失败';
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
