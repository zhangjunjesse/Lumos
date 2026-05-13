#!/usr/bin/env tsx
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const mp4 = process.argv[2] ?? '/tmp/dy_video.mp4';
const out = path.join(os.tmpdir(), `extract-test-${Date.now()}.mp3`);
console.log('extracting:', mp4, '->', out);

await new Promise((resolve, reject) => {
  const proc = spawn(
    'ffmpeg',
    ['-y', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', out],
    { stdio: 'inherit' },
  );
  proc.on('error', (err) => reject(err));
  proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
});

const stat = await fs.stat(out);
console.log('OUTPUT SIZE:', stat.size, 'bytes ≈', (stat.size / 1024 / 1024).toFixed(2), 'MB');
await fs.unlink(out);
