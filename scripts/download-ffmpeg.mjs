import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Download static ffmpeg + ffprobe for the build target platform/arch into
 * resources/ffmpeg/<platform>/<arch>/, mirroring download-node.mjs /
 * download-git-bash.mjs. electron-builder ships resources/ffmpeg/ as
 * extraResources, and src/lib/media/ffmpeg-locator.ts resolves it at runtime.
 *
 * Source: ffbinaries prebuilt static builds (single API covering
 * windows/osx/linux + ffprobe). macOS ships an x64 binary that runs on arm64
 * via Rosetta — ffbinaries has no native osx-arm64 build.
 *
 * Usage: node scripts/download-ffmpeg.mjs [--platform win32] [--arch x64]
 *        npm_config_arch=arm64 node scripts/download-ffmpeg.mjs
 */

const API_URL = 'https://ffbinaries.com/api/v1/version/latest';

function parseArgs() {
  const args = process.argv.slice(2);
  let platform = process.platform;
  let arch = process.env.npm_config_arch || process.arch;
  const pIdx = args.indexOf('--platform');
  if (pIdx !== -1 && args[pIdx + 1]) platform = args[pIdx + 1];
  const aIdx = args.indexOf('--arch');
  if (aIdx !== -1 && args[aIdx + 1]) arch = args[aIdx + 1];
  return { platform, arch };
}

/** Map Node platform/arch to an ffbinaries platform code. */
function ffbinariesCode(platform, arch) {
  if (platform === 'win32') return 'windows-64';
  if (platform === 'darwin') return 'osx-64';
  if (platform === 'linux') {
    if (arch === 'arm64') return 'linux-arm64';
    if (arch === 'arm') return 'linux-armhf';
    return 'linux-64';
  }
  return null;
}

async function fetchBinUrls(code) {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`ffbinaries API ${res.status} ${res.statusText}`);
  const json = await res.json();
  const bin = json?.bin?.[code];
  if (!bin?.ffmpeg) throw new Error(`ffbinaries has no ffmpeg build for "${code}"`);
  return { version: json.version, ffmpeg: bin.ffmpeg, ffprobe: bin.ffprobe };
}

function extractZip(zipPath, destDir) {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      ['-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' });
  }
}

/** Download one binary's zip, extract it, and place the exe at targetPath. */
function downloadBinary(url, name, exeName, outDir, targetPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `lumos-${name}-`));
  try {
    const zipPath = path.join(tmpDir, `${name}.zip`);
    execFileSync('curl', ['-L', '--fail', '-o', zipPath, url], { stdio: 'inherit' });
    extractZip(zipPath, tmpDir);
    const extracted = path.join(tmpDir, exeName);
    if (!fs.existsSync(extracted)) {
      throw new Error(`${name} zip did not contain ${exeName}`);
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(extracted, targetPath);
    if (process.platform !== 'win32') fs.chmodSync(targetPath, 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const { platform, arch } = parseArgs();
  const code = ffbinariesCode(platform, arch);
  if (!code) {
    console.log(`✓ Skipping ffmpeg download (unsupported platform ${platform}-${arch})`);
    return;
  }

  const ext = platform === 'win32' ? '.exe' : '';
  const outDir = path.join(process.cwd(), 'resources', 'ffmpeg', platform, arch);
  const ffmpegTarget = path.join(outDir, `ffmpeg${ext}`);
  const ffprobeTarget = path.join(outDir, `ffprobe${ext}`);

  if (fs.existsSync(ffmpegTarget) && fs.existsSync(ffprobeTarget)) {
    console.log(`✓ ffmpeg + ffprobe for ${platform}-${arch} already exist`);
    return;
  }

  const { version, ffmpeg, ffprobe } = await fetchBinUrls(code);
  console.log(`Downloading ffmpeg ${version} for ${platform}-${arch} (${code})...`);

  if (!fs.existsSync(ffmpegTarget)) {
    downloadBinary(ffmpeg, 'ffmpeg', `ffmpeg${ext}`, outDir, ffmpegTarget);
  }
  if (ffprobe && !fs.existsSync(ffprobeTarget)) {
    downloadBinary(ffprobe, 'ffprobe', `ffprobe${ext}`, outDir, ffprobeTarget);
  } else if (!ffprobe) {
    console.warn(`  ! ffbinaries has no ffprobe for ${code}; IM duration probe will fall back`);
  }

  console.log(`✓ ffmpeg ${version} for ${platform}-${arch} → ${outDir}`);
}

main().catch((err) => {
  console.error(`✗ download-ffmpeg failed: ${err.message}`);
  process.exit(1);
});
