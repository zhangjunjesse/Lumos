import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  DISCLAIMER_VERSION,
  getDisclaimerHash,
  recordConsent,
  revokeConsent,
} from '@/lib/wechat-export/disclaimer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const acceptSchema = z.object({
  action: z.literal('accept'),
  /** Must match the version + hash returned by GET /status to prevent
   *  stale consents (user clicked OK on a UI that loaded before we
   *  shipped a new disclaimer body). */
  acknowledgedVersion: z.string(),
  acknowledgedHash: z.string(),
  acceptedRiskBox: z.literal(true),
  acceptedScopeBox: z.literal(true),
});

const revokeSchema = z.object({ action: z.literal('revoke') });

const schema = z.discriminatedUnion('action', [acceptSchema, revokeSchema]);

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', detail: parsed.error.format() },
      { status: 400 },
    );
  }

  if (parsed.data.action === 'revoke') {
    revokeConsent();
    return NextResponse.json({ success: true });
  }

  if (parsed.data.acknowledgedVersion !== DISCLAIMER_VERSION
      || parsed.data.acknowledgedHash !== getDisclaimerHash()) {
    return NextResponse.json({
      error: 'disclaimer_version_mismatch',
      message: '免责声明已经更新,请刷新页面重新阅读最新版本。',
    }, { status: 409 });
  }

  const record = recordConsent();
  return NextResponse.json({ success: true, record });
}
