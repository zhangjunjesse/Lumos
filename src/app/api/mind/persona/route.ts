import { NextRequest, NextResponse } from 'next/server';
import { getMindPersonaHistory, getMindPersonaProfile, saveMindPersonaProfile } from '@/lib/mind/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      profile: getMindPersonaProfile(),
      history: getMindPersonaHistory(30),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read persona profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = body?.profile || {};
    const source = typeof body?.source === 'string' ? body.source : 'manual';
    const saved = saveMindPersonaProfile(profile, source);
    return NextResponse.json({
      success: true,
      profile: saved,
      history: getMindPersonaHistory(30),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save persona profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
