import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const NODE_VERSION = 'v20.18.1';

// Download Node.js for current platform only
const platform = process.platform;
const arch = process.arch;
const ext = platform === 'win32' ? '.exe' : '';
const exeName = `node${ext}`;

const runtimeDir = path.join(process.cwd(), 'resources', 'node-runtime', platform, arch);
const targetPath = path.join(runtimeDir, exeName);

if (fs.existsSync(targetPath)) {
  console.log(`✓ Node.js ${NODE_VERSION} for ${platform}-${arch} already exists`);
  process.exit(0);
}

fs.mkdirSync(runtimeDir, { recursive: true });

console.log(`Downloading Node.js ${NODE_VERSION} for ${platform}-${arch}...`);

const baseUrl = `https://nodejs.org/dist/${NODE_VERSION}`;
let downloadUrl, extractCmd;

if (platform === 'win32') {
  downloadUrl = `${baseUrl}/node-${NODE_VERSION}-win-${arch}.zip`;
  const zipPath = path.join(runtimeDir, 'node.zip');
  execSync(`curl -L -o "${zipPath}" "${downloadUrl}"`, { stdio: 'inherit' });
  execSync(`unzip -j "${zipPath}" "*/node.exe" -d "${runtimeDir}"`, { stdio: 'inherit' });
  fs.unlinkSync(zipPath);
} else {
  downloadUrl = `${baseUrl}/node-${NODE_VERSION}-${platform}-${arch}.tar.gz`;
  const tarPath = path.join(runtimeDir, 'node.tar.gz');
  execSync(`curl -L -o "${tarPath}" "${downloadUrl}"`, { stdio: 'inherit' });
  execSync(`tar -xzf "${tarPath}" -C "${runtimeDir}" --strip-components=2 "*/bin/node"`, { stdio: 'inherit' });
  fs.unlinkSync(tarPath);
  fs.chmodSync(targetPath, 0o755);
}

console.log(`✓ Node.js ${NODE_VERSION} for ${platform}-${arch} downloaded to ${targetPath}`);
