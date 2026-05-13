#!/usr/bin/env tsx
/**
 * Direct end-to-end ASR test: feeds an audio file (default: /tmp/dy_video.mp4)
 * to transcribeAudioAttachment, the same code path /api/speech/transcribe runs
 * in the Next.js server, but without spinning up the HTTP layer.
 *
 * Validates: speech provider resolution, lumos cloud session, audio temp upload,
 * volcengine ASR proxy, response shape.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

async function main() {
  const filePath = process.argv[2] ?? '/tmp/dy_video.mp4';
  const stat = await fs.stat(filePath);
  console.log(`audio file: ${filePath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === '.mp3' ? 'audio/mpeg'
    : ext === '.mp4' ? 'video/mp4'
    : ext === '.wav' ? 'audio/wav'
    : 'application/octet-stream';

  const { transcribeAudioAttachment } = await import('../src/lib/im/core/speech.ts');

  const t0 = Date.now();
  try {
    const result = await transcribeAudioAttachment({
      id: `dy-test-${Date.now()}`,
      name: path.basename(filePath),
      type: mime,
      size: stat.size,
      data: '',
      filePath,
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n=== ASR result (took ${dt}s) ===`);
    console.log(`provider:  ${result.provider}`);
    console.log(`empty:     ${result.empty}`);
    console.log(`duration:  ${result.duration_seconds ?? 'n/a'}s`);
    console.log(`charged:   ${result.charged_amount ?? 'n/a'}`);
    console.log(`text len:  ${result.text.length} chars`);
    console.log(`\n=== text (first 500 chars) ===`);
    console.log(result.text.slice(0, 500));
  } catch (err) {
    console.error('ASR FAILED:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
