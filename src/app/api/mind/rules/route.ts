import { NextRequest, NextResponse } from 'next/server';
import { getMindRulesHistory, getMindRulesProfile, saveMindRulesProfile } from '@/lib/mind/rules-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      profile: getMindRulesProfile(),
      history: getMindRulesHistory(30),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read rules profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = body?.profile || {};
    const source = typeof body?.source === 'string' ? body.source : 'manual';
    const saved = saveMindRulesProfile(profile, source);
    return NextResponse.json({
      success: true,
      profile: saved,
      history: getMindRulesHistory(30),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save rules profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
