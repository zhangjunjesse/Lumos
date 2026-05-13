#!/usr/bin/env tsx
/**
 * Mirror of the /api/apps/builtin/douyin-collector/transcribe/probe route
 * logic, runnable without spinning up Next.js. Useful CI smoke check.
 */
async function main() {
  const speech = await import('../src/lib/im/core/speech.ts');
  const auth = await import('../src/lib/auth/user-service.ts');
  const cs = await import('../src/lib/im/core/asr-adapters/cloud-speech.ts');

  if (!auth.getActiveWebSessionToken()) { console.log({ ok: false, step: 'auth' }); return; }
  const provider = await cs.resolveCloudSpeechProvider();
  if (!provider) { console.log({ ok: false, step: 'provider' }); return; }

  const tts = await speech.synthesizeSpeechAttachment('抖音采集器 ASR 链路测试。');
  if (!tts.ok || !tts.attachment) { console.log({ ok: false, step: 'tts', reason: tts.error }); return; }
  console.log('tts attachment:', tts.attachment.size, 'bytes,', tts.attachment.type);

  try {
    const result = await speech.transcribeAudioAttachment(tts.attachment);
    console.log({
      ok: true,
      step: 'done',
      provider: result.provider,
      bytes: tts.attachment.size,
      duration_seconds: result.duration_seconds,
      charged_amount: result.charged_amount,
      transcript: result.text,
      empty: result.empty,
    });
  } catch (err) {
    console.log({ ok: false, step: 'asr-or-upload', reason: err instanceof Error ? err.message : String(err) });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
