import { NextRequest, NextResponse } from 'next/server';
import { getMindUserHistory, getMindUserProfile, saveMindUserProfile } from '@/lib/mind/user-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      profile: getMindUserProfile(),
      history: getMindUserHistory(30),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read user profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const profile = body?.profile || {};
    const source = typeof body?.source === 'string' ? body.source : 'manual';
    const saved = saveMindUserProfile(profile, source);
    return NextResponse.json({
      success: true,
      profile: saved,
      history: getMindUserHistory(30),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save user profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
