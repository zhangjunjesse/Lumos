import { NextRequest } from 'next/server';
import { handlePaymentNotify } from '@/lib/payment/order-service';

/**
 * GET /api/payment/notify  -- zpay async callback (server-to-server)
 * Returns plain text "success" or "fail" per zpay protocol.
 */
export async function GET(req: NextRequest) {
  try {
    const params: Record<string, string> = {};
    req.nextUrl.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const result = await handlePaymentNotify(params);
    return new Response(result, {
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch {
    return new Response('fail', {
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
