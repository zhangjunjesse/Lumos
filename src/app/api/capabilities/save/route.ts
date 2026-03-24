import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';

interface SaveCapabilityRequest {
  id: string;
  name: string;
  type: 'code' | 'prompt';
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as SaveCapabilityRequest;
    const { id, name, type, content } = body;

    if (!id || !name || !type || !content) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const dataDir = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
    const capabilitiesDir = path.join(dataDir, 'capabilities');

    await mkdir(capabilitiesDir, { recursive: true });

    const ext = type === 'code' ? 'ts' : 'md';
    const filePath = path.join(capabilitiesDir, `${id}.${ext}`);

    await writeFile(filePath, content, 'utf-8');

    return NextResponse.json({
      success: true,
      filePath,
      id,
      name,
      type
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save capability' },
      { status: 500 }
    );
  }
}
