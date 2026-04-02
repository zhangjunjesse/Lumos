import fs from 'fs';
import path from 'path';
import os from 'os';
import { NextRequest, NextResponse } from 'next/server';
import { getAgentPreset, updateAgentPreset } from '@/lib/db/agent-presets';
import { generateSingleImage } from '@/lib/image-generator';
import { resolveProviderForCapability } from '@/lib/provider-resolver';

const dataDir = process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
const AVATAR_DIR = path.join(dataDir, 'team-avatars');

interface RouteContext {
  params: Promise<{ id: string }>;
}

function avatarFilePath(id: string): string {
  return path.join(AVATAR_DIR, `${id}.jpg`);
}

/** GET: serve avatar file, or ?check=1 for capability info */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);

  if (url.searchParams.get('check') === '1') {
    const preset = getAgentPreset(id);
    const hasAvatar = Boolean(preset?.avatarPath) && fs.existsSync(avatarFilePath(id));
    let canGenerate = false;
    try {
      const p = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: true });
      canGenerate = Boolean(p);
    } catch { /* no image provider */ }
    return NextResponse.json({ hasAvatar, canGenerate });
  }

  const filePath = avatarFilePath(id);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'No avatar' }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-cache',
    },
  });
}

/** POST: upload (multipart) or generate (JSON {action:'generate'}) */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const preset = getAgentPreset(id);
  if (!preset) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.promises.mkdir(AVATAR_DIR, { recursive: true });
    await fs.promises.writeFile(avatarFilePath(id), buffer);
    updateAgentPreset(id, { avatarPath: `${id}.jpg` });
    return NextResponse.json({ success: true, avatarPath: `${id}.jpg` });
  }

  // JSON: generate
  const body = await request.json() as { action?: string; prompt?: string };
  if (body.action !== 'generate') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const name = preset.name;
  const position = preset.position || '';
  const defaultPrompt = `Professional portrait avatar, flat cartoon illustration style. Person named "${name}"${position ? `, role: ${position}` : ''}. Friendly expression, solid background, clean minimalist design, square format.`;
  const prompt = body.prompt?.trim() || defaultPrompt;

  try {
    // imageSize '2K' = 2048×2048, satisfies Volcengine Seedream's 3686400px minimum
    const result = await generateSingleImage({ prompt, aspectRatio: '1:1', imageSize: '2K' });
    if (!result.images.length) {
      return NextResponse.json({ error: '图片生成未返回结果' }, { status: 500 });
    }
    const srcPath = result.images[0].localPath;
    await fs.promises.mkdir(AVATAR_DIR, { recursive: true });
    await fs.promises.copyFile(srcPath, avatarFilePath(id));
    updateAgentPreset(id, { avatarPath: `${id}.jpg` });
    return NextResponse.json({ success: true, avatarPath: `${id}.jpg` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '生成失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE: remove avatar */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const filePath = avatarFilePath(id);
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
  }
  updateAgentPreset(id, { avatarPath: undefined });
  return NextResponse.json({ success: true });
}
