import { NextRequest, NextResponse } from 'next/server';
import { handlePaymentNotify } from '@/lib/payment/order-service';

/**
 * GET /api/payment/return  -- zpay browser redirect after payment
 * Verifies callback params then redirects to settings page.
 */
export async function GET(req: NextRequest) {
  const baseUrl = req.nextUrl.origin;

  try {
    const params: Record<string, string> = {};
    req.nextUrl.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const result = await handlePaymentNotify(params);
    const status = result === 'success' ? 'success' : 'failed';
    return NextResponse.redirect(`${baseUrl}/settings?payment=${status}`);
  } catch {
    return NextResponse.redirect(`${baseUrl}/settings?payment=failed`);
  }
}
