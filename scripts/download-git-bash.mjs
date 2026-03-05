import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Git for Windows portable version
const GIT_VERSION = '2.48.1';
const GIT_BUILD = '1';

const platform = process.platform;

// Only download for Windows
if (platform !== 'win32') {
  console.log('✓ Skipping git-bash download (not Windows)');
  process.exit(0);
}

// Download both x64 and arm64 for Windows
const architectures = ['x64', 'arm64'];

for (const arch of architectures) {
  const gitBashDir = path.join(process.cwd(), 'resources', 'git-bash', 'win32', arch);
  const bashExePath = path.join(gitBashDir, 'bash.exe');

  if (fs.existsSync(bashExePath)) {
    console.log(`✓ git-bash for win32-${arch} already exists`);
    continue;
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

    // Extract using 7z self-extractor (the .exe is a self-extracting 7z archive)
    console.log(`  Extracting...`);
    const tempExtractDir = path.join(gitBashDir, 'temp');
    fs.mkdirSync(tempExtractDir, { recursive: true });

    // The portable Git exe is a self-extracting archive, we can run it with -y flag
    execSync(`"${downloadPath}" -o"${tempExtractDir}" -y`, { stdio: 'inherit' });

    // Copy only the essential files we need for bash
    const essentialFiles = [
      'usr/bin/bash.exe',
      'usr/bin/sh.exe',
      'usr/bin/msys-2.0.dll',
      'usr/bin/msys-intl-8.dll',
      'usr/bin/msys-iconv-2.dll',
    ];

    console.log(`  Copying essential files...`);
    for (const file of essentialFiles) {
      const srcPath = path.join(tempExtractDir, file);
      const destPath = path.join(gitBashDir, path.basename(file));

      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`    ✓ ${path.basename(file)}`);
      } else {
        console.warn(`    ⚠ ${file} not found`);
      }
    }

    // Clean up
    console.log(`  Cleaning up...`);
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
    fs.unlinkSync(downloadPath);

    console.log(`✓ git-bash for win32-${arch} downloaded to ${gitBashDir}`);
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
