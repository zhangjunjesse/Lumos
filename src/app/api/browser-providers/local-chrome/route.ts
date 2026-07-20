import { NextRequest, NextResponse } from 'next/server';

import {
  detectLocalChromePath,
  readLocalChromeSettings,
  writeLocalChromeSettings,
  type LocalChromeSettings,
} from '@/lib/browser-provider/local-chrome';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildResponse(settings: LocalChromeSettings) {
  const detectedPath = detectLocalChromePath(settings.chromePath);
  return {
    settings,
    chrome_detected: Boolean(detectedPath),
    chrome_path: detectedPath,
  };
}

export async function GET() {
  try {
    return NextResponse.json(buildResponse(readLocalChromeSettings()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '读取本地 Chrome 设置失败' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<LocalChromeSettings>;
    const current = readLocalChromeSettings();
    const next: LocalChromeSettings = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      profileMode: body.profileMode === 'dedicated' || body.profileMode === 'default'
        ? body.profileMode
        : current.profileMode,
      headless: typeof body.headless === 'boolean' ? body.headless : current.headless,
      chromePath: typeof body.chromePath === 'string' ? body.chromePath : current.chromePath,
    };
    writeLocalChromeSettings(next);
    return NextResponse.json(buildResponse(next));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '保存本地 Chrome 设置失败' },
      { status: 400 },
    );
  }
}
