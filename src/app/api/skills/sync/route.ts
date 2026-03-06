import { NextResponse } from 'next/server';
import { syncSkillsToPlugin } from '@/lib/skills-sync';

export async function POST() {
  try {
    const pluginDir = syncSkillsToPlugin();
    console.log('[Skills] Synced to plugin directory:', pluginDir);
    return NextResponse.json({ success: true, pluginDir });
  } catch (error) {
    console.error('[Skills] Sync failed:', error);
    return NextResponse.json(
      { error: 'Failed to sync skills' },
      { status: 500 }
    );
  }
}
