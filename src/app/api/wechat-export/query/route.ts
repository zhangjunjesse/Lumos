import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { getWeChatExportPlatform, hasRecoveredKey } from '@/lib/wechat-export/setup-state';
import { queryWeChatApi } from '@/lib/wechat-export/api-bridge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  op: z.enum(['list_contacts', 'list_sessions', 'read_chat', 'diagnostics']),
  args: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/wechat-export/query
 *
 * Single endpoint for the panel's chat browser to read contacts and messages.
 * Spawns the vendored api.py per request; api.py handles caching internally
 * (contacts.json is written on first call).
 */
export async function POST(request: NextRequest) {
  if (!getWeChatExportPlatform()) {
    return NextResponse.json({ error: 'unsupported_platform' }, { status: 400 });
  }
  if (!hasValidConsent()) {
    return NextResponse.json({ error: 'consent_required' }, { status: 400 });
  }
  if (!hasRecoveredKey()) {
    return NextResponse.json({ error: 'no_key' }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await queryWeChatApi(parsed.data.op, parsed.data.args || {});
  if (!result.ok) {
    return NextResponse.json({
      error: result.error.code,
      message: result.error.message,
    }, { status: 500 });
  }

  return NextResponse.json(result.data);
}
