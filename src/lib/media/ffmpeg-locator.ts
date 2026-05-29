/**
 * Shared ffmpeg / ffprobe binary locator.
 *
 * Lumos can't assume a system ffmpeg exists: Electron production builds
 * inherit a sparse PATH (only zsh function dirs on macOS), and Windows users
 * typically have no ffmpeg installed at all — which is why douyin ASR and the
 * IM voice pipeline silently lost their audio path. Discovery walks, in order:
 *
 *   1. explicit env override (LUMOS_FFMPEG_PATH / LUMOS_FFPROBE_PATH)
 *   2. bundled binary under resources/ffmpeg/<platform>/<arch>/ — shipped by
 *      scripts/download-ffmpeg.mjs at build time and resolved through the same
 *      runtime-resources roots as node-runtime / git-bash. This is the path
 *      that makes a packaged app work with zero user setup.
 *   3. system PATH
 *   4. common per-platform install locations (Homebrew / conda / Windows)
 *
 * Both douyin-collector/transcribe.ts and im/core/speech.ts use this; they
 * previously each carried their own copy-pasted, macOS/Linux-only finder.
 *
 * Result is cached per binary for the process lifetime.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources';

export type MediaBinary = 'ffmpeg' | 'ffprobe';

const cache = new Map<MediaBinary, string | null>();

function exeName(binary: MediaBinary): string {
  return process.platform === 'win32' ? `${binary}.exe` : binary;
}

function envOverride(binary: MediaBinary): string | undefined {
  const key = binary === 'ffmpeg' ? 'LUMOS_FFMPEG_PATH' : 'LUMOS_FFPROBE_PATH';
  return process.env[key]?.trim() || undefined;
}

/** Binary bundled by download-ffmpeg.mjs and shipped via extraResources. */
function bundledPath(binary: MediaBinary): string | null {
  return resolveRuntimeResourcePath(
    path.join('ffmpeg', process.platform, process.arch, exeName(binary)),
  );
}

function installCandidates(binary: MediaBinary): string[] {
  const name = exeName(binary);
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    return [
      path.join(pf, 'ffmpeg', 'bin', name),
      path.join(pf86, 'ffmpeg', 'bin', name),
      local ? path.join(local, 'Microsoft', 'WinGet', 'Links', name) : '',
      `C:\\ffmpeg\\bin\\${name}`,
    ].filter(Boolean);
  }
  const home = process.env.HOME || '';
  return [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
    home ? `${home}/anaconda3/bin/${name}` : '',
    home ? `${home}/miniconda3/bin/${name}` : '',
  ].filter(Boolean);
}

/** True if `candidate` runs `-version` with exit code 0. */
function canExec(candidate: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(candidate, ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

async function locate(binary: MediaBinary): Promise<string | null> {
  const override = envOverride(binary);
  if (override && (await canExec(override))) return override;

  const bundled = bundledPath(binary);
  if (bundled && (await canExec(bundled))) return bundled;

  if (await canExec(exeName(binary))) return exeName(binary);

  for (const candidate of installCandidates(binary)) {
    try {
      await fs.access(candidate);
    } catch {
      continue;
    }
    if (await canExec(candidate)) return candidate;
  }
  return null;
}

/** Resolve an ffmpeg/ffprobe binary, or null if none is usable. Cached. */
export async function findMediaBinary(binary: MediaBinary): Promise<string | null> {
  const cached = cache.get(binary);
  if (cached !== undefined) return cached;
  const found = await locate(binary);
  cache.set(binary, found);
  return found;
}

/** Test hook: drop the per-process resolution cache. */
export function clearMediaBinaryCache(): void {
  cache.clear();
}
