import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join(PROJECT_ROOT, 'release', 'runtime-resources');
const RESOURCE_ROOTS = [
  'node-runtime',
  'python-runtime',
  'git-bash',
  'models',
];

function parseArgs(argv) {
  const result = {
    outDir: DEFAULT_OUT_DIR,
    copy: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--copy') {
      result.copy = true;
    } else if (arg === '--out') {
      const value = argv[i + 1];
      if (!value) throw new Error('--out requires a path');
      result.outDir = path.resolve(value);
      i += 1;
    }
  }

  return result;
}

function sha512(filePath) {
  const hash = crypto.createHash('sha512');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }

  return hash.digest('base64');
}

function walkFiles(rootDir) {
  const files = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      }
    }
  }

  return files.sort();
}

function copyFileToOut(filePath, relativePath, outDir) {
  const targetPath = path.join(outDir, 'files', relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(filePath, targetPath);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
  const resourcesDir = path.join(PROJECT_ROOT, 'resources');
  const manifestFiles = [];

  for (const resourceRoot of RESOURCE_ROOTS) {
    const absoluteRoot = path.join(resourcesDir, resourceRoot);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    for (const filePath of walkFiles(absoluteRoot)) {
      const relativePath = path.relative(resourcesDir, filePath).split(path.sep).join('/');
      const stats = fs.statSync(filePath);
      manifestFiles.push({
        path: relativePath,
        size: stats.size,
        sha512: sha512(filePath),
      });

      if (options.copy) {
        copyFileToOut(filePath, relativePath, options.outDir);
      }
    }
  }

  const manifest = {
    schema: 'lumos-runtime-resources/v1',
    appVersion: packageJson.version,
    generatedAt: new Date().toISOString(),
    resources: RESOURCE_ROOTS,
    fileCount: manifestFiles.length,
    totalBytes: manifestFiles.reduce((sum, file) => sum + file.size, 0),
    files: manifestFiles,
  };

  fs.mkdirSync(options.outDir, { recursive: true });
  const manifestPath = path.join(options.outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Wrote ${manifestPath}`);
  console.log(`Files: ${manifest.fileCount}`);
  console.log(`Bytes: ${manifest.totalBytes}`);
  if (options.copy) {
    console.log(`Copied files to ${path.join(options.outDir, 'files')}`);
  }
}

main();
