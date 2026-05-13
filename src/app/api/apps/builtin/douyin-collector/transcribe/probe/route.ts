import { NextResponse } from 'next/server';

import {
  synthesizeSpeechAttachment,
  transcribeAudioAttachment,
  SpeechProviderNotConfiguredError,
} from '@/lib/im/core/speech';
import { getActiveWebSessionToken } from '@/lib/auth/user-service';
import { resolveCloudSpeechProvider } from '@/lib/im/core/asr-adapters/cloud-speech';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PROBE_TEXT = '抖音采集器 ASR 链路测试。';

/**
 * End-to-end probe of the douyin transcribe → cloud-speech → volcengine
 * pipeline. Synthesizes a short Chinese utterance via the OS TTS, runs it
 * through the same code path real videos take, and returns a structured
 * report pinpointing which step (auth / upload / nginx / asr) failed.
 *
 * Designed as the single button users press after configuring the speech
 * provider — surfaces all four classes of failure we hit in iteration:
 * stale session, bad response shape, mis-typed resource_id, nginx body cap.
 */
export async function POST(): Promise<NextResponse> {
  // 1. Local pre-flight: cloud session + speech provider override.
  if (!getActiveWebSessionToken()) {
    return NextResponse.json({
      ok: false,
      step: 'auth',
      reason: '未登录 Lumos 云账户。请到「设置 → Lumos 云账户」登录后重试。',
    });
  }
  const provider = await resolveCloudSpeechProvider();
  if (!provider) {
    return NextResponse.json({
      ok: false,
      step: 'provider',
      reason: '未在「设置 → 服务商 → 语音」选定语音服务商。',
    });
  }

  // 2. Synthesize a tiny audio sample through the OS TTS.
  const tts = await synthesizeSpeechAttachment(PROBE_TEXT);
  if (!tts.ok || !tts.attachment) {
    return NextResponse.json({
      ok: false,
      step: 'tts',
      reason: `本机 TTS 合成失败：${tts.error ?? '未知错误'}（macOS 应有 /usr/bin/say；Linux 需装 espeak）。`,
    });
  }

  // 3. Run the real cloud ASR pipeline.
  try {
    const result = await transcribeAudioAttachment(tts.attachment);
    return NextResponse.json({
      ok: true,
      step: 'done',
      provider: result.provider,
      bytes: tts.attachment.size,
      duration_seconds: result.duration_seconds ?? null,
      charged_amount: result.charged_amount ?? null,
      transcript: result.text,
      empty: result.empty,
    });
  } catch (err) {
    if (err instanceof SpeechProviderNotConfiguredError) {
      return NextResponse.json({ ok: false, step: 'provider', reason: err.message });
    }
    const message = err instanceof Error ? err.message : String(err);
    // Classify by message keywords so the UI can render targeted guidance.
    let step: 'auth' | 'upload' | 'asr' | 'unknown' = 'unknown';
    if (/AUTH_EXPIRED|会话已过期|会话过期|unauthorized|401/i.test(message)) step = 'auth';
    else if (/413|client_max_body_size|临时音频上传失败/.test(message)) step = 'upload';
    else if (/resource not granted|VOLC_|余额|insufficient/i.test(message)) step = 'asr';
    return NextResponse.json({ ok: false, step, reason: message });
  }
}
