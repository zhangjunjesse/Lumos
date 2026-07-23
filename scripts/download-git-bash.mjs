import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

// Git for Windows portable version
const GIT_VERSION = '2.48.1';
const GIT_BUILD = '1';

function parseArgs() {
  const args = process.argv.slice(2);
  let platform = process.platform;
  let arch = process.env.npm_config_arch || process.arch;

  const platformIdx = args.indexOf('--platform');
  if (platformIdx !== -1 && args[platformIdx + 1]) {
    platform = args[platformIdx + 1];
  }
  const archIdx = args.indexOf('--arch');
  if (archIdx !== -1 && args[archIdx + 1]) {
    arch = args[archIdx + 1];
  }

  return { platform, arch };
}

function find7za() {
  try {
    return require('7zip-bin').path7za;
  } catch {
    return process.env.SEVEN_ZIP || process.env.SEVEN_ZIP_PATH || '';
  }
}

function extractPortableGit(downloadPath, gitBashDir) {
  if (process.platform === 'win32') {
    execFileSync(downloadPath, [`-o${gitBashDir}`, '-y'], { stdio: 'inherit' });
    return;
  }

  const sevenZip = find7za();
  if (!sevenZip || !fs.existsSync(sevenZip)) {
    throw new Error('7zip-bin is unavailable; cannot extract PortableGit on this platform');
  }
  execFileSync(sevenZip, ['x', downloadPath, `-o${gitBashDir}`, '-y'], { stdio: 'inherit' });
}

const { platform, arch: targetArch } = parseArgs();

// Only download for Windows
if (platform !== 'win32') {
  console.log('✓ Skipping git-bash download (not Windows)');
  process.exit(0);
}

const architectures = [targetArch];

for (const arch of architectures) {
  const gitBashDir = path.join(process.cwd(), 'resources', 'git-bash', 'win32', arch);
  const bashCandidates = [
    path.join(gitBashDir, 'bin', 'bash.exe'),
    path.join(gitBashDir, 'usr', 'bin', 'bash.exe'),
  ];

  const downloadPath = path.join(gitBashDir, 'PortableGit.7z.exe');

  if (bashCandidates.some((candidatePath) => fs.existsSync(candidatePath))) {
    // 上次运行若在"删安装包"时被 Defender 锁住(EBUSY),会留下 60MB 残包;
    // 跳过前补删,否则会被打进发布产物。
    removeArchiveBestEffort(downloadPath, arch);
    console.log(`✓ git-bash for win32-${arch} already exists`);
    continue;
  }

  if (fs.existsSync(gitBashDir)) {
    console.log(`  Removing stale git-bash layout for win32-${arch}...`);
    fs.rmSync(gitBashDir, { recursive: true, force: true });
  }

  fs.mkdirSync(gitBashDir, { recursive: true });

  console.log(`Downloading Git for Windows ${GIT_VERSION} (${arch})...`);

  // Git for Windows portable download URL
  // Format: https://github.com/git-for-windows/git/releases/download/v2.48.1.windows.1/PortableGit-2.48.1-64-bit.7z.exe
  const archSuffix = arch === 'x64' ? '64' : '32'; // arm64 uses 32-bit for now
  const downloadUrl = `https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}.windows.${GIT_BUILD}/PortableGit-${GIT_VERSION}-${archSuffix}-bit.7z.exe`;

  try {
    // Download the portable Git
    console.log(`  Downloading from: ${downloadUrl}`);
    execFileSync('curl', ['-L', '-o', downloadPath, downloadUrl], { stdio: 'inherit' });

    // Preserve the original PortableGit layout so bash can resolve /tmp and cygpath.
    console.log(`  Extracting...`);
    extractPortableGit(downloadPath, gitBashDir);

    const extractedBashPath = bashCandidates.find((candidatePath) => fs.existsSync(candidatePath));
    if (!extractedBashPath) {
      throw new Error('PortableGit extraction did not produce a usable bash.exe');
    }

    fs.mkdirSync(path.join(gitBashDir, 'tmp'), { recursive: true });

    // Clean up。Windows CI 上 Defender 可能短暂锁住刚写出的自解压 exe(EBUSY),
    // 删不掉不该让整个下载失败——解压已成功,残包由下次运行的跳过分支补删。
    console.log(`  Cleaning up...`);
    removeArchiveBestEffort(downloadPath, arch);

    console.log(`✓ git-bash for win32-${arch} downloaded to ${gitBashDir} (${path.relative(gitBashDir, extractedBashPath)})`);
  } catch (error) {
    console.error(`✗ Failed to download git-bash for win32-${arch}:`, error.message);
    // Clean up on error
    if (fs.existsSync(gitBashDir)) {
      fs.rmSync(gitBashDir, { recursive: true, force: true });
    }
    process.exit(1);
  }
}

console.log('✓ All git-bash downloads complete');

function removeArchiveBestEffort(archivePath, arch) {
  if (!fs.existsSync(archivePath)) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fs.unlinkSync(archivePath);
      return;
    } catch (error) {
      if (attempt === 3) {
        console.warn(`  ⚠ 无法删除 win32-${arch} 的 PortableGit.7z.exe(${error.message}),留待下次运行清理`);
        return;
      }
      execFileSync(process.execPath, ['-e', 'setTimeout(()=>{}, 3000)'], { stdio: 'ignore' });
    }
  }
}
