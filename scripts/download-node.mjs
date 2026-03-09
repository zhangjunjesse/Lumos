import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const NODE_VERSION = 'v20.18.1';

// Download Node.js for current platform
// For Windows: download both x64 and arm64 to support universal installer
const platform = process.platform;
const currentArch = process.arch;

// On Windows CI, download both architectures
const architectures = platform === 'win32' ? ['x64', 'arm64'] : [currentArch];

for (const arch of architectures) {
  const ext = platform === 'win32' ? '.exe' : '';
  const exeName = `node${ext}`;

  const runtimeDir = path.join(process.cwd(), 'resources', 'node-runtime', platform, arch);
  const targetPath = path.join(runtimeDir, exeName);

  if (fs.existsSync(targetPath)) {
    console.log(`✓ Node.js ${NODE_VERSION} for ${platform}-${arch} already exists`);
    continue;
  }

  fs.mkdirSync(runtimeDir, { recursive: true });

  console.log(`Downloading Node.js ${NODE_VERSION} for ${platform}-${arch}...`);

  const baseUrl = `https://nodejs.org/dist/${NODE_VERSION}`;

  if (platform === 'win32') {
    const downloadUrl = `${baseUrl}/node-${NODE_VERSION}-win-${arch}.zip`;
    const zipPath = path.join(runtimeDir, 'node.zip');
    execSync(`curl -L -o "${zipPath}" "${downloadUrl}"`, { stdio: 'inherit' });

    // Use PowerShell Expand-Archive instead of unzip (Windows doesn't have unzip by default)
    const tempExtractDir = path.join(runtimeDir, 'temp');
    fs.mkdirSync(tempExtractDir, { recursive: true });
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempExtractDir}' -Force"`, { stdio: 'inherit' });

    // Find and move node.exe to target directory
    const extractedDir = fs.readdirSync(tempExtractDir)[0];
    const nodeExePath = path.join(tempExtractDir, extractedDir, 'node.exe');
    fs.renameSync(nodeExePath, targetPath);

    // Clean up
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
  } else {
    const downloadUrl = `${baseUrl}/node-${NODE_VERSION}-${platform}-${arch}.tar.gz`;
    const tarPath = path.join(runtimeDir, 'node.tar.gz');
    const archiveNodePath = `node-${NODE_VERSION}-${platform}-${arch}/bin/node`;
    execSync(`curl -L -o "${tarPath}" "${downloadUrl}"`, { stdio: 'inherit' });
    execSync(`tar -xzf "${tarPath}" -C "${runtimeDir}" --strip-components=2 "${archiveNodePath}"`, { stdio: 'inherit' });
    fs.unlinkSync(tarPath);
    fs.chmodSync(targetPath, 0o755);
  }

  console.log(`✓ Node.js ${NODE_VERSION} for ${platform}-${arch} downloaded to ${targetPath}`);
}
