import fs from 'fs/promises';
import path from 'path';
import { type NextRequest, NextResponse } from 'next/server';

import { transcribeAudioAttachment, SpeechProviderNotConfiguredError } from '@/lib/im/core/speech';
import { assertSafePath } from '@/lib/office/path-guard';
import type { IMFileAttachment } from '@/lib/im/core/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

interface TranscribeBody {
  action?: string;
  file_path?: string;
  base64?: string;
  mime_type?: string;
  name?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: TranscribeBody;
  try {
    body = (await req.json()) as TranscribeBody;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  try {
    const attachment = await loadAttachment(body);
    const result = await transcribeAudioAttachment(attachment);
    return NextResponse.json({
      ok: true,
      text: result.text,
      empty: result.empty,
      duration_seconds: result.duration_seconds,
      charged_amount: result.charged_amount,
      provider: result.provider,
      request_id: result.request_id,
      bytes: attachment.size,
      name: attachment.name,
      mime_type: attachment.type,
    });
  } catch (err) {
    if (err instanceof SpeechProviderNotConfiguredError) {
      return NextResponse.json(
        {
          ok: false,
          code: 'SPEECH_PROVIDER_NOT_CONFIGURED',
          message: err.message,
          settings_url: '/settings#speech',
        },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

async function loadAttachment(body: TranscribeBody): Promise<IMFileAttachment> {
  if (body.file_path) {
    const abs = path.resolve(body.file_path);
    assertSafePath(abs);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new Error('file_path is not a regular file');
    return {
      id: `transcribe-${Date.now()}`,
      name: body.name?.trim() || path.basename(abs),
      type: body.mime_type?.trim() || guessMimeFromExt(abs),
      size: stat.size,
      data: '',
      filePath: abs,
    };
  }

  if (body.base64) {
    const bytes = Buffer.from(body.base64, 'base64');
    if (bytes.length === 0) throw new Error('base64 decoded to 0 bytes');
    return {
      id: `transcribe-${Date.now()}`,
      name: body.name?.trim() || 'voice.bin',
      type: body.mime_type?.trim() || 'application/octet-stream',
      size: bytes.length,
      data: body.base64,
    };
  }

  throw new Error('either file_path or base64 is required');
}

function guessMimeFromExt(p: string): string {
  const ext = path.extname(p).toLowerCase().replace(/^\./, '');
  switch (ext) {
    case 'wav': return 'audio/wav';
    case 'mp3': return 'audio/mpeg';
    case 'm4a': return 'audio/mp4';
    case 'ogg': return 'audio/ogg';
    case 'aac': return 'audio/aac';
    case 'flac': return 'audio/flac';
    case 'amr': return 'audio/amr';
    case 'silk': return 'audio/silk';
    case 'opus': return 'audio/opus';
    case 'webm': return 'audio/webm';
    case 'weba': return 'audio/webm';
    default: return 'application/octet-stream';
  }
}
