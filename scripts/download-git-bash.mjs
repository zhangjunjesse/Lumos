import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Git for Windows portable version
const GIT_VERSION = '2.48.1';
const GIT_BUILD = '1';

const platform = process.platform;

// Only download for Windows
if (platform !== 'win32') {
  console.log('✓ Skipping git-bash download (not Windows)');
  process.exit(0);
}

// Only download the architecture matching the current build target
const targetArch = process.env.npm_config_arch || process.arch;
const architectures = [targetArch];

for (const arch of architectures) {
  const gitBashDir = path.join(process.cwd(), 'resources', 'git-bash', 'win32', arch);
  const bashCandidates = [
    path.join(gitBashDir, 'bin', 'bash.exe'),
    path.join(gitBashDir, 'usr', 'bin', 'bash.exe'),
  ];

  if (bashCandidates.some((candidatePath) => fs.existsSync(candidatePath))) {
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

  const downloadPath = path.join(gitBashDir, 'PortableGit.7z.exe');

  try {
    // Download the portable Git
    console.log(`  Downloading from: ${downloadUrl}`);
    execSync(`curl -L -o "${downloadPath}" "${downloadUrl}"`, { stdio: 'inherit' });

    // Preserve the original PortableGit layout so bash can resolve /tmp and cygpath.
    console.log(`  Extracting...`);
    execSync(`"${downloadPath}" -o"${gitBashDir}" -y`, { stdio: 'inherit' });

    const extractedBashPath = bashCandidates.find((candidatePath) => fs.existsSync(candidatePath));
    if (!extractedBashPath) {
      throw new Error('PortableGit extraction did not produce a usable bash.exe');
    }

    fs.mkdirSync(path.join(gitBashDir, 'tmp'), { recursive: true });

    // Clean up
    console.log(`  Cleaning up...`);
    fs.unlinkSync(downloadPath);

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
