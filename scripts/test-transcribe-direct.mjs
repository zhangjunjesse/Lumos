#!/usr/bin/env tsx
// Direct (out-of-server) call to transcribeVideoFromNative on the
// existing video row. Verifies whether the ffmpeg fallback works
// regardless of dev-server PATH.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

async function probeFfmpeg() {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    p.on('error', (err) => resolve({ ok: false, err: err.message }));
    p.on('exit', (code) => resolve({ ok: code === 0, exit: code }));
  });
}

async function main() {
  console.log('PATH:', process.env.PATH?.slice(0, 200));
  console.log('ffmpeg probe:', await probeFfmpeg());
  console.log('---');
  const id = process.argv[2] ?? '8SyERH14kN4prd9y';
  const { transcribeVideoFromNative } = await import(
    '../src/lib/douyin-collector/transcribe.ts'
  );
  console.log('transcribing video', id);
  const r = await transcribeVideoFromNative(id);
  console.log(JSON.stringify(r, null, 2));
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
